'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTelegram } from '../../../context/TelegramContext';

// 13 achievement catalogue — mirror of src/lib/server/gamification.js ACHIEVEMENTS
const CATALOGUE = [
  { id: 'first_teach',   emoji: '🎓', title: 'First Lesson',     desc: 'Saved your first knowledge item' },
  { id: 'knowledge_10',  emoji: '📚', title: 'Knowledge Builder', desc: 'Built a knowledge base of 10 items' },
  { id: 'voice_5',       emoji: '🗣️', title: 'Voice Trained',     desc: 'Added 5 sample replies' },
  { id: 'first_reply',   emoji: '💬', title: 'First Reply',       desc: 'MiniMe sent its first AI reply' },
  { id: 'speed_100',     emoji: '⚡', title: 'Speed Demon',       desc: '100 AI replies in one week' },
  { id: 'trusted',       emoji: '🤝', title: 'Trusted',           desc: 'Promoted to Trusted — auto-reply unlocked' },
  { id: 'full_agent',    emoji: '🚀', title: 'Full Agent',        desc: 'Promoted to Full Agent — running autonomous' },
  { id: 'beloved',       emoji: '🌟', title: 'Beloved',           desc: '90%+ helpfulness with 10+ ratings' },
  { id: 'first_sale',    emoji: '💰', title: 'First Sale',        desc: 'First paid customer order' },
  { id: 'top_seller',    emoji: '🎯', title: 'Top Seller',        desc: '50 paid orders — you\'re on a roll' },
  { id: 'crowd',         emoji: '👥', title: 'Crowd Favorite',    desc: '100 customers — word is spreading' },
  { id: 'streak_7',      emoji: '🔥', title: 'Hot Streak',        desc: '7 consecutive days active' },
  { id: 'streak_30',     emoji: '🏆', title: 'Marathon',          desc: '30 consecutive days — relentless' },
];

const INK = '#0E2823';
const PAPER = '#FBF8F1';
const CREAM = '#F4EEE1';
const CREAM2 = '#EDE6D6';
const GOLD = '#B08A4A';
const LINE = '#E4DED1';
const MUTED = '#8A9590';
const SERIF = "'Newsreader', Georgia, serif";
const BODY = "'Geist', 'Inter', -apple-system, system-ui, sans-serif";

export default function AchievementsPage() {
  const { initData } = useTelegram() || {};
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!initData) return;
    fetch('/api/home/feed', { headers: { 'x-telegram-init-data': initData } })
      .then(r => r.json())
      .then(setData)
      .catch(() => {});
  }, [initData]);

  const unlocked = new Set((data?.gamification?.recent_achievements || []).map(a => a.id));
  const streakDays = data?.gamification?.streak_days || 0;
  const longest = data?.gamification?.longest_streak || 0;

  // Need full list, not just recent_achievements (which is capped at 3). Fetch separately.
  const [allUnlocked, setAllUnlocked] = useState([]);
  useEffect(() => {
    if (!initData) return;
    fetch('/api/home/feed', { headers: { 'x-telegram-init-data': initData } })
      .then(r => r.json())
      .then(d => {
        // For now we only have recent_achievements. To get all, we'd need a dedicated endpoint.
        // Use recent_achievements as the source of truth + check count.
        setAllUnlocked(d?.gamification?.recent_achievements || []);
      })
      .catch(() => {});
  }, [initData]);

  return (
    <div style={{ minHeight: '100vh', background: PAPER, padding: '20px 22px 100px', fontFamily: BODY, color: INK }}>
      <Link href="/" style={{ color: MUTED, fontSize: 13, textDecoration: 'none', display: 'inline-block', marginBottom: 16 }}>
        ← Back
      </Link>

      <div style={{ fontFamily: SERIF, fontSize: 28, fontWeight: 400, letterSpacing: '-0.015em' }}>
        Achievements
      </div>
      <div style={{ fontSize: 13, color: MUTED, marginTop: 4, marginBottom: 24 }}>
        {data?.gamification?.achievements_count || 0} of {CATALOGUE.length} unlocked
      </div>

      {/* Streak banner */}
      <div style={{
        background: streakDays >= 7 ? `linear-gradient(135deg, #FF6B35 0%, #F7931E 100%)` : CREAM,
        border: `1px solid ${streakDays >= 7 ? 'transparent' : LINE}`,
        color: streakDays >= 7 ? '#fff' : INK,
        borderRadius: 16, padding: 18, marginBottom: 22,
        display: 'flex', alignItems: 'center', gap: 14,
      }}>
        <div style={{ fontSize: 36 }}>🔥</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: SERIF, fontSize: 24, lineHeight: 1.1 }}>
            {streakDays} day{streakDays === 1 ? '' : 's'}
          </div>
          <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4 }}>
            {streakDays === 0 ? 'Start a streak — open the app today.' :
             streakDays < 7 ? `${7 - streakDays} more days to unlock Hot Streak.` :
             streakDays < 30 ? `${30 - streakDays} more days to Marathon.` :
             'Marathon! You\'re relentless 🏆'}
          </div>
          {longest > streakDays && (
            <div style={{ fontSize: 11, opacity: 0.7, marginTop: 3 }}>
              Longest: {longest} days
            </div>
          )}
        </div>
      </div>

      {/* Achievement grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
        {CATALOGUE.map(a => {
          const got = unlocked.has(a.id);
          return (
            <div key={a.id} style={{
              background: got ? '#fff' : CREAM2,
              border: `1px solid ${got ? GOLD : LINE}`,
              borderRadius: 14, padding: 14, position: 'relative',
              opacity: got ? 1 : 0.55,
            }}>
              <div style={{ fontSize: 28, marginBottom: 6, filter: got ? 'none' : 'grayscale(1)' }}>
                {a.emoji}
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, color: INK, marginBottom: 3 }}>
                {a.title}
              </div>
              <div style={{ fontSize: 11, color: MUTED, lineHeight: 1.35 }}>
                {a.desc}
              </div>
              {got && (
                <div style={{
                  position: 'absolute', top: 8, right: 8,
                  width: 18, height: 18, borderRadius: '50%',
                  background: GOLD, color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 700,
                }}>✓</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
