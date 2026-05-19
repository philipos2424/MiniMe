/**
 * Owner-side commands for the Telegram bot.
 *
 * The owner DMs their own MiniMe-linked bot. Alfred recognises the owner
 * and can:
 *   - List pending orders + jobs (/orders), customers (/customers), team (/team)
 *   - DM a specific client (/dm <name> <msg>) or fan out to all clients
 *   - Interpret free-form prompts ("DM Sara, schedule a meeting Friday")
 *
 * Multi-turn memory: the last ~12 turns of the owner↔Alfred chat are persisted
 * to businesses.notification_prefs.owner_chat and replayed into each prompt,
 * so pronouns and references work ("How about Yabi" → "tell her urgent").
 */
import OpenAI from 'openai';
import { MODEL } from './constants';
import { supabase } from './db';
import { tg } from './telegramApi';
import { customerMention, supplierMention } from './mentions';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'sk-build-placeholder' });

// ────────────────────────────── /orders ──────────────────────────────
export async function listOwnerOrders(businessId) {
  const sb = supabase();
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();

  const [{ data: orders }, { data: jobs }] = await Promise.all([
    sb.from('orders').select('id, status, total, currency, created_at, customer_id, customers(name, telegram_username)')
      .eq('business_id', businessId)
      .in('status', ['pending_payment', 'paid'])
      .gte('created_at', sevenDaysAgo)
      .order('created_at', { ascending: false })
      .limit(15),
    sb.from('jobs').select('id, title, status, current_step, budget, currency, customer_id, customers(name)')
      .eq('business_id', businessId)
      .in('status', ['draft', 'active', 'awaiting_approval', 'blocked'])
      .order('created_at', { ascending: false })
      .limit(15),
  ]);

  const lines = ['🛒 *Pending orders & jobs*'];
  if (!orders?.length && !jobs?.length) {
    lines.push('\n_No active orders or jobs in the last 7 days._');
    return lines.join('\n');
  }

  if (orders?.length) {
    lines.push('\n*Orders*');
    for (const o of orders) {
      const name = o.customers?.name || (o.customers?.telegram_username ? `@${o.customers.telegram_username}` : 'unknown');
      const stat = o.status === 'paid' ? '✅ paid' : '⏳ awaiting payment';
      lines.push(`• ${name} — ${Number(o.total).toLocaleString()} ${o.currency || 'ETB'} · ${stat}`);
    }
  }
  if (jobs?.length) {
    lines.push('\n*Jobs in flight*');
    for (const j of jobs) {
      const name = j.customers?.name || 'unknown';
      const budget = j.budget ? ` · ${Number(j.budget).toLocaleString()} ${j.currency || 'ETB'}` : '';
      lines.push(`• ${name} — _${j.title}_${budget} · step ${j.current_step ?? 0} · ${j.status}`);
    }
  }
  return lines.join('\n');
}

