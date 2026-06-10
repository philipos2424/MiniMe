/**
 * Owner Memory — cross-session business context that gets prepended to
 * every owner-bot prompt so the bot can ACT instead of asking clarifying
 * questions.
 *
 * The whole point: when the owner says "find me a branding agency", the
 * bot should already know past partners, deals, campaigns, and budget
 * patterns. No "what's your budget?" — just go.
 */
import { supabase } from './db';

const MAX_TOTAL_TOKENS = 1200;       // ~300 tokens of compacted prose
const TOP_PARTNERS = 5;
const RECENT_DEALS = 10;
const RECENT_CAMPAIGNS = 5;
const MAX_OWNER_FACTS = 30;

/**
 * Build the markdown MEMORY block injected into the owner-bot system prompt.
 * Returns a string (possibly empty if the business has no history yet).
 */
export async function loadOwnerContext(businessId) {
  if (!businessId) return '';
  const sb = supabase();

  // Fetch business once for prefs + blocklist
  const { data: biz } = await sb
    .from('businesses')
    .select('name, currency, notification_prefs, b2b_blocklist')
    .eq('id', businessId)
    .maybeSingle();

  const ownerFacts = biz?.notification_prefs?.owner_facts || [];
  const currency = biz?.currency || 'ETB';
  const blocklist = Array.isArray(biz?.b2b_blocklist) ? biz.b2b_blocklist : [];

  // Run discovery queries in parallel
  const [
    partnersByActivity,
    recentDeals,
    recentCampaigns,
    activeCampaigns,
    blockedNames,
  ] = await Promise.all([
    topPartners(businessId),
    lastDeals(businessId),
    lastCampaigns(businessId),
    openCampaigns(businessId),
    resolveBlockedNames(blocklist),
  ]);

  // Derive median budget per category from recentDeals
  const budgetByCategory = medianBudgetByCategoryFromDeals(recentDeals);

  // Assemble the markdown block
  const blocks = [];

  if (partnersByActivity.length) {
    const lines = partnersByActivity.map(p =>
      `- *${escapeFor(p.name)}*${p.username ? ` (@${p.username})` : ''}${p.category ? ` — ${p.category}` : ''} · ${p.threadCount} thread${p.threadCount === 1 ? '' : 's'}, last contact ${shortDate(p.lastAt)}`
    ).join('\n');
    blocks.push(`### TOP PARTNERS (last 90 days)\n${lines}`);
  }

  if (recentDeals.length) {
    const lines = recentDeals.slice(0, RECENT_DEALS).map(d => {
      const total = d.offer_data?.total
        ? `${Number(d.offer_data.total).toLocaleString()} ${d.offer_data?.currency || currency}`
        : 'agreed';
      const product = d.offer_data?.product || 'item';
      const partnerSide = d.partnerName ? ` ↔ ${d.partnerName}` : '';
      return `- ${shortDate(d.created_at)}: ${product}${partnerSide} — *${total}*`;
    }).join('\n');
    blocks.push(`### RECENT DEALS\n${lines}`);
  }

  if (Object.keys(budgetByCategory).length) {
    const lines = Object.entries(budgetByCategory)
      .map(([cat, med]) => `- *${cat}*: ~${Number(med).toLocaleString()} ${currency} (median of past deals)`)
      .join('\n');
    blocks.push(`### TYPICAL BUDGET BY CATEGORY (use as default if owner doesn't specify)\n${lines}`);
  }

  if (recentCampaigns.length) {
    const lines = recentCampaigns.map(c => {
      const winner = c.report?.recommendation?.winner_name;
      const status = winner ? `picked *${winner}*` : `status: ${c.status}`;
      const budget = c.budget?.max ? ` (budget ${c.budget.max} ${c.budget.currency || currency})` : '';
      return `- ${shortDate(c.created_at)}: "${escapeFor(c.query)}"${budget} — ${status}`;
    }).join('\n');
    blocks.push(`### PAST RESEARCH CAMPAIGNS\n${lines}`);
  }

  if (activeCampaigns.length) {
    const lines = activeCampaigns.map(c =>
      `- "${escapeFor(c.query)}" — ${c.reply_count || 0}/${(c.target_ids || []).length} replies so far`
    ).join('\n');
    blocks.push(`### ACTIVE CAMPAIGNS (already running, don't restart)\n${lines}`);
  }

  if (blockedNames.length) {
    blocks.push(`### BLOCKED PARTNERS (do NOT message)\n- ${blockedNames.join(', ')}`);
  }

  if (ownerFacts.length) {
    const lines = ownerFacts.slice(0, 12).map(f => `- ${f}`).join('\n');
    blocks.push(`### OWNER PREFERENCES (from past conversations)\n${lines}`);
  }

  if (!blocks.length) return '';

  let out = blocks.join('\n\n');
  // Hard cap (rough): 4 chars per token
  if (out.length > MAX_TOTAL_TOKENS * 4) {
    out = out.slice(0, MAX_TOTAL_TOKENS * 4) + '\n[truncated]';
  }
  return out;
}

