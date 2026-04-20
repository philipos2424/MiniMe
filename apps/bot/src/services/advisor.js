const OpenAI = require('openai');
const { findByBusiness: findConversations } = require('../../../../packages/db/queries/conversations');
const { getRecentMessages } = require('../../../../packages/db/queries/messages');
const { update: updateBusiness } = require('../../../../packages/db/queries/businesses');
const { findByBusiness: findTasks } = require('../../../../packages/db/queries/tasks');
const { listForBusiness: listCustomerMemory } = require('../../../../packages/db/queries/customerMemory');
const { parseWhen, createReminder, createFollowUp } = require('./scheduler');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MAX_MEMORY_TURNS = 20;
const MAX_LIVE_CONVOS = 12;
const MAX_MSGS_PER_CONVO = 6;

/**
 * MiniMe Advisor — a live client triage copilot for the owner.
 * Knows every active conversation, who's waiting, who's high-value,
 * and remembers what the owner has previously asked/decided.
 */
async function askAdvisor(business, question) {
  try {
    // Pull active conversations with customer info
    const conversations = await findConversations(business.id, { limit: MAX_LIVE_CONVOS });

    // Pull recent messages for each
    const threads = await Promise.all(
      (conversations || []).map(async (c) => {
        const msgs = await getRecentMessages(c.id, MAX_MSGS_PER_CONVO).catch(() => []);
        return { conv: c, msgs: (msgs || []).reverse() };
      })
    );

    const now = Date.now();
    const threadBlock = threads.map(({ conv, msgs }, i) => {
      const cust = conv.customers || {};
      const last = conv.last_message_at ? new Date(conv.last_message_at).getTime() : null;
      const ageMin = last ? Math.round((now - last) / 60000) : null;
      const ageStr = ageMin == null ? 'n/a'
        : ageMin < 60 ? `${ageMin}m ago`
        : ageMin < 1440 ? `${Math.round(ageMin / 60)}h ago`
        : `${Math.round(ageMin / 1440)}d ago`;

      const msgLines = msgs.map(m =>
        `    [${m.direction === 'inbound' ? 'CUSTOMER' : 'YOU/AI'}] ${(m.content || '').slice(0, 180)}`
      ).join('\n');

      return `
[Thread ${i + 1}]
  Customer: ${cust.name || cust.telegram_username || 'Unknown'}${cust.tier ? ` (${cust.tier})` : ''}
  Spent: ${cust.total_spent || 0} ETB · ${cust.order_count || 0} orders · last seen ${ageStr}
  Status: ${conv.status || 'active'}${conv.requires_owner ? ' · ⚠️ needs your reply' : ''}${conv.priority === 'urgent' ? ' · 🚨 URGENT' : ''}
  Last AI action: ${conv.last_ai_action || '—'}
  Recent messages:
${msgLines || '    (no messages)'}`.trim();
    }).join('\n\n');

    // Upcoming scheduled tasks (next 7 days)
    const allTasks = await findTasks(business.id, { status: 'scheduled', limit: 30 }).catch(() => []);
    const soon = allTasks
      .filter(t => t.scheduled_at && new Date(t.scheduled_at) > new Date() && new Date(t.scheduled_at) < new Date(Date.now() + 7 * 86400000))
      .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))
      .slice(0, 10);
    const scheduleBlock = soon.length
      ? soon.map(t => `- ${new Date(t.scheduled_at).toISOString().slice(0, 16).replace('T', ' ')} UTC [${t.type}] ${t.description || ''}`).join('\n')
      : '(nothing scheduled)';

    // Per-customer memory (top recent across the business)
    const custMem = await listCustomerMemory(business.id, 40).catch(() => []);
    const memoryByCust = {};
    for (const m of custMem) {
      memoryByCust[m.customer_id] = memoryByCust[m.customer_id] || [];
      memoryByCust[m.customer_id].push(`(${m.kind}) ${m.content}`);
    }
    const customerMemBlock = Object.keys(memoryByCust).length
      ? Object.entries(memoryByCust).slice(0, 10).map(([cid, items]) => `- customer ${cid.slice(0, 8)}: ${items.slice(0, 3).join('; ')}`).join('\n')
      : '(no per-customer notes yet)';

    const memory = Array.isArray(business.advisor_memory) ? business.advisor_memory : [];
    const memoryMessages = memory.slice(-MAX_MEMORY_TURNS).flatMap(t => [
      { role: 'user', content: t.q },
      { role: 'assistant', content: t.a },
    ]);

    const system = `You are MiniMe's Advisor — a private AI copilot for ${business.owner_name || 'the owner'} who runs "${business.name}"${business.category ? `, a ${business.category}` : ''}${business.location ? ` in ${business.location}` : ''}.

Your job: help them triage live customer conversations. You have full visibility into every active thread. Be specific, direct, and ACTIONABLE. Reply in whatever language the owner uses (English or Amharic).

Rules:
- Always reference customers by name and thread number (e.g. "Alem in Thread 3").
- When asked "who should I prioritize", rank them and explain WHY (VIP + urgent + waiting long = top).
- When asked "what should I say to X", suggest a short draft in the owner's voice.
- Remember what the owner has already asked or decided — don't repeat yourself.
- If there's nothing pressing, say so plainly. Don't manufacture urgency.
- Keep answers under ~8 sentences unless asked for detail.

# LIVE CLIENT THREADS (${threads.length})
${threadBlock || '(No active conversations right now.)'}

# UPCOMING SCHEDULE (next 7 days)
${scheduleBlock}

# WHAT YOU KNOW ABOUT SPECIFIC CUSTOMERS
${customerMemBlock}

# BUSINESS SNAPSHOT
- Trust: ${business.trust_level} · Panic: ${business.panic_mode ? 'ON' : 'OFF'}
- Current time: ${new Date().toISOString()}

Scheduling: if the owner asks you to remind them or schedule something, propose a clear plan like "I'll set a reminder for <time> to <action>" — they can then run /remind <when> | <what> to confirm.`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.5,
      max_tokens: 500,
      messages: [
        { role: 'system', content: system },
        ...memoryMessages,
        { role: 'user', content: question },
      ],
    });

    const answer = response.choices[0]?.message?.content?.trim() || 'Sorry, I could not generate advice right now.';

    // Persist to memory (keep last MAX_MEMORY_TURNS)
    const nextMemory = [...memory, { q: question, a: answer, ts: new Date().toISOString() }].slice(-MAX_MEMORY_TURNS);
    await updateBusiness(business.id, { advisor_memory: nextMemory }).catch(e => console.warn('Advisor memory save failed:', e.message));

    return answer;
  } catch (err) {
    console.error('Advisor error:', err);
    return 'Sorry, I could not reach my brain right now. Try again in a moment.';
  }
}

async function resetAdvisorMemory(business) {
  await updateBusiness(business.id, { advisor_memory: [] });
}

module.exports = { askAdvisor, resetAdvisorMemory };
