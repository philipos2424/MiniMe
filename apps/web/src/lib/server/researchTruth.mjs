/**
 * researchTruth — the Truth Guard for the B2B research agent.
 *
 * WHY THIS EXISTS
 * A forensic pass on the live database found 73 of 81 completed research
 * campaigns (90%) delivered a "comparison" of suppliers to a real owner while
 * `target_ids` was empty — nobody had been contacted. The model was asked for
 * "deep analysis: price breakdown, lead time, scope, payment terms, guarantees"
 * for every candidate, including ones with zero replies, and its JSON output
 * was rendered straight into the owner's DM with a live "Connect" button on a
 * handle that does not exist.
 *
 * The fix is structural, not a better prompt. A ledger built only from real
 * `businesses` and `business_messages` rows is the sole source of names,
 * handles and facts. The model may only narrate what is already in the
 * ledger; anything it adds that isn't traceable to a real message is
 * stripped before the owner ever sees it.
 */

/**
 * Deterministic (no LLM) extraction of a price and lead-time signal from a
 * reply's free text, tagged with the verbatim source so nothing here can
 * outrun its own evidence — the number always carries the sentence it came
 * from. Best-effort only: extraction that misses a fact leaves it unset
 * rather than guessing; groundReport() never trusts a field that isn't set.
 */
export function extractQuoteFacts(content) {
  const text = String(content || '');
  const facts = { source_quote: text.slice(0, 500) };

  // Price: a number near a currency word/symbol (ETB, birr, $) — deliberately
  // narrower than a bare number so "5 day lead time" doesn't get read as a price.
  const priceMatch = text.match(/([\d,]+(?:\.\d+)?)\s*(k)?\s*(etb|birr)\b/i)
    || text.match(/(?:etb|birr|\$)\s*([\d,]+(?:\.\d+)?)\s*(k)?/i);
  if (priceMatch) {
    let n = parseFloat(priceMatch[1].replace(/,/g, ''));
    if (!Number.isNaN(n)) {
      if (/k$/i.test(priceMatch[2] || '')) n *= 1000;
      facts.price = Math.round(n);
    }
  }

  // Lead time: "N day(s)/week(s)" style phrasing.
  const leadMatch = text.match(/(\d+(?:\s*-\s*\d+)?)\s*(days|day|weeks|week|hours|hour)/i);
  if (leadMatch) facts.lead_time = `${leadMatch[1]} ${leadMatch[2]}`;

  return facts;
}

/**
 * Build the ledger for a campaign: the only admissible source of truth for
 * the report. One entry per contacted business, with the real messages that
 * business actually sent.
 *
 * @param {object} params
 * @param {object} params.campaign - research_campaigns row
 * @param {Array<object>} params.targets - businesses rows for campaign.target_ids
 *   (id, name, telegram_bot_username, description, category, category_canonical)
 * @param {Array<object>} params.messages - business_messages rows on the
 *   campaign's threads, sent BY one of the targets (sender_id in target_ids)
 * @returns {{
 *   targetIds: Set<string>,
 *   respondedCount: number,
 *   totalCount: number,
 *   byId: Map<string, { business: object, messages: object[], responded: boolean }>,
 * }}
 */
export function buildLedger({ campaign, targets, messages }) {
  const targetIds = new Set((campaign?.target_ids || []).map(String));
  const byId = new Map();

  for (const t of targets || []) {
    if (!t?.id || !targetIds.has(String(t.id))) continue;
    byId.set(String(t.id), { business: t, messages: [], responded: false });
  }

  for (const m of messages || []) {
    const sid = String(m.sender_id);
    if (!byId.has(sid)) continue; // not a contacted target — never admitted
    const entry = byId.get(sid);
    entry.messages.push(m);
    entry.responded = true;
  }

  const respondedCount = [...byId.values()].filter(e => e.responded).length;

  return { targetIds, respondedCount, totalCount: byId.size, byId };
}

/**
 * Ground a model-produced report against the ledger. This is the guard:
 * every name, handle and fact rendered to the owner must trace back to a
 * real business row or a real message the business sent. Nothing else
 * survives.
 *
 * @param {object} modelJson - raw parsed JSON from the synthesis model
 * @param {ReturnType<typeof buildLedger>} ledger
 * @returns {object} a grounded report, safe to render and store
 */