/**
 * Get the median budget for a category from past completed deals.
 * Used by research_market when no explicit budget is provided.
 */
export async function medianBudgetForCategory(businessId, category) {
  if (!businessId || !category) return null;
  const sb = supabase();

  // Get all completed deals with offer_data, filter to those matching category
  const { data: deals } = await sb
    .from('business_messages')
    .select('offer_data, recipient_id, sender_id')
    .eq('thread_status', 'agreed')
    .or(`sender_id.eq.${businessId},recipient_id.eq.${businessId}`)
    .order('created_at', { ascending: false })
    .limit(50);

  if (!deals?.length) return null;

  // Resolve partner ids to get categories
  const partnerIds = [...new Set(deals.map(d => d.sender_id === businessId ? d.recipient_id : d.sender_id))];
  const { data: partners } = await sb
    .from('businesses')
    .select('id, category')
    .in('id', partnerIds);
  const catById = Object.fromEntries((partners || []).map(p => [p.id, (p.category || '').toLowerCase()]));

  const catLower = String(category).toLowerCase();
  const totals = deals
    .filter(d => {
      const partnerId = d.sender_id === businessId ? d.recipient_id : d.sender_id;
      const cat = catById[partnerId] || '';
      return cat.includes(catLower) || catLower.includes(cat);
    })
    .map(d => Number(d.offer_data?.total))
    .filter(n => Number.isFinite(n) && n > 0);

  if (totals.length < 1) return null;
  return median(totals);
}

/**
 * Extract durable owner preferences from recent owner-bot conversation history.
 * Called by the daily cron. Merges with existing owner_facts (deduplicated).
 */