// ────────────────────────────── /sales ──────────────────────────────
export async function listOwnerSales(businessId) {
  const sb = supabase();
  const now = Date.now();
  // Ethiopia Standard Time = UTC+3 — align "today" with local midnight
  const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;
  const nowEAT = new Date(now + EAT_OFFSET_MS);
  nowEAT.setUTCHours(0, 0, 0, 0);
  const todayStart = new Date(nowEAT.getTime() - EAT_OFFSET_MS).toISOString();
  const weekAgo = new Date(now - 7 * 86400000).toISOString();
  const monthAgo = new Date(now - 30 * 86400000).toISOString();

  const [{ data: todayOrders }, { data: weekOrders }, { data: monthOrders }, { data: pending }] = await Promise.all([
    sb.from('orders').select('total, currency, items').eq('business_id', businessId).eq('status', 'paid').gte('paid_at', todayStart),
    sb.from('orders').select('total, currency, items, paid_at').eq('business_id', businessId).eq('status', 'paid').gte('paid_at', weekAgo).order('paid_at', { ascending: false }),
    sb.from('orders').select('total, currency').eq('business_id', businessId).eq('status', 'paid').gte('paid_at', monthAgo),
    sb.from('orders').select('id, total, currency, created_at, customers(name)').eq('business_id', businessId).eq('status', 'pending_payment').gte('created_at', weekAgo).order('created_at', { ascending: false }).limit(5),
  ]);

  const sum = (rows) => (rows || []).reduce((acc, r) => acc + Number(r.total || 0), 0);
  const todayTotal = sum(todayOrders);
  const weekTotal = sum(weekOrders);
  const monthTotal = sum(monthOrders);
  const currency = weekOrders?.[0]?.currency || 'ETB';

  const lines = ['💰 *Sales summary*', ''];
  lines.push(`📅 Today: *${todayTotal.toLocaleString()} ${currency}* (${todayOrders?.length || 0} order${(todayOrders?.length || 0) === 1 ? '' : 's'})`);
  lines.push(`📆 Last 7 days: *${weekTotal.toLocaleString()} ${currency}* (${weekOrders?.length || 0} order${(weekOrders?.length || 0) === 1 ? '' : 's'})`);
  lines.push(`🗓 Last 30 days: *${monthTotal.toLocaleString()} ${currency}* (${monthOrders?.length || 0} order${(monthOrders?.length || 0) === 1 ? '' : 's'})`);

  // Daily breakdown for the last 7 days
  if (weekOrders?.length) {
    const byDay = {};
    for (const o of weekOrders) {
      const d = (o.paid_at || '').slice(0, 10);
      if (!byDay[d]) byDay[d] = { total: 0, count: 0 };
      byDay[d].total += Number(o.total || 0);
      byDay[d].count++;
    }
    const days = Object.keys(byDay).sort().reverse().slice(0, 7);
    if (days.length > 1) {
      lines.push('\n*Daily breakdown*');
      for (const d of days) {
        const label = new Date(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
        lines.push(`• ${label}: ${byDay[d].total.toLocaleString()} ${currency} · ${byDay[d].count} order${byDay[d].count === 1 ? '' : 's'}`);
      }
    }
  }

  // Pending unpaid orders
  if (pending?.length) {
    lines.push('\n⏳ *Awaiting payment*');
    for (const o of pending) {
      const name = o.customers?.name || 'Customer';
      lines.push(`• ${name} — ${Number(o.total || 0).toLocaleString()} ${o.currency || 'ETB'}`);
    }
  }

  return lines.join('\n');
}

// ────────────────────────────── /stock ──────────────────────────────
export async function listOwnerStock(businessId) {
  const sb = supabase();
  const { data: products } = await sb.from('products')
    .select('id, name, stock_quantity, low_stock_threshold, price, currency, is_active')
    .eq('business_id', businessId)
    .eq('is_active', true)
    .order('stock_quantity', { ascending: true })
    .limit(50);

  if (!products?.length) return '_No products in your catalog yet. Add some in the Mini App → Products._';

  const DEFAULT_THRESHOLD = 10;
  const outOfStock = products.filter(p => (p.stock_quantity ?? 0) <= 0);
  const lowStock = products.filter(p => {
    const qty = p.stock_quantity ?? 0;
    const thresh = p.low_stock_threshold ?? DEFAULT_THRESHOLD;
    return qty > 0 && qty <= thresh;
  });
  const inStock = products.filter(p => {
    const qty = p.stock_quantity ?? 0;
    const thresh = p.low_stock_threshold ?? DEFAULT_THRESHOLD;
    return qty > thresh;
  });

  const lines = ['📦 *Inventory status*', ''];

  if (outOfStock.length) {
    lines.push(`🚨 *Out of stock (${outOfStock.length})*`);
    for (const p of outOfStock) {
      lines.push(`• ${p.name} — 0 left`);
    }
    lines.push('');
  }

  if (lowStock.length) {
    lines.push(`⚠️ *Low stock (${lowStock.length})*`);
    for (const p of lowStock) {
      lines.push(`• ${p.name} — *${p.stock_quantity}* left`);
    }
    lines.push('');
  }

  if (inStock.length) {
    lines.push(`✅ *In stock (${inStock.length})*`);
    for (const p of inStock.slice(0, 15)) {
      const priceStr = p.price ? ` · ${Number(p.price).toLocaleString()} ${p.currency || 'ETB'}` : '';
      lines.push(`• ${p.name} — ${p.stock_quantity ?? '?'} units${priceStr}`);
    }
    if (inStock.length > 15) lines.push(`  _…and ${inStock.length - 15} more_`);
  }

  const totalItems = products.reduce((s, p) => s + (p.stock_quantity ?? 0), 0);
  lines.push(`\n_Total tracked: ${totalItems.toLocaleString()} units across ${products.length} products_`);

  return lines.join('\n');
}

// ────────────────────────────── /dm ──────────────────────────────
async function findCustomerByQuery(businessId, q) {
  const sb = supabase();
  const handle = q.replace(/^@/, '').toLowerCase();
  const { data } = await sb.from('customers')
    .select('id, name, telegram_id, telegram_username')
    .eq('business_id', businessId)
    .or(`name.ilike.%${q}%,telegram_username.ilike.%${handle}%`)
    .order('last_active_at', { ascending: false })
    .limit(3);
  return data?.[0] || null;
}

export async function ownerDmClient(token, business, after) {
  if (!after) {
    return 'Usage:\n`/dm <client name> <message>`\n\nExample:\n`/dm Sara your design draft is ready, want to take a look?`';
  }
  // First whitespace-separated token = client query (or @handle); rest = message
  const m = after.match(/^(@?\S+)\s+([\s\S]+)/);
  if (!m) return "I need both a client name and a message. Try `/dm Sara hey, your card draft is ready`.";
  const [, queryRaw, message] = m;

  const customer = await findCustomerByQuery(business.id, queryRaw);
  if (!customer) return `❌ I don't see a customer matching "${queryRaw}". Try part of their name, or check your /customers list.`;
  if (!customer.telegram_id) return `❌ ${customer.name} has no Telegram ID on file — I can't DM them.`;

  await tg(token, 'sendMessage', { chat_id: customer.telegram_id, text: message });

  const sb = supabase();
  // Save outbound message in the conversation
  const { data: conv } = await sb.from('conversations')
    .select('id').eq('business_id', business.id).eq('customer_id', customer.id).order('last_message_at', { ascending: false }).limit(1).maybeSingle();
  if (conv) {
    await sb.from('messages').insert({
      conversation_id: conv.id, business_id: business.id, customer_id: customer.id,
      direction: 'outbound', content: message, content_type: 'text', status: 'sent',
      is_ai_generated: false, telegram_chat_id: customer.telegram_id, sent_at: new Date().toISOString(),
    });
  }
  return `✅ Sent to *${customer.name || '@' + customer.telegram_username}*.`;
}

// ────────────────────────────── DM team member(s) ──────────────────────────────
const TEAM_ROLES = ['designer', 'printer', 'delivery', 'photographer', 'writer', 'installer', 'catering', 'other'];

export async function ownerDmTeam(token, business, target, message) {
  if (!target || !message) return 'Need both a target and a message.';
  const sb = supabase();
  const t = target.trim().toLowerCase().replace(/^@/, '');

  let suppliers = [];
  if (t === 'team' || t === 'everyone' || t === 'all') {
    const { data } = await sb.from('suppliers')
      .select('id, name, role, contact_telegram')
      .eq('business_id', business.id).eq('is_active', true);
    suppliers = data || [];
  } else if (TEAM_ROLES.includes(t)) {
    const { data } = await sb.from('suppliers')
      .select('id, name, role, contact_telegram')
      .eq('business_id', business.id).eq('is_active', true).eq('role', t);
    suppliers = data || [];
  } else {
    // Try name or telegram_username match
    const { data } = await sb.from('suppliers')
      .select('id, name, role, contact_telegram, telegram_username')
      .eq('business_id', business.id).eq('is_active', true)
      .or(`name.ilike.%${target}%,telegram_username.ilike.%${t}%`);
    suppliers = data || [];
  }

  const dmAble = suppliers.filter(s => s.contact_telegram);
  if (!suppliers.length) return `❌ No team member matches "${target}". Add them in /agent/team first.`;
  if (!dmAble.length) return `❌ Found ${suppliers.length} match${suppliers.length > 1 ? 'es' : ''} (${suppliers.map(s => s.name).join(', ')}) but none has a Telegram ID. Add their numeric Telegram ID in /agent/team.`;

  let sent = 0;
  for (const s of dmAble) {
    try {
      await tg(token, 'sendMessage', { chat_id: s.contact_telegram, text: message });
      sent++;
    } catch {}
  }
  return `✅ Sent to ${dmAble.map(s => `*${s.name}*`).join(', ')} (${sent}/${dmAble.length}).`;
}

// ────────────────────────────── Free-form owner prompt ──────────────────────────────
const OWNER_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'dm_client',
      description: "Send a Telegram message to a CUSTOMER (someone who buys from the owner). Use when the owner says 'DM <name>', 'tell <name>', 'message <name>', 'follow up with <name>'.",
      parameters: {
        type: 'object',
        properties: {
          client_query: { type: 'string', description: "The client's name or @handle as the owner referred to them." },
          message: { type: 'string', description: 'The message text to send. Write it in the owner\'s voice — warm and professional.' },
        },
        required: ['client_query', 'message'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'dm_team_member',
      description: "Send a Telegram message to a TEAM MEMBER / supplier (designer, printer, delivery person — someone who works WITH the owner). Use when the owner says 'text my team', 'tell my designer', 'message the printer', 'brief Yared', 'follow up with delivery'. If the owner names a role (e.g. 'my designer'), pass that as the role. If they name a person, pass the name. If they say 'team' generally, pass 'team' and the message will go to all active team members.",
      parameters: {
        type: 'object',
        properties: {
          target: { type: 'string', description: 'Role (designer/printer/delivery/photographer/etc), name, "team" for everyone, or @handle.' },
          message: { type: 'string', description: 'The brief or message to send.' },
        },
        required: ['target', 'message'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'summarize_orders',
      description: 'List the owner\'s pending orders and active jobs. Use when the owner asks "what orders do I have", "any orders", "what\'s pending", "show me what\'s open".',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ask_advisor',
      description: 'Forward a strategic / analytical question to the Advisor (which has full business context). Use for "who should I focus on", "which deals am I losing", "how is my response time", general business questions.',
      parameters: {
        type: 'object',
        properties: { question: { type: 'string' } },
        required: ['question'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'dm_all_clients',
      description: "Broadcast a message to MULTIPLE customers at once. Use when the owner says 'message all clients', 'tell everyone', 'broadcast', 'send to all customers', 'message my regulars'. Filter optional: 'all' (default), 'recent' (active in last 30 days), 'vip' (tier=vip), 'regular' (tier=regular).",
      parameters: {
        type: 'object',
        properties: {
          filter: { type: 'string', enum: ['all', 'recent', 'vip', 'regular'], description: 'Which slice of clients to message. Default "all".' },
          message: { type: 'string', description: 'The message to send. Same text goes to everyone.' },
          confirm: { type: 'boolean', description: 'If false (default), the tool returns the count and asks the owner to confirm. If true, sends immediately.' },
        },
        required: ['message'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_customers',
      description: "Show the owner a list of their customers (with linked accounts). Use for 'who are my clients', 'show customers', '/customers', 'list my regulars'.",
      parameters: {
        type: 'object',
        properties: {
          filter: { type: 'string', enum: ['all', 'recent', 'vip', 'regular'] },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_team',
      description: "Show the owner their team / suppliers. Use for 'who's on my team', 'show team', '/team', 'my designers', 'list my staff'.",
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_reminder',
      description: "Set a reminder that DMs the owner at a specific time. Use when the owner says 'remind me at <time> to <task>', 'in 2 hours remind me…', 'tomorrow at 3pm tell me to call Sara'. Resolve relative phrases against today.",
      parameters: {
        type: 'object',
        properties: {
          due_iso: { type: 'string', description: 'When to fire the reminder, ISO datetime (YYYY-MM-DDTHH:MM:SS).' },
          text: { type: 'string', description: 'What to remind the owner about. One short line.' },
        },
        required: ['due_iso', 'text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_reminders',
      description: "List the owner's pending reminders. Use for 'what reminders do I have', 'show my reminders', '/reminders'.",
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_sales',
      description: "Show the owner a sales revenue summary (today, 7-day, 30-day totals plus daily breakdown). Use for 'how are my sales', 'what did I make today', 'show me revenue', 'sales summary', '/sales', 'how much did I earn this week'.",
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_stock',
      description: "Show the owner their inventory / stock levels. Use for 'what's in stock', 'check inventory', 'low stock', 'stock levels', '/stock', 'what products are running out'.",
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_product_price',
      description: "Update a product's price. Use when the owner says 'change price of X to Y', 'update X price to Y birr', 'set X to Y ETB', 'price for X is now Y'. Extract the product name and new price clearly.",
      parameters: {
        type: 'object',
        properties: {
          product_name: { type: 'string', description: "The product name as the owner refers to it." },
          new_price: { type: 'number', description: 'The new price in ETB (or the business currency).' },
        },
        required: ['product_name', 'new_price'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_product_stock',
      description: "Set or adjust a product's stock level. Use when the owner says 'received 50 injera', 'add 100 to coffee stock', 'we have 200 left', 'restock X to Y', 'update stock for X'. is_relative=true for additive (+/-); false for absolute set.",
      parameters: {
        type: 'object',
        properties: {
          product_name: { type: 'string', description: "The product name." },
          quantity: { type: 'number', description: 'The quantity. Positive to add, negative to remove (only when is_relative=true).' },
          is_relative: { type: 'boolean', description: 'true = add/subtract from current; false = set to this exact value.' },
        },
        required: ['product_name', 'quantity', 'is_relative'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'message_other_business',
      description: 'Send a message or start a negotiation with ANOTHER business\'s bot on MiniMe. Use when the owner says things like "ask @somebot if they have X", "negotiate with @supplier for 20kg coffee at max 40k ETB", "tell @supplier_bot to deliver tomorrow", "order 50 bags from @flourshop_bot", or any phrase that involves contacting another business via their @bot_username. For negotiations, set negotiate:true and include limits.',
      parameters: {
        type: 'object',
        properties: {
          target_username: { type: 'string', description: 'The other bot\'s @username (with or without @). Required.' },
          intent:          { type: 'string', enum: ['inquiry','order','coordination','chat'], description: 'inquiry=asking a question, order=placing an order, coordination=logistics, chat=general' },
          message:         { type: 'string', description: 'Plain-English message to send to the other business.' },
          structured: {
            type: 'object',
            description: 'Optional structured fields. Pass only if clearly stated by owner.',
            properties: {
              product:  { type: 'string' },
              qty:      { type: 'number' },
              unit:     { type: 'string' },
              urgency:  { type: 'string' },
              deadline: { type: 'string' },
            },
          },
          negotiate: {
            type: 'boolean',
            description: 'Set true if the owner wants the AI to auto-negotiate back-and-forth on their behalf.',
          },
          limits: {
            type: 'object',
            description: 'Negotiation limits if negotiate=true. E.g. max_budget_buy, min_sell_price, max_discount_pct, max_qty_sell.',
            properties: {
              max_budget_buy:    { type: 'number', description: 'Maximum total amount willing to pay (buyer).' },
              min_sell_price:    { type: 'number', description: 'Minimum price per unit willing to accept (seller).' },
              max_discount_pct:  { type: 'number', description: 'Max % discount to offer.' },
              max_qty_sell:      { type: 'number', description: 'Max quantity willing to sell.' },
              auto_accept_below: { type: 'number', description: 'Auto-accept if total is below this amount.' },
            },
          },
        },
        required: ['target_username', 'intent', 'message'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'research_market',
      description: 'Act like a researcher: find businesses matching a query on MiniMe, contact several of them with smart questions, collect their replies, and produce a comparison with a recommendation. Use when the owner says things like "find me the best X", "research suppliers for Y", "who has the cheapest Z", "compare options for...", or "find me a [category] and talk to them". Returns immediately; the actual report arrives via Telegram DM over the next few minutes to 24 hours as replies come in.',
      parameters: {
        type: 'object',
        properties: {
          query:       { type: 'string', description: 'What to research (e.g. "branding agency for new logo + cards", "100kg arabica supplier").' },
          category:    { type: 'string', description: 'Optional category hint (e.g. "branding", "packaging", "coffee", "supplier").' },
          budget:      {
            type: 'object',
            description: 'Optional budget: { max, currency, notes }.',
            properties: {
              max:      { type: 'number' },
              currency: { type: 'string' },
              notes:    { type: 'string' },
            },
          },
          max_targets: { type: 'number', description: 'How many businesses to contact (default 5, cap 10).' },
          questions:   { type: 'array', items: { type: 'string' }, description: 'Optional explicit questions to ask; if omitted, MiniMe generates 3-5 smart ones for that category.' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'reply',
      description: 'Reply with plain text. ONLY use for: greetings, yes/no acknowledgements, genuine small talk, OR when the owner has explicitly asked you a factual question. NEVER use this to ask clarifying questions like "what budget?" / "which supplier?" / "how many?" — instead, infer from MEMORY in the system prompt or use the appropriate action tool (research_market, message_other_business, etc.) and just do it.',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
      },
    },
  },
];

// ────────────────────────────── Reminders ──────────────────────────────
async function loadReminders(businessId) {
  const sb = supabase();
  const { data } = await sb.from('businesses').select('notification_prefs').eq('id', businessId).single();
  return data?.notification_prefs?.reminders || [];
}
async function saveReminders(businessId, reminders) {
  const sb = supabase();
  const { data: cur } = await sb.from('businesses').select('notification_prefs').eq('id', businessId).single();
  const prefs = { ...(cur?.notification_prefs || {}), reminders: reminders.slice(-100) };
  await sb.from('businesses').update({ notification_prefs: prefs }).eq('id', businessId);
}
export async function addReminder(businessId, { due_iso, text }) {
  const due = new Date(due_iso);
  if (!Number.isFinite(due.getTime())) return { ok: false, error: 'invalid date' };
  const list = await loadReminders(businessId);
  const r = { id: Math.random().toString(36).slice(2, 10), due_at: due.toISOString(), text: text.slice(0, 300), fired: false, created_at: new Date().toISOString() };
  list.push(r);
  await saveReminders(businessId, list);
  return { ok: true, reminder: r };
}
export async function listReminders(businessId) {
  const list = await loadReminders(businessId);
  const pending = list.filter(r => !r.fired).sort((a, b) => new Date(a.due_at) - new Date(b.due_at));
  if (!pending.length) return '_No reminders set._';
  const lines = ['⏰ *Your reminders*', ''];
  for (const r of pending) {
    const when = new Date(r.due_at);
    const rel = when.getTime() - Date.now();
    const label = rel < 0 ? 'overdue' : rel < 3600000 ? `in ${Math.round(rel / 60000)}m` : rel < 86400000 ? `in ${Math.round(rel / 3600000)}h` : `${when.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
    lines.push(`• ${label} — ${r.text}`);
  }
  return lines.join('\n');
}
export async function fireDueReminders(token, business) {
  const list = await loadReminders(business.id);
  const now = Date.now();
  const due = list.filter(r => !r.fired && new Date(r.due_at).getTime() <= now);
  if (!due.length) return { fired: 0 };
  for (const r of due) {
    try {
      await tg(token, 'sendMessage', {
        chat_id: business.owner_private_chat_id || business.owner_telegram_id,
        text: `⏰ *Reminder*\n\n${r.text}`,
        parse_mode: 'Markdown',
      });
      r.fired = true;
      r.fired_at = new Date().toISOString();
    } catch {}
  }
  // Trim very old fired ones to keep the list small
  const kept = list.filter(r => !r.fired || (Date.now() - new Date(r.fired_at || r.due_at).getTime()) < 7 * 86400000);
  await saveReminders(business.id, kept);
  return { fired: due.length };
}

// ────────────────────────────── Multi-customer broadcast ──────────────────────────────
export async function broadcastToClients(token, business, { filter = 'all', message, dryRun = false }) {
  const sb = supabase();
  let q = sb.from('customers')
    .select('id, name, telegram_id, telegram_username, tier, last_active_at, total_orders')
    .eq('business_id', business.id)
    .not('telegram_id', 'is', null);
  if (filter === 'vip') q = q.eq('tier', 'vip');
  else if (filter === 'regular') q = q.eq('tier', 'regular');
  else if (filter === 'recent') {
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    q = q.gte('last_active_at', since);
  }
  const { data: customers } = await q.limit(500);
  const list = customers || [];
  if (dryRun) return { count: list.length, customers: list };

  let sent = 0;
  for (const c of list) {
    try {
      await tg(token, 'sendMessage', { chat_id: c.telegram_id, text: message });
      sent++;
    } catch {}
  }
  return { count: list.length, sent };
}

// ────────────────────────────── /customers and /team list rendering ──────────────────────────────
export async function listCustomersForOwner(business, { filter = 'all' } = {}) {
  const sb = supabase();
  let q = sb.from('customers')
    .select('id, name, telegram_id, telegram_username, tier, last_active_at, total_orders, total_spent')
    .eq('business_id', business.id);
  if (filter === 'vip') q = q.eq('tier', 'vip');
  else if (filter === 'regular') q = q.eq('tier', 'regular');
  else if (filter === 'recent') {
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    q = q.gte('last_active_at', since);
  }
  const { data: customers } = await q.order('last_active_at', { ascending: false }).limit(40);
  if (!customers?.length) return `_No customers found${filter !== 'all' ? ' for filter "' + filter + '"' : ' yet'}._`;

  const lines = [`👥 *Your customers* (${customers.length}${filter !== 'all' ? ' · ' + filter : ''})`, ''];
  for (const c of customers) {
    const link = customerMention(c);
    const meta = [];
    if (c.telegram_username) meta.push(`@${c.telegram_username}`);
    if (c.tier && c.tier !== 'new') meta.push(c.tier);
    if (c.total_orders) meta.push(`${c.total_orders} order${c.total_orders === 1 ? '' : 's'}`);
    if (c.total_spent) meta.push(`${Math.round(Number(c.total_spent)).toLocaleString()} ETB`);
    lines.push(`• ${link}${meta.length ? ' · ' + meta.join(' · ') : ''}`);
  }
  return lines.join('\n');
}

export async function listTeamForOwner(business) {
  const sb = supabase();
  const { data: suppliers } = await sb.from('suppliers')
    .select('id, name, role, contact_telegram, telegram_username, specialties, is_active')
    .eq('business_id', business.id)
    .order('role', { ascending: true });
  if (!suppliers?.length) return '_No team members yet._ Add them in the Mini App → Agent → Team.';

  const lines = ['🛠 *Your team*', ''];
  const byRole = {};
  for (const s of suppliers) {
    if (!s.is_active) continue;
    (byRole[s.role || 'other'] ||= []).push(s);
  }
  for (const role of Object.keys(byRole)) {
    lines.push(`*${role}*`);
    for (const s of byRole[role]) {
      const link = supplierMention(s);
      const tag = s.contact_telegram ? '✓ DM-able' : '⚠️ no Telegram ID';
      lines.push(`• ${link}${s.specialties ? ' — _' + s.specialties + '_' : ''} · ${tag}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

// ────────────────────────────── Product quick-updates ──────────────────────────────

/** Fuzzy-match a product by name; returns the closest match or null. */
function fuzzyMatchProduct(products, query) {
  const q = (query || '').trim().toLowerCase();
  let match = products.find(p => p.name.toLowerCase() === q);
  if (!match) match = products.find(p => p.name.toLowerCase().includes(q) || q.includes(p.name.toLowerCase()));
  return match || null;
}

/**
 * /add <Product Name> <Price> [stock] — create a new product directly from the bot.
 * Usage:
 *   /add Injera 45           → adds Injera at 45 ETB, stock unlimited
 *   /add Tibs Special 180 50 → adds Tibs at 180 ETB, 50 in stock
 *   /add "Kale Salad" 95 etb → handles quotes and currency suffix
 */
export async function addProduct(businessId, rawInput) {
  const sb = supabase();
  // Parse: "Product Name with spaces 45 ETB 20" or "Product Name" 45 20
  const clean = rawInput.trim().replace(/\s+/g, ' ');
  // Match: optional quoted name OR words until price number
  const m = clean.match(/^(?:"([^"]+)"|(.+?))\s+([\d,.]+)\s*(?:ETB|etb|birr)?\s*(\d+)?$/i);
  if (!m) {
    return `❌ Format: \`/add Product Name Price [stock]\`\n\nExamples:\n• /add Injera 45\n• /add Tibs 180 50\n• /add "Kale Salad" 95`;
  }
  const name = (m[1] || m[2]).trim();
  const price = parseFloat(String(m[3]).replace(/,/g, ''));
  const stock = m[4] ? parseInt(m[4], 10) : null;

  if (!name || name.length < 2) return '❌ Product name too short.';
  if (!Number.isFinite(price) || price < 0) return '❌ Invalid price.';

  // Check if product already exists
  const { data: existing } = await sb.from('products')
    .select('id, name').eq('business_id', businessId).ilike('name', name).limit(1);
  if (existing?.length) {
    return `⚠️ A product named *${existing[0].name}* already exists.\n\nUse \`/price ${name} ${price}\` to update its price instead.`;
  }

  const { data: product, error } = await sb.from('products').insert({
    business_id: businessId,
    name,
    price,
    currency: 'ETB',
    stock_quantity: stock,
    is_active: true,
  }).select().single();

  if (error) return `❌ Could not create product: ${error.message.slice(0, 100)}`;

  try { const { invalidateProductCache } = await import('./replyEngine'); invalidateProductCache(businessId); } catch {}

  const stockStr = stock != null ? ` · Stock: ${stock}` : '';
  return `✅ *${name}* added!\n\nPrice: *${price.toLocaleString()} ETB*${stockStr}\n\nAlfred will now include it in replies and customers can order it.`;
}

export async function updateProductPrice(businessId, productName, newPrice) {
  const price = parseFloat(String(newPrice).replace(/,/g, ''));
  if (!Number.isFinite(price) || price < 0) return '❌ Invalid price.';
  const sb = supabase();
  const { data: products } = await sb.from('products')
    .select('id, name, price, currency').eq('business_id', businessId).eq('is_active', true);
  if (!products?.length) return '❌ No products found. Add products in the Mini App first.';
  const match = fuzzyMatchProduct(products, productName);
  if (!match) {
    const names = products.slice(0, 8).map(p => `• ${p.name}`).join('\n');
    return `❌ No product matched *"${productName}"*.\n\nYour products:\n${names}`;
  }
  const oldPrice = match.price != null ? `${Number(match.price).toLocaleString()} ${match.currency || 'ETB'}` : 'not set';
  await sb.from('products').update({ price }).eq('id', match.id);
  // Invalidate product cache so the new price is reflected immediately
  try { const { invalidateProductCache } = await import('./replyEngine'); invalidateProductCache(businessId); } catch {}
  return `✅ *${match.name}* price updated!\n\n${oldPrice} → *${price.toLocaleString()} ${match.currency || 'ETB'}*`;
}

export async function updateProductStock(businessId, productName, quantity, isRelative) {
  const delta = parseInt(String(quantity), 10);
  if (!Number.isFinite(delta)) return '❌ Invalid quantity.';
  const sb = supabase();
  const { data: products } = await sb.from('products')
    .select('id, name, stock_quantity, currency').eq('business_id', businessId).eq('is_active', true);
  if (!products?.length) return '❌ No products found. Add products in the Mini App first.';
  const match = fuzzyMatchProduct(products, productName);
  if (!match) {
    const names = products.slice(0, 8).map(p => `• ${p.name} (${p.stock_quantity ?? '?'})`).join('\n');
    return `❌ No product matched *"${productName}"*.\n\nCurrent stock:\n${names}`;
  }
  const oldQty = match.stock_quantity ?? 0;
  const newQty = isRelative ? Math.max(0, oldQty + delta) : Math.max(0, delta);
  await sb.from('products').update({ stock_quantity: newQty }).eq('id', match.id);
  const changeLabel = isRelative ? (delta >= 0 ? `+${delta}` : `${delta}`) : 'set to';
  return `✅ *${match.name}* stock updated!\n\n${oldQty} → *${newQty}* units ${isRelative ? `(${changeLabel})` : `(${changeLabel} ${newQty})`}`;
}

// ────────────────────────────── Owner chat memory ──────────────────────────────
const MAX_OWNER_TURNS = 12;

async function loadOwnerHistory(businessId) {
  const sb = supabase();
  const { data } = await sb.from('businesses').select('notification_prefs').eq('id', businessId).single();
  return data?.notification_prefs?.owner_chat || [];
}

async function saveOwnerHistory(businessId, history) {
  const sb = supabase();
  const { data: cur } = await sb.from('businesses').select('notification_prefs').eq('id', businessId).single();
  const prefs = { ...(cur?.notification_prefs || {}), owner_chat: history.slice(-MAX_OWNER_TURNS) };
  await sb.from('businesses').update({ notification_prefs: prefs }).eq('id', businessId);
}

export async function handleOwnerPrompt({ token, business, chatId, ownerText }) {
  // Opportunistically fire any due reminders whenever the owner is active.
  try { await fireDueReminders(token, business); } catch {}

  const history = await loadOwnerHistory(business.id);

  // Load persistent business context (top partners, deals, campaigns, owner facts)
  let memoryBlock = '';
  try {
    const { loadOwnerContext } = await import('./ownerMemory');
    memoryBlock = await loadOwnerContext(business.id);
  } catch (e) { console.warn('[loadOwnerContext]', e.message); }

  const systemContent = `You are MiniMe — an autonomous AI assistant acting on behalf of ${business.name}.
The OWNER (${business.owner_name || 'the shop owner'}) is messaging you directly via Telegram.
Your job: get things DONE for them. Today is ${new Date().toISOString().slice(0, 10)} (${new Date().toLocaleDateString('en-GB', { weekday: 'long' })}).

═══ CORE PRINCIPLE: ACT FIRST. DON'T ASK IF YOU CAN INFER. ═══

• "find me X" / "research X" / "compare X" → call research_market and JUST GO.
  Don't ask for budget — use the median from MEMORY below, or proceed without if none.
• "ask my coffee supplier" / "contact my X" → look at TOP PARTNERS in MEMORY,
  pick the most recent matching one, call message_other_business. Only ask if
  literally NOTHING in memory matches.
• "do it" / "yes" / "tell her" / "send that" → resolve against the last 12 turns of THIS chat.
• When calling dm_client / dm_team_member, write the message in the owner's voice —
  warm, brief, professional. No quote marks, no "[from owner]".

The ONLY times you should ASK before acting:
  1. The action sends money over 5,000 ETB to a new recipient.
  2. The action publishes content publicly (a social post, a broadcast to >5 people).
  3. The owner has never mentioned this thing in MEMORY and the current message
     is genuinely ambiguous (e.g., "the supplier" with multiple matching past partners).

For broadcast specifically: if the owner says "all clients" / "everyone", call
dm_all_clients twice — first with confirm:false (returns count), reply "I'll
message N clients with: '<message>'. Confirm?" and wait. Then confirm:true after yes.

The \`reply\` tool is ONLY for genuine small talk or yes/no acknowledgements.
If you find yourself wanting to type "what's your budget?" or "which one?" — STOP.
Pick an action tool instead and use MEMORY to fill in the blanks.

═══════════════ MEMORY (your persistent business context) ═══════════════
${memoryBlock || '(No prior business activity yet — this is a fresh account.)'}
═══════════════════════════════════════════════════════════════════════════`;

  const messages = [{ role: 'system', content: systemContent }];
  for (const turn of history) {
    if (turn.role && turn.content) messages.push({ role: turn.role, content: turn.content });
  }
  messages.push({ role: 'user', content: ownerText });

  const completion = await openai.chat.completions.create({
    model: MODEL,
    temperature: 0.3,
    max_tokens: 600,
    tools: OWNER_TOOLS,
    tool_choice: 'auto',
    messages,
  });

  const msg = completion.choices[0].message;
  const calls = msg.tool_calls || [];
  let assistantSummary = '';

  if (!calls.length) {
    if (msg.content) {
      await tg(token, 'sendMessage', { chat_id: chatId, text: msg.content });
      assistantSummary = msg.content;
    }
  } else {
    for (const c of calls) {
      let args = {};
      try { args = JSON.parse(c.function.arguments || '{}'); } catch {}
      let outText = '';
      if (c.function.name === 'dm_client') {
        outText = await ownerDmClient(token, business, `${args.client_query} ${args.message}`);
      } else if (c.function.name === 'dm_team_member') {
        outText = await ownerDmTeam(token, business, args.target, args.message);
      } else if (c.function.name === 'dm_all_clients') {
        const dryRun = !args.confirm;
        const r = await broadcastToClients(token, business, { filter: args.filter, message: args.message, dryRun });
        if (dryRun) {
          outText = `📣 Ready to message *${r.count}* client${r.count === 1 ? '' : 's'}${args.filter && args.filter !== 'all' ? ' (' + args.filter + ')' : ''}:\n\n_"${args.message}"_\n\nReply *yes* to send, or *no* to cancel.`;
        } else {
          outText = `✅ Broadcast sent — ${r.sent}/${r.count} delivered.`;
        }
      } else if (c.function.name === 'list_customers') {
        outText = await listCustomersForOwner(business, { filter: args.filter });
      } else if (c.function.name === 'list_team') {
        outText = await listTeamForOwner(business);
      } else if (c.function.name === 'summarize_orders') {
        outText = await listOwnerOrders(business.id);
      } else if (c.function.name === 'ask_advisor') {
        const { generateAdvisorResponse } = await import('./advisor');
        const { response } = await generateAdvisorResponse(business.id, args.question || ownerText);
        outText = `🧠 *Advisor*\n\n${response}`;
      } else if (c.function.name === 'set_reminder') {
        const r = await addReminder(business.id, { due_iso: args.due_iso, text: args.text });
        if (!r.ok) outText = `❌ ${r.error}`;
        else {
          const when = new Date(r.reminder.due_at);
          outText = `⏰ Reminder set for *${when.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}* — _"${r.reminder.text}"_`;
        }
      } else if (c.function.name === 'list_reminders') {
        outText = await listReminders(business.id);
      } else if (c.function.name === 'list_sales') {
        outText = await listOwnerSales(business.id);
      } else if (c.function.name === 'list_stock') {
        outText = await listOwnerStock(business.id);
      } else if (c.function.name === 'update_product_price') {
        outText = await updateProductPrice(business.id, args.product_name, args.new_price);
      } else if (c.function.name === 'update_product_stock') {
        outText = await updateProductStock(business.id, args.product_name, args.quantity, args.is_relative);
      } else if (c.function.name === 'message_other_business') {
        outText = await sendToOtherBusiness(business, args);
      } else if (c.function.name === 'research_market') {
        outText = await runResearchCampaign(business, args);
      } else if (c.function.name === 'reply') {
        outText = args.text || '...';
      }
      if (outText) {
        await tg(token, 'sendMessage', { chat_id: chatId, text: outText, parse_mode: 'Markdown', disable_web_page_preview: true });
        assistantSummary += (assistantSummary ? '\n\n' : '') + outText.slice(0, 400);
      }
    }
  }

  // Persist this turn for next time
  const next = [
    ...history,
    { role: 'user', content: ownerText.slice(0, 800) },
    { role: 'assistant', content: assistantSummary.slice(0, 800) },
  ];
  await saveOwnerHistory(business.id, next);

  return { replied: true };
}

// ─────────────────────────── B2B: message another business ───────────────────────────
async function sendToOtherBusiness(senderBiz, args) {
  try {
    const { findBusinessByUsername, sendBusinessMessage, bizLabel } = await import('./b2b');
    const handle = (args.target_username || '').trim();
    if (!handle) return '❌ Which @bot_username should I message?';
    const recipientBiz = await findBusinessByUsername(handle);
    if (!recipientBiz) {
      const clean = handle.replace(/^@/, '');
      return `🔎 *@${clean}* isn't on MiniMe yet — I can't reach them directly.\n\nIf you have their Telegram, I can draft a message you can forward yourself.`;
    }
    if (recipientBiz.id === senderBiz.id) {
      return `🙃 That's your own bot — you can't message yourself.`;
    }

    // If negotiate mode: turn on auto-negotiate for THIS business for this session
    // and store the owner's limits so the AI negotiator can use them.
    const isNegotiate = !!args.negotiate;
    if (isNegotiate && args.limits && Object.keys(args.limits).length) {
      const sb = (await import('./db')).supabase();
      const { data: cur } = await sb.from('businesses').select('notification_prefs').eq('id', senderBiz.id).maybeSingle();
      const prefs = { ...(cur?.notification_prefs || {}), b2b_limits: args.limits };
      await sb.from('businesses').update({ notification_prefs: prefs, b2b_auto_negotiate: true }).eq('id', senderBiz.id);
      senderBiz = { ...senderBiz, b2b_auto_negotiate: true, notification_prefs: prefs };
    }

    const res = await sendBusinessMessage({
      senderBiz,
      recipientBiz,
      initiatedBy: senderBiz.owner_telegram_id,
      intent: args.intent || (isNegotiate ? 'coordination' : 'inquiry'),
      content: args.message || '',
      structured: {
        ...(args.structured || {}),
        ...(isNegotiate ? { type: 'negotiation_open', limits: args.limits } : {}),
      },
    });
    if (!res.ok) {
      if (res.error === 'blocked_by_recipient') return `🔕 *${bizLabel(recipientBiz)}* isn't accepting messages from you right now.`;
      if (res.error === 'rate_limited')         return `⏳ You've sent a lot to *${bizLabel(recipientBiz)}* in the last hour — wait a bit and try again.`;
      if (res.error === 'empty_message')        return `❌ What should I say to them?`;
      return `❌ Couldn't send (${res.error || 'unknown error'}).`;
    }

    if (isNegotiate) {
      return `🤝 Negotiation started with *${bizLabel(recipientBiz)}*.\n\n_MiniMe will negotiate on your behalf and update you when a deal is reached or when it needs your input._${args.limits ? `\n\nYour limits:\n${Object.entries(args.limits).map(([k,v]) => `• ${k.replace(/_/g,' ')}: ${v}`).join('\n')}` : ''}`;
    }
    return `✓ Message sent to *${bizLabel(recipientBiz)}*.\n\n_I'll DM you the moment they reply._`;
  } catch (e) {
    console.error('[sendToOtherBusiness]', e?.message || e);
    return `❌ Couldn't reach the other business — try again in a moment.`;
  }
}

// ─────────────────────────── Research Agent ───────────────────────────
async function runResearchCampaign(business, args) {
  try {
    const { startCampaign } = await import('./research');
    const res = await startCampaign({
      business,
      ownerTgId:  business.owner_telegram_id,
      query:      args.query || '',
      category:   args.category,
      budget:     args.budget,
      maxTargets: args.max_targets,
      questions:  args.questions,
    });
    if (!res.ok) {
      if (res.error === 'empty_query') return `❌ What should I research?`;
      return `❌ Couldn't start research (${res.error || 'unknown error'}).`;
    }
    const partsList = res.candidates?.length
      ? '\n\n*Contacting:*\n' + res.candidates.map(c => `• ${c.name}${c.username ? ` (@${c.username})` : ''}`).join('\n')
      : '';
    if (res.contacted === 0) {
      return `🔎 No MiniMe businesses matched *${escapeMdInline(args.query)}* yet.\n\n_As more businesses join MiniMe the network will grow. Try a broader search term (e.g. category name only)._`;
    }
    const budgetLine = res.budget_inferred
      ? `\nBudget: ~${res.budget_inferred.max.toLocaleString()} ${res.budget_inferred.currency} _(inferred from your past deals)_`
      : args.budget?.max
        ? `\nBudget: up to ${args.budget.max} ${args.budget.currency || 'ETB'}`
        : '';
    return `🔍 *Research started.*\n\nLooking for: _${escapeMdInline(args.query)}_${budgetLine}${partsList}${res.web_drafts ? `\n\n_+${res.web_drafts} non-MiniMe candidates available in the dashboard._` : ''}\n\n_I'll DM you when ${res.contacted >= 2 ? 'half of them' : 'they'} reply, or with the full comparison once everyone's in (within 24h)._`;
  } catch (e) {
    console.error('[runResearchCampaign]', e?.message || e);
    return `❌ Couldn't start the research — try again in a moment.`;
  }
}

function escapeMdInline(s) {
  return String(s || '').replace(/([_*\[\]()~`>#+=|{}.!\\-])/g, '\\$1');
}
