/**
 * Admin-configurable marketing/sales outreach + feedback-prompt engine.
 *
 * Generalizes two previously disconnected, hardcoded systems into data
 * (outreach_rules rows, editable from /admin/outreach) instead of code:
 *  - cron/owner-nudges' JS rule set (left untouched here — see its own file;
 *    migrating those 7 types into outreach_rules is an explicit follow-up).
 *  - apps/bot/src/cron/trial-checker.js's trial-stage nudges, which live in
 *    the deprecated, undeployed apps/bot app and are NOT firing in
 *    production today. Ported here as `trial_stage` rules (seeded in
 *    packages/db/migrations/044_marketing_outreach.sql).
 *
 * Each enabled rule is evaluated per business, in priority order (lower
 * number first); the first rule that matches AND is off cooldown fires —
 * one outreach send per business per run, same "no pile-on" philosophy as
 * owner-nudges. `outreach_sends` is the single dedupe/cooldown ledger for
 * both this engine and manual campaigns (api/admin/outreach/campaigns), so
 * a business can't be hit by two different sources back-to-back.
 *
 * Also fires any `outreach_campaigns` rows that are due (status='scheduled'
 * and scheduled_for <= now), reusing the same send path.
 *
 * Auth: Vercel Cron `Authorization: Bearer <CRON_SECRET>` (isCronAuthorized).
 * Schedule: registered in vercel.json, 08:30 UTC daily (staggered from
 * owner-nudges at 08:00 and healthcheck/review-followup at 09:00).
 */
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { isCronAuthorized } from '../../../../lib/server/auth';
import { supabase } from '../../../../lib/server/db';
import { audit } from '../../../../lib/server/audit';
import { selectRecipients, sendBroadcast } from '../../../../lib/server/outreach';
import { sendTelegramMessage } from '../../../../lib/server/telegram-send.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const DAY_MS = 86_400_000;
// Minimum gap since ANY outreach send (rule or campaign) before a different
// rule may fire for the same business — mirrors owner-nudges' 7-day global
// cooldown so this engine doesn't pile on top of that one either.
const GLOBAL_COOLDOWN_MS = 7 * DAY_MS;

function appUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.WEB_URL || 'https://web-theta-one-68.vercel.app')
    .trim().replace(/\/$/, '');
}

function renderTemplate(template, business) {
  const first = (business.owner_name || '').split(' ')[0] || 'there';
  return String(template || '')
    .replaceAll('{{owner_name}}', first)
    .replaceAll('{{business_name}}', business.name || 'your shop');
}

// ── trigger_type evaluators ─────────────────────────────────────────────
// Each returns true/false given the business + rule.trigger_config + now.
// Evaluators that need extra per-business data read it off `ctx` (batched
// once per run, not per business — see the fetch block below).

function evalDaysSinceSignup(business, config, now) {
  const days = (now - new Date(business.created_at).getTime()) / DAY_MS;
  return days >= (config.days ?? 0);
}

function evalDaysSinceActive(business, config, now) {
  const days = (now - new Date(business.updated_at || business.created_at).getTime()) / DAY_MS;
  return days >= (config.days ?? 0);
}

function evalInactivity(business, config, now) {
  return evalDaysSinceActive(business, config, now);
}

function evalPlanTier(business, config) {
  const tiers = Array.isArray(config.tiers) ? config.tiers : [];
  const tier = business.plan_tier || business.subscription_plan;
  return tiers.includes(tier);
}

function evalUsageMilestone(business, config, now, ctx) {
  if (config.milestone === 'has_products') return (ctx.productByBiz[business.id] || 0) > 0;
  if (config.milestone === 'no_products_yet') {
    const days = (now - new Date(business.created_at).getTime()) / DAY_MS;
    return (ctx.productByBiz[business.id] || 0) === 0 && days >= (config.days ?? 0);
  }
  return false;
}

// trial_stage: ports trial-checker.js's TRIAL_STAGES/WINBACK_STAGES logic.
// Reuses businesses.trial_warn_stage as the idempotency counter exactly like
// the original — this trigger_type is reserved for `kind='nudge'` trial
// rules only (feedback-prompt rules use days_since_signup instead) so
// trial_warn_stage bookkeeping isn't shared/contended between unrelated
// rule types.
function evalTrialStage(business, config, now) {
  if (!business.trial_ends_at || !business.owner_private_chat_id) return false;
  const tier = business.plan_tier || business.subscription_plan;
  if (tier === 'pro' || business.subscription_status === 'active' || business.subscription_status === 'cancelled') return false;

  const trialEnd = new Date(business.trial_ends_at).getTime();
  const sent = business.trial_warn_stage;
  const alreadyPast = sent !== null && sent !== undefined && config.stage_value >= sent;
  if (alreadyPast) return false;

  if (config.phase === 'warn') {
    if (business.subscription_status !== 'trial') return false;
    const daysLeft = Math.ceil((trialEnd - now) / DAY_MS);
    return daysLeft > 0 && daysLeft <= (config.at_or_below_days ?? 0);
  }
  if (config.phase === 'expired') {
    if (business.subscription_status !== 'trial') return false;
    const daysLeft = Math.ceil((trialEnd - now) / DAY_MS);
    return daysLeft <= 0;
  }
  if (config.phase === 'winback') {
    if (business.subscription_status !== 'expired') return false;
    const daysSince = Math.floor((now - trialEnd) / DAY_MS);
    return daysSince >= (config.after_days ?? 0);
  }
  return false;
}

