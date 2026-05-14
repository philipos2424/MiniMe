/**
 * Gamification — streaks + achievements.
 *
 * Designed to layer ON TOP of the existing trust-level system, not replace it.
 * Trust level (Shadow → Full Agent) remains the de-facto "level" in the UI;
 * this module adds light reinforcement signals (daily streaks + 13 achievements).
 *
 * Achievements are stored as `businesses.achievements` JSONB array of
 * { id, unlocked_at }. Streaks use dedicated columns. Both are read by
 * the dashboard feed API and bumped from replyEngine hook points.
 */
import { supabase } from './db';
import { tg } from './telegramApi';
import { decrypt } from './crypto';

export const ACHIEVEMENTS = [
  // Teaching
  { id: 'first_teach',     emoji: '🎓', title: 'First Lesson',     desc: 'Saved your first knowledge item',
    check: (b, s) => (s.docs_total || 0) >= 1 },
  { id: 'knowledge_10',    emoji: '📚', title: 'Knowledge Builder', desc: 'Built a knowledge base of 10 items',
    check: (b, s) => (s.docs_total || 0) >= 10 },
  { id: 'voice_5',         emoji: '🗣️', title: 'Voice Trained',     desc: 'Added 5 sample replies',
    check: (b)    => Array.isArray(b.sample_replies) && b.sample_replies.length >= 5 },

  // Replies
  { id: 'first_reply',     emoji: '💬', title: 'First Reply',       desc: 'MiniMe sent its first AI reply',
    check: (b, s) => (s.ai_msgs_total || 0) >= 1 },
  { id: 'speed_100',       emoji: '⚡', title: 'Speed Demon',       desc: '100 AI replies in one week',
    check: (b, s) => (s.ai_msgs_week || 0) >= 100 },

  // Trust progression
  { id: 'trusted',         emoji: '🤝', title: 'Trusted',           desc: 'Promoted to Trusted — auto-reply unlocked',
    check: (b)    => (b.trust_level ?? 0) >= 2 },
  { id: 'full_agent',      emoji: '🚀', title: 'Full Agent',        desc: 'Promoted to Full Agent — running autonomous',
    check: (b)    => (b.trust_level ?? 0) >= 3 },

  // Quality
  { id: 'beloved',         emoji: '🌟', title: 'Beloved',           desc: '90%+ helpfulness with 10+ ratings',
    check: (b, s) => (s.helpful_pct || 0) >= 90 && (s.feedback_total || 0) >= 10 },

  // Sales
  { id: 'first_sale',      emoji: '💰', title: 'First Sale',        desc: 'First paid customer order',
    check: (b, s) => (s.orders_paid_total || 0) >= 1 },
  { id: 'top_seller',      emoji: '🎯', title: 'Top Seller',        desc: '50 paid orders — you\'re on a roll',
    check: (b, s) => (s.orders_paid_total || 0) >= 50 },

  // Customers
  { id: 'crowd',           emoji: '👥', title: 'Crowd Favorite',    desc: '100 customers — word is spreading',
    check: (b, s) => (s.customers_total || 0) >= 100 },

  // Streaks
  { id: 'streak_7',        emoji: '🔥', title: 'Hot Streak',        desc: '7 consecutive days active',
    check: (b)    => (b.streak_days || 0) >= 7 },
  { id: 'streak_30',       emoji: '🏆', title: 'Marathon',          desc: '30 consecutive days — relentless',
    check: (b)    => (b.streak_days || 0) >= 30 },
];