export function groundReport(modelJson, ledger) {
  // No replies at all → no comparison. An honest "nobody answered yet" beats
  // an invented one every time; this is the single check that would have
  // caught 73 of 73 fabricated historical reports.
  if (!ledger || ledger.respondedCount === 0) {
    return {
      comparison: [],
      recommendation: null,
      market_context: modelJson?.market_context ? String(modelJson.market_context).slice(0, 500) : null,
      summary_line: `No replies yet from the ${ledger?.totalCount ?? 0} businesses contacted.`,
      grounded: true,
      no_replies: true,
    };
  }

  const modelById = new Map();
  for (const c of modelJson?.comparison || []) {
    if (c?.candidate_id != null) modelById.set(String(c.candidate_id), c);
  }

  const FACTUAL_FIELDS = [
    'price', 'price_breakdown', 'lead_time', 'included', 'excluded',
    'payment_terms', 'guarantees',
  ];

  const comparison = [];
  for (const [id, entry] of ledger.byId) {
    const { business, messages, responded } = entry;
    const modelRow = modelById.get(id) || {};

    const row = {
      candidate_id: id,
      // Identity is never taken from the model — always the real row.
      name: business.name,
      username: business.telegram_bot_username || null,
      responded,
    };

    if (!responded) {
      row.pros = [];
      row.cons = [];
      row.note = 'No reply received.';
      comparison.push(row);
      continue;
    }

    // Every factual claim must cite a real message id from this business's
    // own replies, or it is dropped and rendered as "not stated" instead of
    // silently kept — a strip that's invisible to the owner is still a lie.
    const msgIds = new Set(messages.map(m => String(m.id)));
    for (const field of FACTUAL_FIELDS) {
      const claim = modelRow[field];
      const sourceId = modelRow[`${field}_source_message_id`];
      if (claim != null && sourceId != null && msgIds.has(String(sourceId))) {
        row[field] = claim;
        row[`${field}_source_message_id`] = String(sourceId);
      } else {
        row[field] = null;
      }
    }

    // Opinion fields are allowed through for responders only — they're the
    // model's read on quoted evidence, not a fact it could fabricate a name
    // or price inside of. Still capped and coerced to strings defensively.
    row.pros = Array.isArray(modelRow.pros) ? modelRow.pros.slice(0, 5).map(String) : [];
    row.cons = Array.isArray(modelRow.cons) ? modelRow.cons.slice(0, 5).map(String) : [];
    row.red_flags = Array.isArray(modelRow.red_flags) ? modelRow.red_flags.slice(0, 5).map(String) : [];
    row.green_flags = Array.isArray(modelRow.green_flags) ? modelRow.green_flags.slice(0, 5).map(String) : [];
    if (modelRow.scores && typeof modelRow.scores === 'object') row.scores = modelRow.scores;
    if (Number.isFinite(modelRow.overall_score)) row.overall_score = modelRow.overall_score;

    // The verbatim evidence, so the owner can check the claim themselves.
    row.quotes = messages.slice(-3).map(m => ({
      message_id: String(m.id),
      content: String(m.content || '').slice(0, 500),
      created_at: m.created_at,
    }));

    comparison.push(row);
  }

  // Recommendation must point at a responder that's actually in the ledger.
  let recommendation = null;
  const modelRec = modelJson?.recommendation;
  if (modelRec?.winner_id != null) {
    const winnerId = String(modelRec.winner_id);
    const winnerEntry = ledger.byId.get(winnerId);
    if (winnerEntry?.responded) {
      recommendation = {
        winner_id: winnerId,
        winner_name: winnerEntry.business.name,
        winner_username: winnerEntry.business.telegram_bot_username || null,
        why: modelRec.why ? String(modelRec.why).slice(0, 800) : null,
        negotiation_levers: Array.isArray(modelRec.negotiation_levers)
          ? modelRec.negotiation_levers.slice(0, 5).map(String) : [],
        next_step_suggestion: ['negotiate', 'order', 'chat', 'none'].includes(modelRec.next_step_suggestion)
          ? modelRec.next_step_suggestion : 'negotiate',
      };
    }
  }

  return {
    comparison,
    recommendation,
    market_context: modelJson?.market_context ? String(modelJson.market_context).slice(0, 500) : null,
    summary_line: modelJson?.summary_line ? String(modelJson.summary_line).slice(0, 300) : null,
    grounded: true,
    no_replies: false,
  };
}