export async function extractAndSaveOwnerFacts(businessId) {
  if (!businessId) return { ok: false, error: 'invalid' };
  const sb = supabase();

  const { data: biz } = await sb
    .from('businesses')
    .select('name, notification_prefs')
    .eq('id', businessId)
    .maybeSingle();
  if (!biz) return { ok: false, error: 'not_found' };

  const history = biz.notification_prefs?.owner_chat || [];
  const existingFacts = biz.notification_prefs?.owner_facts || [];

  // Owner-written messages from secretary/bot conversations (last 7 days).
  // These are the richest source of personal-life truth — what the owner
  // ACTUALLY told friends/family/customers ("yeah I went to Bole Hayat
  // yesterday"). Feeding them in here is what lets the secretary repeat real
  // experiences instead of inventing them (groundingGuard rule #3 forbids
  // claims that aren't in owner_facts or the chat history).
  let ownerWritten = [];
  try {
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const { data: msgs } = await sb
      .from('messages')
      .select('content, is_ai_generated, owner_edited, created_at')
      .eq('business_id', businessId)
      .eq('direction', 'outbound')
      .gte('created_at', weekAgo)
      .order('created_at', { ascending: false })
      .limit(300);
    ownerWritten = (msgs || [])
      .filter(m => (!m.is_ai_generated || m.owner_edited) && m.content)
      .slice(0, 80);
  } catch (e) {
    console.warn('[ownerMemory.extract] owner-written fetch failed:', e.message);
  }

  if (history.length < 4 && ownerWritten.length < 4) {
    return { ok: true, added: 0, reason: 'not_enough_history' };
  }

  const recent = history.slice(-50);
  const conversationText = [
    ...recent.map(m =>
      `${m.role === 'user' ? 'OWNER' : 'MINIME'}: ${m.content?.slice(0, 300) || ''}`
    ),
    ...ownerWritten.map(m => `OWNER (texting a contact): ${m.content.slice(0, 300)}`),
  ].join('\n');

  let newFacts = [];
  try {
    const OpenAI = (await import('openai')).default;
    const oa = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const r = await oa.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      max_tokens: 400,
      response_format: { type: 'json_object' },
      messages: [{
        role: 'user',
        content: `Extract durable facts from these messages written by a business owner — some to their AI assistant, some to real contacts (friends, family, customers).

A "durable fact" is something that should still be true next week or next month — NOT a one-off request. Two kinds matter:
1. Business preferences (budgets, suppliers, hours, what they sell)
2. Personal-life facts the owner stated about THEMSELF (places they actually went, things they tried, habits, likes/dislikes) — their AI secretary uses these to answer friends truthfully instead of inventing experiences.

GOOD examples:
- "Max budget for branding around 30k ETB"
- "Prefers fast delivery (3 days max)"
- "Doesn't work with @somecompetitor"
- "Sells coffee and pastries"
- "Open Mon-Sat 8am-8pm"
- "Studies at the café near Bole Hayat Hospital"
- "Doesn't drink alcohol"
- "Visited Hawassa in early June 2026"

BAD examples (these are one-off and should NOT be extracted):
- "Wants to message X today"
- "Asked about Y this morning"
- "Greeted the bot"
- "Said good morning to a friend"

Only extract personal facts the OWNER stated about themself — never things contacts said, and never guesses.

Return JSON: { "facts": ["short fact 1", "short fact 2"] }. Limit 10 facts.
If nothing durable, return { "facts": [] }.

CONVERSATION:
${conversationText}`,
      }],
    });
    const raw = r.choices?.[0]?.message?.content || '{}';
    const parsed = JSON.parse(raw);
    newFacts = Array.isArray(parsed.facts) ? parsed.facts : [];
  } catch (e) {
    console.warn('[ownerMemory.extract]', e.message);
    return { ok: false, error: e.message };
  }

  // Merge + dedupe (case-insensitive substring)
  const merged = [...existingFacts];
  let added = 0;
  for (const f of newFacts) {
    if (!f || typeof f !== 'string') continue;
    const trimmed = f.trim().slice(0, 200);
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();
    const dup = merged.some(e => e.toLowerCase().includes(lower) || lower.includes(e.toLowerCase()));
    if (!dup) { merged.push(trimmed); added++; }
  }

  // Cap total
  const capped = merged.slice(-MAX_OWNER_FACTS);
  const prefs = { ...(biz.notification_prefs || {}), owner_facts: capped };
  await sb.from('businesses').update({ notification_prefs: prefs }).eq('id', businessId);
  return { ok: true, added, total: capped.length };
}

/**
 * Delete a single owner fact by index (for the Settings UI).
 */
export async function deleteOwnerFact(businessId, factIndex) {
  const sb = supabase();
  const { data: biz } = await sb
    .from('businesses')
    .select('notification_prefs')
    .eq('id', businessId)
    .maybeSingle();
  const facts = biz?.notification_prefs?.owner_facts || [];
  if (factIndex < 0 || factIndex >= facts.length) return { ok: false };
  const next = [...facts.slice(0, factIndex), ...facts.slice(factIndex + 1)];
  const prefs = { ...(biz.notification_prefs || {}), owner_facts: next };
  await sb.from('businesses').update({ notification_prefs: prefs }).eq('id', businessId);
  return { ok: true, facts: next };
}

// ─── Internal data fetchers ──────────────────────────────────────────────────