const ETHIOPIA_TZ_OFFSET_MS = 3 * 60 * 60 * 1000;
function todayInAddis() {
  return new Date(Date.now() + ETHIOPIA_TZ_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Bump the streak counter for an owner. Call this whenever the owner sends
 * a privileged message to the bot. Safe to call multiple times per day.
 *
 * Returns { streak_days, longest_streak, changed } where `changed=true` means
 * this is the first call of a new day (callers can use this to trigger
 * one-time-per-day celebrations).
 */
export async function updateStreak(businessId) {
  const sb = supabase();
  const { data: biz } = await sb.from('businesses')
    .select('streak_days, longest_streak, last_active_date')
    .eq('id', businessId).maybeSingle();
  if (!biz) return { streak_days: 0, longest_streak: 0, changed: false };

  const today = todayInAddis();
  const last = biz.last_active_date ? String(biz.last_active_date) : null;
  if (last === today) {
    return { streak_days: biz.streak_days || 1, longest_streak: biz.longest_streak || 0, changed: false };
  }

  // Calculate gap
  let newStreak;
  if (!last) {
    newStreak = 1;
  } else {
    const lastD = new Date(last + 'T00:00:00Z');
    const todayD = new Date(today + 'T00:00:00Z');
    const daysGap = Math.round((todayD - lastD) / 86400000);
    newStreak = daysGap === 1 ? (biz.streak_days || 0) + 1 : 1;
  }
  const longest = Math.max(biz.longest_streak || 0, newStreak);

  await sb.from('businesses').update({
    streak_days: newStreak,
    longest_streak: longest,
    last_active_date: today,
  }).eq('id', businessId);

  return { streak_days: newStreak, longest_streak: longest, changed: true };
}

/**
 * Compute small stats blob used for achievement checking.
 * Cheap aggregates only — not the full home/feed payload.
 */
async function getAchievementStats(businessId) {
  const sb = supabase();
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString();
  const [
    { count: docsTotal },
    { count: aiMsgsTotal },
    { count: aiMsgsWeek },
    { count: ordersPaidTotal },
    { count: customersTotal },
    { data: fb },
  ] = await Promise.all([
    sb.from('documents').select('id', { count: 'exact', head: true }).eq('business_id', businessId),
    sb.from('messages').select('id', { count: 'exact', head: true })
      .eq('business_id', businessId).eq('direction', 'outbound').eq('is_ai_generated', true),
    sb.from('messages').select('id', { count: 'exact', head: true })
      .eq('business_id', businessId).eq('direction', 'outbound').eq('is_ai_generated', true).gte('created_at', weekAgo),
    sb.from('orders').select('id', { count: 'exact', head: true })
      .eq('business_id', businessId).eq('status', 'paid'),
    sb.from('customers').select('id', { count: 'exact', head: true }).eq('business_id', businessId),
    sb.from('feedback').select('helpful').eq('business_id', businessId).gte('created_at', monthAgo),
  ]);
  const fbTotal = (fb || []).length;
  const fbHelpful = (fb || []).filter(r => r.helpful).length;
  const helpfulPct = fbTotal > 0 ? Math.round((fbHelpful / fbTotal) * 100) : 0;

  return {
    docs_total: docsTotal || 0,
    ai_msgs_total: aiMsgsTotal || 0,
    ai_msgs_week: aiMsgsWeek || 0,
    orders_paid_total: ordersPaidTotal || 0,
    customers_total: customersTotal || 0,
    feedback_total: fbTotal,
    helpful_pct: helpfulPct,
  };
}

/**
 * Check every achievement and return newly-unlocked ones (and persist them).
 * Skips firing celebration messages for unlocks before `seeded_achievements_at`.
 */
export async function evaluateAchievements(businessId) {
  const sb = supabase();
  const { data: biz } = await sb.from('businesses').select(
    'id, owner_telegram_id, owner_private_chat_id, telegram_bot_token_enc, name, ' +
    'trust_level, sample_replies, streak_days, longest_streak, ' +
    'achievements, seeded_achievements_at'
  ).eq('id', businessId).maybeSingle();
  if (!biz) return { newly_unlocked: [] };

  const unlocked = new Set((biz.achievements || []).map(a => a.id));
  const stats = await getAchievementStats(businessId);

  const newlyUnlocked = [];
  for (const ach of ACHIEVEMENTS) {
    if (unlocked.has(ach.id)) continue;
    let passed = false;
    try { passed = !!ach.check(biz, stats); } catch {}
    if (passed) {
      newlyUnlocked.push({ id: ach.id, emoji: ach.emoji, title: ach.title, desc: ach.desc });
      unlocked.add(ach.id);
    }
  }
  if (!newlyUnlocked.length) return { newly_unlocked: [] };

  // Persist — only ID + unlocked_at to keep the row compact
  const newRecords = newlyUnlocked.map(a => ({ id: a.id, unlocked_at: new Date().toISOString() }));
  const merged = [...(biz.achievements || []), ...newRecords];
  await sb.from('businesses').update({ achievements: merged }).eq('id', businessId);

  // Telegram celebration — only for unlocks that happened after seeded_achievements_at
  // (avoids spamming on first deploy when all backfilled criteria pass at once)
  const seedThreshold = biz.seeded_achievements_at ? new Date(biz.seeded_achievements_at) : new Date(0);
  const shouldCelebrate = Date.now() - seedThreshold.getTime() > 60_000; // 1 min grace
  if (shouldCelebrate && biz.telegram_bot_token_enc) {
    const chatId = biz.owner_private_chat_id || biz.owner_telegram_id;
    if (chatId) {
      try {
        const token = decrypt(biz.telegram_bot_token_enc);
        for (const a of newlyUnlocked) {
          await tg(token, 'sendMessage', {
            chat_id: chatId,
            text: `🎉 *Achievement unlocked!*\n\n${a.emoji} *${a.title}*\n_${a.desc}_`,
            parse_mode: 'Markdown',
          });
        }
      } catch (e) { console.warn('achievement notify:', e.message); }
    }
  }

  return { newly_unlocked: newlyUnlocked };
}
