/**
 * Build the per-person facts a nudge is allowed to quote.
 *
 * Everything here is either a real count from the database or absent. Absent
 * is safe: copy.mjs drops any line whose number is missing or zero rather than
 * rendering "0 people".
 *
 * Failure degrades rather than skips. A person whose artifact could not be
 * built still gets the baseline message — losing the nudge entirely would be a
 * worse outcome than losing the flourish.
 */
import { supabase } from '../db';
import { draftReply } from '../replyEngine';

const NINETY_DAYS_MS = 90 * 86400000;

/** Marketplace demand — the same signal the /start sell pitch already quotes. */
async function demandCounts(sb) {
  const since = new Date(Date.now() - NINETY_DAYS_MS).toISOString();
  const [{ count: unanswered }, { count: waiting }] = await Promise.all([
    sb.from('search_logs').select('id', { count: 'exact', head: true }).eq('results_count', 0).gte('created_at', since),
    sb.from('search_waitlist').select('id', { count: 'exact', head: true }).is('notified_at', null),
  ]);
  return { unanswered: unanswered || 0, waiting: waiting || 0 };
}

/** What the assistant has actually learned, for the "ready and waiting" pitch. */
async function learnedCounts(sb, businessId) {
  const [{ count: products }, { count: facts }] = await Promise.all([
    sb.from('products').select('id', { count: 'exact', head: true }).eq('business_id', businessId),
    sb.from('documents').select('id', { count: 'exact', head: true }).eq('business_id', businessId),
  ]);
  return { products: products || 0, factCount: facts || 0 };
}

export async function buildFacts({ stage, business, telegramId }) {
  const first = (business?.owner_name || '').split(' ')[0] || null;
  const base = {
    first,
    shop: business?.name || null,
    telegramId,
  };

  const sb = supabase();
  try {
    if (stage === 'A1' || stage === 'B1') {
      return { ...base, ...(await demandCounts(sb)) };
    }

    if (stage === 'B2' || stage === 'B3') {
      // The heaviest path in the system. Bounded by the caller's daily cap and
      // by this timeout; on failure we fall through to the baseline facts and
      // copy.mjs substitutes a generic example.
      // Synthetic customer + conversation with preview: true — the same shape
      // the /preview owner command uses at replyEngine.js:3559, so no live
      // conversation or message row is ever written.
      const question = 'Do you deliver?';
      const syntheticCustomer = { id: null, name: 'Customer' };
      const syntheticConversation = { id: null, metadata: {} };
      const { draft } = await Promise.race([
        draftReply(business, syntheticCustomer, syntheticConversation, question, { isSecretary: false, preview: true }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('draft_timeout')), 20000)),
      ]);
      return { ...base, question, draft: draft || null };
    }

    if (stage === 'B4' && business?.id) {
      return { ...base, ...(await learnedCounts(sb, business.id)) };
    }
  } catch (e) {
    console.warn(`[reengage/artifacts] ${stage} artifact failed for ${telegramId}:`, e.message);
  }

  // Baseline facts on failure — never skip the person over a flourish.
  return { first, shop: business?.name || null, telegramId };
}