async function topPartners(businessId) {
  const sb = supabase();
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString();
  const { data: msgs } = await sb
    .from('business_messages')
    .select('thread_id, sender_id, recipient_id, created_at')
    .or(`sender_id.eq.${businessId},recipient_id.eq.${businessId}`)
    .gte('created_at', ninetyDaysAgo)
    .order('created_at', { ascending: false })
    .limit(500);

  if (!msgs?.length) return [];

  // Group by partner id
  const byPartner = {};
  for (const m of msgs) {
    const partnerId = m.sender_id === businessId ? m.recipient_id : m.sender_id;
    if (!byPartner[partnerId]) byPartner[partnerId] = { id: partnerId, threadIds: new Set(), lastAt: m.created_at };
    byPartner[partnerId].threadIds.add(m.thread_id);
    if (m.created_at > byPartner[partnerId].lastAt) byPartner[partnerId].lastAt = m.created_at;
  }

  const partnerIds = Object.keys(byPartner);
  if (!partnerIds.length) return [];

  const { data: partners } = await sb
    .from('businesses')
    .select('id, name, telegram_bot_username, category')
    .in('id', partnerIds);

  const byId = Object.fromEntries((partners || []).map(p => [p.id, p]));
  return Object.values(byPartner)
    .map(p => ({
      id: p.id,
      name: byId[p.id]?.name || 'Unknown',
      username: byId[p.id]?.telegram_bot_username,
      category: byId[p.id]?.category,
      threadCount: p.threadIds.size,
      lastAt: p.lastAt,
    }))
    .sort((a, b) => b.threadCount - a.threadCount || new Date(b.lastAt) - new Date(a.lastAt))
    .slice(0, TOP_PARTNERS);
}

async function lastDeals(businessId) {
  const sb = supabase();
  const { data: deals } = await sb
    .from('business_messages')
    .select('id, sender_id, recipient_id, offer_data, created_at')
    .eq('thread_status', 'agreed')
    .or(`sender_id.eq.${businessId},recipient_id.eq.${businessId}`)
    .order('created_at', { ascending: false })
    .limit(RECENT_DEALS);
  if (!deals?.length) return [];

  const partnerIds = [...new Set(deals.map(d => d.sender_id === businessId ? d.recipient_id : d.sender_id))];
  const { data: partners } = await sb
    .from('businesses')
    .select('id, name, category')
    .in('id', partnerIds);
  const byId = Object.fromEntries((partners || []).map(p => [p.id, p]));
  return deals.map(d => {
    const partnerId = d.sender_id === businessId ? d.recipient_id : d.sender_id;
    return { ...d, partnerName: byId[partnerId]?.name, partnerCategory: byId[partnerId]?.category };
  });
}

async function lastCampaigns(businessId) {
  const sb = supabase();
  const { data } = await sb
    .from('research_campaigns')
    .select('query, budget, status, report, created_at')
    .eq('business_id', businessId)
    .in('status', ['complete', 'cancelled'])
    .order('created_at', { ascending: false })
    .limit(RECENT_CAMPAIGNS);
  return data || [];
}

async function openCampaigns(businessId) {
  const sb = supabase();
  const { data } = await sb
    .from('research_campaigns')
    .select('query, target_ids, reply_count, created_at')
    .eq('business_id', businessId)
    .in('status', ['open', 'reporting'])
    .order('created_at', { ascending: false })
    .limit(5);
  return data || [];
}

async function resolveBlockedNames(blocklist) {
  if (!Array.isArray(blocklist) || !blocklist.length) return [];
  // blocklist stores owner_telegram_ids — look up the businesses owned by them
  const sb = supabase();
  const { data } = await sb
    .from('businesses')
    .select('name, telegram_bot_username')
    .in('owner_telegram_id', blocklist.map(Number));
  return (data || []).map(b => b.telegram_bot_username ? `@${b.telegram_bot_username}` : b.name).filter(Boolean);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function medianBudgetByCategoryFromDeals(deals) {
  const byCat = {};
  for (const d of deals || []) {
    const cat = (d.partnerCategory || '').trim();
    const total = Number(d.offer_data?.total);
    if (!cat || !Number.isFinite(total) || total <= 0) continue;
    if (!byCat[cat]) byCat[cat] = [];
    byCat[cat].push(total);
  }
  const out = {};
  for (const [cat, totals] of Object.entries(byCat)) {
    if (totals.length >= 1) out[cat] = median(totals);
  }
  return out;
}

function median(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function shortDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  } catch { return ''; }
}

function escapeFor(s) {
  // Light escaping for Markdown system-prompt safety
  return String(s || '').replace(/[\n\r]+/g, ' ').slice(0, 200);
}