const EVALUATORS = {
  days_since_signup: evalDaysSinceSignup,
  days_since_active: evalDaysSinceActive,
  inactivity: evalInactivity,
  plan_tier: evalPlanTier,
  usage_milestone: evalUsageMilestone,
  trial_stage: evalTrialStage,
};

async function fireScheduledCampaigns({ sb, token, now, summary }) {
  const { data: due } = await sb.from('outreach_campaigns')
    .select('*')
    .eq('status', 'scheduled')
    .lte('scheduled_for', new Date(now).toISOString())
    .limit(50);
  if (!due?.length) return;

  for (const campaign of due) {
    try {
      await sb.from('outreach_campaigns').update({ status: 'sending' }).eq('id', campaign.id);

      let recipients;
      if (Array.isArray(campaign.segment_filter?.business_ids) && campaign.segment_filter.business_ids.length) {
        const { data } = await sb.from('businesses')
          .select('id, name, owner_name, owner_telegram_id, owner_private_chat_id, notification_prefs')
          .in('id', campaign.segment_filter.business_ids)
          .not('owner_telegram_id', 'is', null);
        recipients = data || [];
      } else {
        recipients = await selectRecipients(campaign.segment_filter?.segment || 'all');
      }
      recipients = recipients.filter(b => b.notification_prefs?.owner_nudges?.opted_out !== true);

      const result = await sendBroadcast({
        token, recipients, message: campaign.message,
        source: { type: 'campaign', campaign_id: campaign.id },
      });

      await sb.from('outreach_campaigns').update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        recipient_count: recipients.length,
        sent_count: result.sent,
        failed_count: result.failed,
      }).eq('id', campaign.id);

      summary.campaigns_fired = (summary.campaigns_fired || 0) + 1;
    } catch (e) {
      console.error(`[cron/outreach-rules] scheduled campaign ${campaign.id} failed:`, e.message);
      await sb.from('outreach_campaigns').update({ status: 'draft' }).eq('id', campaign.id).catch(() => {});
    }
  }
}

export async function GET(request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return NextResponse.json({ error: 'no_bot_token' }, { status: 500 });

  const dryRun = new URL(request.url).searchParams.get('dry_run') === '1';
  const now = Date.now();
  const sb = supabase();

  const summary = { eligible: 0, sent: 0, failed: 0, skipped_optout: 0, skipped_cooldown: 0, skipped_no_match: 0, by_rule: {}, dry_run: dryRun };

  const { data: rules, error: rulesError } = await sb.from('outreach_rules')
    .select('*').eq('enabled', true).order('priority', { ascending: true });
  if (rulesError) {
    console.error('[cron/outreach-rules] rules query failed:', rulesError);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }

  if (rules?.length) {
    const { data: businesses, error: bizError } = await sb.from('businesses')
      .select('id, name, owner_name, owner_telegram_id, owner_private_chat_id, created_at, updated_at, notification_prefs, subscription_status, plan_tier, subscription_plan, trial_ends_at, trial_started_at, trial_warn_stage')
      .not('owner_telegram_id', 'is', null)
      .limit(5000);
    if (bizError) {
      console.error('[cron/outreach-rules] businesses query failed:', bizError);
      return NextResponse.json({ error: 'db_error' }, { status: 500 });
    }

    if (businesses?.length) {
      const ids = businesses.map(b => b.id);

      // Batched, not per-business: usage_milestone needs product counts.
      const { data: prods } = await sb.from('products').select('business_id').in('business_id', ids).limit(20000);
      const productByBiz = {};
      for (const p of prods || []) productByBiz[p.business_id] = (productByBiz[p.business_id] || 0) + 1;
      const ctx = { productByBiz };

      // Send-log lookback covers the longest cooldown/max_sends window any
      // rule could plausibly need; one query for the whole run, not per rule.
      const lookbackStart = new Date(now - 400 * DAY_MS).toISOString();
      const { data: sends } = await sb.from('outreach_sends')
        .select('business_id, rule_id, status, sent_at')
        .in('business_id', ids)
        .eq('status', 'sent')
        .gte('sent_at', lookbackStart)
        .limit(50000);

      const perRuleByBiz = {};   // `${business_id}:${rule_id}` -> { count, lastAt }
      const globalLastByBiz = {}; // business_id -> lastAt (ms), across all rules
      for (const s of sends || []) {
        const key = `${s.business_id}:${s.rule_id}`;
        const t = new Date(s.sent_at).getTime();
        const e = perRuleByBiz[key] || (perRuleByBiz[key] = { count: 0, lastAt: 0 });
        e.count++;
        if (t > e.lastAt) e.lastAt = t;
        if (t > (globalLastByBiz[s.business_id] || 0)) globalLastByBiz[s.business_id] = t;
      }

      for (const business of businesses) {
        if (business.notification_prefs?.owner_nudges?.opted_out === true) { summary.skipped_optout++; continue; }

        const globalLast = globalLastByBiz[business.id] || 0;
        // Time-critical trial/expiry rules may still fire inside the global
        // cooldown — mirrors owner-nudges' GLOBAL_COOLDOWN_EXEMPT for the
        // same reason (an earlier unrelated nudge shouldn't block it).
        let matchedRule = null;
        for (const rule of rules) {
          const evaluator = EVALUATORS[rule.trigger_type];
          if (!evaluator) continue;
          let matches;
          try { matches = evaluator(business, rule.trigger_config || {}, now, ctx); }
          catch (e) { console.warn(`[cron/outreach-rules] evaluator error rule=${rule.key}:`, e.message); continue; }
          if (!matches) continue;

          if (globalLast && now - globalLast < GLOBAL_COOLDOWN_MS && rule.trigger_type !== 'trial_stage') {
            continue; // let a lower-priority, non-time-critical rule keep looking, or fall through to no-match
          }

          const perRule = perRuleByBiz[`${business.id}:${rule.id}`];
          if (perRule) {
            if (perRule.count >= rule.max_sends) continue;
            if (now - perRule.lastAt < rule.cooldown_days * DAY_MS) continue;
          }

          matchedRule = rule;
          break;
        }

        if (!matchedRule) { summary.skipped_no_match++; continue; }

        summary.eligible++;
        summary.by_rule[matchedRule.key] = (summary.by_rule[matchedRule.key] || 0) + 1;
        if (dryRun) continue;

        const chatId = business.owner_private_chat_id || business.owner_telegram_id;
        let text = renderTemplate(matchedRule.message_template, business);
        let promptToken = null;
        let replyMarkup = { inline_keyboard: [[{ text: '📱 Open MiniMe', web_app: { url: appUrl() } }]] };

        if (matchedRule.kind === 'feedback_prompt') {
          promptToken = crypto.randomBytes(16).toString('hex');
          replyMarkup = { inline_keyboard: [[{ text: '💬 Give feedback', web_app: { url: `${appUrl()}/?feedback_prompt=${promptToken}` } }]] };
        }

        let status = 'sent', telegramError = null;
        try {
          const r = await sendTelegramMessage(token, {
            chat_id: chatId, text, parse_mode: 'Markdown', disable_web_page_preview: true, reply_markup: replyMarkup,
          });
          if (r.ok) {
            summary.sent++;
            if (matchedRule.trigger_type === 'trial_stage') {
              const stageUpdate = { trial_warn_stage: matchedRule.trigger_config.stage_value };
              if (matchedRule.trigger_config.phase === 'expired') stageUpdate.subscription_status = 'expired';
              await sb.from('businesses').update(stageUpdate).eq('id', business.id)
                .then(() => {}, e => console.warn(`[cron/outreach-rules] trial_warn_stage write failed for ${business.id}:`, e?.message));
            }
          } else {
            summary.failed++;
            status = r.blocked ? 'blocked' : 'failed';
            telegramError = r.description || null;
            if (r.blocked) {
              const prefs = business.notification_prefs || {};
              await sb.from('businesses').update({
                notification_prefs: { ...prefs, owner_nudges: { ...(prefs.owner_nudges || {}), opted_out: true, opted_out_reason: 'telegram_blocked' } },
              }).eq('id', business.id).catch(() => {});
            }
          }
        } catch (e) {
          summary.failed++; status = 'failed'; telegramError = e.message;
        }

        const { data: sendRow } = await sb.from('outreach_sends').insert({
          business_id: business.id, source_type: 'rule', rule_id: matchedRule.id, rule_key: matchedRule.key,
          status, telegram_error: telegramError, message_preview: text.slice(0, 200),
        }).select('id').single();

        if (status === 'sent' && matchedRule.kind === 'feedback_prompt' && promptToken && sendRow) {
          await sb.from('feedback_prompts').insert({
            business_id: business.id, rule_id: matchedRule.id, outreach_send_id: sendRow.id, prompt_token: promptToken,
          }).catch(e => console.warn('[cron/outreach-rules] feedback_prompts insert failed:', e.message));
        }

        await new Promise(r => setTimeout(r, 60)); // stay under Telegram's 30/sec bot limit
      }
    }
  }

  await fireScheduledCampaigns({ sb, token, now, summary });

  console.log('[cron/outreach-rules]', JSON.stringify(summary));

  if (!dryRun && (summary.sent || summary.failed || summary.campaigns_fired)) {
    await audit({
      business_id: null, actor_type: 'system', actor_id: 'cron',
      action: 'outreach_rules.run', resource_type: 'cron', resource_id: null,
      metadata: summary, request,
    });
  }

  return NextResponse.json({ ok: true, ...summary });
}
