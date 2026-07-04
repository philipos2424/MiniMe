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
import { MODEL, MODEL_MINI } from './constants';
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

// Save a durable fact about a specific person so the assistant recalls it later.
// Resolves "who" to a customers row (the table reply prompts read from) — directly
// by name/@handle, or via a saved personal contact's telegram_id/name.
async function rememberFactForOwner(business, who, fact) {
  const text = (fact || '').trim();
  if (!text) return '❌ Tell me what you want me to remember.';
  if (!who || !who.trim()) return '❌ Who is this about? Give me a name or nickname.';
  const sb = supabase();
  let customer = await findCustomerByQuery(business.id, who);
  if (!customer) {
    const contacts = business.notification_prefs?.personal_contacts || [];
    const { match } = resolvePersonalContact(contacts, who);
    if (match?.telegram_id) {
      const { data } = await sb.from('customers')
        .select('id, name').eq('business_id', business.id).eq('telegram_id', String(match.telegram_id)).maybeSingle();
      customer = data || (match.name ? await findCustomerByQuery(business.id, match.name) : null);
    }
  }
  if (!customer) {
    return `❌ I don't have anyone matching "${who}" yet. Add them under *People you know*, or message them once so I know who they are — then I can remember things about them.`;
  }
  await sb.from('customer_memory').insert({
    customer_id: customer.id, business_id: business.id,
    kind: 'fact', content: text.slice(0, 200), source: 'owner_note',
  }).then(() => {}, () => {});
  return `🧠 Got it — I'll remember that about *${customer.name || who}*.`;
}

async function recallPerson(business, who) {
  if (!who?.trim()) return '❌ Tell me who you want to look up.';
  const sb = supabase();
  let customer = await findCustomerByQuery(business.id, who);
  if (!customer) {
    const contacts = business.notification_prefs?.personal_contacts || [];
    const { match } = resolvePersonalContact(contacts, who);
    if (match?.telegram_id) {
      const { data } = await sb.from('customers')
        .select('id, name, telegram_username, tier, last_active_at, total_orders, total_spent')
        .eq('business_id', business.id).eq('telegram_id', String(match.telegram_id)).maybeSingle();
      customer = data;
    }
  }
  if (!customer) return `❌ I don't know anyone matching "${who}" yet.`;

  const [{ data: mem }, { data: orders }] = await Promise.all([
    sb.from('customer_memory').select('kind, content, source, created_at')
      .eq('customer_id', customer.id).order('created_at', { ascending: false }).limit(30),
    sb.from('orders').select('total, currency, status, created_at, items')
      .eq('customer_id', customer.id).in('status', ['paid', 'completed', 'delivered', 'confirmed'])
      .order('created_at', { ascending: false }).limit(5),
  ]);

  const lines = [`🧠 *What I know about ${customer.name || who}*`, ''];
  if (customer.telegram_username) lines.push(`@${customer.telegram_username}`);
  if (customer.tier && customer.tier !== 'new') lines.push(`Tier: ${customer.tier}`);
  if (customer.total_orders) lines.push(`Orders: ${customer.total_orders} (${Math.round(Number(customer.total_spent || 0)).toLocaleString()} ETB)`);
  if (customer.last_active_at) {
    const daysAgo = Math.round((Date.now() - new Date(customer.last_active_at).getTime()) / 86400000);
    lines.push(`Last active: ${daysAgo === 0 ? 'today' : daysAgo === 1 ? 'yesterday' : `${daysAgo} days ago`}`);
  }

  if (mem?.length) {
    lines.push('', '*Memory*');
    const pinned = mem.filter(m => m.source === 'owner_note');
    const commitments = mem.filter(m => m.kind === 'commitment' && m.source !== 'owner_note');
    const auto = mem.filter(m => m.source !== 'owner_note' && m.kind !== 'commitment');
    if (pinned.length) { lines.push('📌 _Pinned:_'); for (const m of pinned) lines.push(`  • ${m.content}`); }
    if (commitments.length) { lines.push('🤝 _Commitments:_'); for (const m of commitments) lines.push(`  • ${m.content}`); }
    if (auto.length) { lines.push('🔍 _Learned:_'); for (const m of auto.slice(0, 10)) lines.push(`  • (${m.kind}) ${m.content}`); }
  } else {
    lines.push('', '_No memories yet — I learn as you chat with them._');
  }

  if (orders?.length) {
    lines.push('', '*Recent orders*');
    for (const o of orders) {
      const items = (o.items || []).map(i => `${i.quantity > 1 ? i.quantity + 'x ' : ''}${i.name || '?'}`).join(', ');
      const date = new Date(o.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
      lines.push(`  • ${items || 'order'} — ${Number(o.total || 0).toLocaleString()} ${o.currency || 'ETB'} (${date})`);
    }
  }
  return lines.join('\n');
}

/**
 * Deliver an owner-authored message to a customer, word-for-word, and log it
 * in the conversation (is_ai_generated: false so the AI learns the owner's
 * voice). Shared by /dm and the one-tap "Reply to customer" / "Reply myself"
 * buttons on order & draft notifications.
 */
export async function sendOwnerDm(token, business, customer, message) {
  await tg(token, 'sendMessage', {
    chat_id: customer.telegram_id, text: message,
    ...(business.telegram_biz_conn_id && { business_connection_id: business.telegram_biz_conn_id }),
  });

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
}

export async function ownerDmClient(token, business, after) {
  if (!after) {
    return 'Usage:\n`/dm <client name> <message>`\n\nExample:\n`/dm Sara your design draft is ready, want to take a look?`\n\n💡 Tip: on any order alert or draft you can just tap *💬 Reply to customer* / *🙋 Reply myself* — no command needed.';
  }
  // First whitespace-separated token = client query (or @handle); rest = message
  const m = after.match(/^(@?\S+)\s+([\s\S]+)/);
  if (!m) return "I need both a client name and a message. Try `/dm Sara hey, your card draft is ready`.";
  const [, queryRaw, message] = m;

  const customer = await findCustomerByQuery(business.id, queryRaw);
  if (!customer) return `❌ I don't see a customer matching "${queryRaw}". Try part of their name, or check your /customers list.`;
  if (!customer.telegram_id) return `❌ ${customer.name} has no Telegram ID on file — I can't DM them.`;

  await sendOwnerDm(token, business, customer, message);
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
      name: 'connect_with_business',
      description: 'Send a warm introduction to a specific MiniMe business — starts a friendly B2B thread without jumping straight to negotiation. Use when owner says "connect me with @X", "introduce me to @X", "reach out to @X", or "I want to talk to @X" (after seeing a research report or browsing the network).',
      parameters: {
        type: 'object',
        properties: {
          username: { type: 'string', description: 'The Telegram bot username of the business (e.g. "brand_co_bot" or "@brand_co_bot").' },
          context:  { type: 'string', description: 'Brief context — what you found them for (e.g. "branding agency from research").' },
          note:     { type: 'string', description: 'Optional personal note to include in the intro message.' },
        },
        required: ['username'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browse_network',
      description: 'List businesses on the MiniMe network WITHOUT contacting them — a directory view. Use when owner says "show me all X on MiniMe", "who\'s on MiniMe?", "list [category] businesses", or "browse [category]". Different from research_market which actually contacts them.',
      parameters: {
        type: 'object',
        properties: {
          category: { type: 'string', description: 'Filter by category (e.g. "branding_design", "printing_signage", "food").' },
          query:    { type: 'string', description: 'Free-text search if no specific category.' },
          limit:    { type: 'number', description: 'Max results to show (default 10).' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'schedule_task',
      description: "Schedule the agent to perform an OUTREACH action LATER, at a specific time — then bring it to the owner to approve before it sends. Use when the owner says 'message Sara on Friday', 'tomorrow 9am tell the printer the files are ready', 'next Monday follow up with Dawit'. This is NOT a reminder-to-self (use set_reminder for that) — this is the agent reaching out to someone ELSE on the owner's behalf. At the scheduled time the agent drafts the message and asks the owner to approve & send.",
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['dm_client', 'dm_team', 'broadcast'], description: 'Who to reach: dm_client = a customer; dm_team = a team member/supplier (designer/printer/etc); broadcast = many customers.' },
          target: { type: 'string', description: "For dm_client: the customer's name or @handle. For dm_team: a role (designer/printer/delivery…), a name, or 'team' for everyone. For broadcast: one of all/recent/vip/regular." },
          message: { type: 'string', description: "What to say, in the owner's voice. The agent polishes it and shows it to the owner before sending." },
          when_iso: { type: 'string', description: "When to act, as EAT/local datetime (YYYY-MM-DDTHH:MM:SS, no timezone suffix). Resolve relative phrases ('Friday', 'tomorrow 9am') against today." },
        },
        required: ['action', 'target', 'message', 'when_iso'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'schedule_recurring',
      description: "Schedule a RECURRING outreach action the agent performs on a repeating schedule, bringing each one to the owner to approve before it sends. Use for 'every Monday DM my VIPs', 'each morning message the team the plan', 'every Friday 5pm thank this week's customers'. For one-time actions use schedule_task instead.",
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['dm_client', 'dm_team', 'broadcast'] },
          target: { type: 'string', description: "Customer name/@handle, team role/name/'team', or broadcast filter (all/recent/vip/regular)." },
          message: { type: 'string', description: "What to say each time, in the owner's voice." },
          recurrence: {
            type: 'object',
            description: 'How often to repeat.',
            properties: {
              kind: { type: 'string', enum: ['daily', 'weekly'] },
              day_of_week: { type: 'number', description: "0=Sunday … 6=Saturday. Required when kind='weekly'." },
              time_eat: { type: 'string', description: "Time of day in EAT, 'HH:MM' 24h (e.g. '09:00', '17:30')." },
            },
            required: ['kind', 'time_eat'],
          },
        },
        required: ['action', 'target', 'message', 'recurrence'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_tasks',
      description: "List the scheduled tasks the agent will do for the owner (upcoming outreach + recurring). Use for 'what are you working on', \"what's scheduled\", 'show my tasks', 'what will you do for me'.",
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancel_task',
      description: "Cancel a scheduled task. Use when the owner says 'cancel the Friday message to Sara', 'stop the Monday VIP broadcast'. Pass a short query identifying it (a name, target, or topic).",
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Name/target/topic that identifies the task to cancel.' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'follow_up',
      description: "Autonomously follow up with a customer until they reply. The agent sends the message, then checks back every interval — if they replied, it stops and tells the owner. If not, it sends another follow-up (varied wording). Use for 'follow up with Sara until she replies', 'keep messaging X every day', 'chase this customer', 'don't let them ghost us'. Stops automatically after max_attempts or when they reply.",
      parameters: {
        type: 'object',
        properties: {
          target: { type: 'string', description: "The customer's name or @handle." },
          message: { type: 'string', description: "What to say (the gist — the agent will vary wording on follow-ups)." },
          interval: { type: 'string', enum: ['every_6h', 'daily', 'every_2d', 'weekly'], description: "How often to follow up. Default 'daily'." },
          max_attempts: { type: 'number', description: 'Max follow-ups before giving up (default 5, max 10).' },
        },
        required: ['target', 'message'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'message_person',
      description: "Send a PERSONAL Telegram message to one of the owner's family or friends (mom, girlfriend/gf, brother, a friend by name). Use when the owner says 'text my gf', 'send this to mom', 'message Sara', 'tell my brother X' — OR gives a GOAL like 'make my girlfriend happy', 'cheer mom up', 'wish him good morning sweetly'. You compose it in the owner's voice for that relationship. NOT for customers (use dm_client) or team/suppliers (use dm_team_member).",
      parameters: {
        type: 'object',
        properties: {
          who: { type: 'string', description: "Who to message — a name, nickname, or relation as the owner refers to them: 'mom', 'gf', 'Sara', 'my brother'. Match it against the PEOPLE YOU KNOW list in the system prompt." },
          goal_or_message: { type: 'string', description: "Either the exact message to send, OR a goal to achieve ('make her happy', 'say good morning', 'apologize warmly'). The assistant writes the actual message in the owner's voice." },
        },
        required: ['who', 'goal_or_message'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'plan_my_day',
      description: "Build the owner a short plan for their day from their reminders, scheduled tasks, and open orders — with proactive suggestions for what to handle next. Use for 'plan my day', 'what should I do today', \"what's on\", 'help me get organized', 'what needs my attention'.",
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remember_fact',
      description: "Save a durable fact about a specific person (a customer, or family/friend) so you recall it in future conversations with them. Use when the owner says 'remember that …', 'note that …', 'keep in mind …', 'FYI about Sara …'. Examples: \"remember Sara's birthday is May 15\", \"note this client prefers weekend delivery\", \"keep in mind Abebe is allergic to nuts\". NOT for time-based reminders to the OWNER (use set_reminder/schedule_task for those).",
      parameters: {
        type: 'object',
        properties: {
          who: { type: 'string', description: "Who the fact is about — a name, @username, nickname, or relation ('Sara', 'mom', '@abebe', 'that client')." },
          fact: { type: 'string', description: "The fact to remember, one short line ('birthday is May 15', 'prefers weekend delivery', 'allergic to nuts')." },
        },
        required: ['who', 'fact'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'reply',
      description: 'Reply with plain text — this is how you actually TALK to the owner. Use it to answer their personal or general questions, give advice, think a decision through with them, or chat naturally (personal assistant, not only a shop tool). Do NOT use it to ask clarifying questions like "what budget?" / "which supplier?" — instead infer from MEMORY or use the right action tool and just do it.',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'recall_person',
      description: "Look up everything the assistant knows about a person — facts, preferences, commitments, order history. Use when the owner asks 'what do you know about X', 'tell me about Sara', 'who is X', 'what did X order', 'anything on this customer'.",
      parameters: {
        type: 'object',
        properties: {
          who: { type: 'string', description: "Name, @handle, or nickname of the person to look up." },
        },
        required: ['who'],
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

// ────────────────────── Owner-assigned scheduled tasks (owner_action) ──────────────────────
// The owner says "message Sara on Friday" / "every Monday DM my VIPs". We store
// an agent_tasks row (type 'owner_action', status 'pending'); the cron
// /api/cron/agent-tasks drafts it at the scheduled time, flips it to
// 'awaiting_approval', and DMs the owner an approve/cancel preview. The actual
// send happens only after the owner taps Approve (replyEngine callback).

const EAT_MS = 3 * 60 * 60 * 1000;

/** Treat a tz-naive ISO (YYYY-MM-DDTHH:MM[:SS]) as EAT wall-clock → real UTC Date. */
function eatIsoToUtc(iso) {
  const s = String(iso || '');
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) { const d = new Date(s); return Number.isFinite(d.getTime()) ? d : null; }
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) { const d = new Date(s); return Number.isFinite(d.getTime()) ? d : null; }
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) - EAT_MS);
}

/** Next occurrence (real UTC) for a daily/weekly recurrence at time_eat. */
export function nextRunFromRecurrence(rec, fromMs = Date.now()) {
  if (!rec || (rec.kind !== 'daily' && rec.kind !== 'weekly')) return null;
  const [hh, mm] = String(rec.time_eat || '09:00').split(':').map(n => parseInt(n, 10));
  const hour = Number.isFinite(hh) ? hh : 9;
  const min = Number.isFinite(mm) ? mm : 0;
  // Build the candidate as EAT wall-clock, expressed through UTC getters.
  const nowEat = new Date(fromMs + EAT_MS);
  const cand = new Date(nowEat);
  cand.setUTCHours(hour, min, 0, 0);
  if (rec.kind === 'weekly') {
    const target = Number.isInteger(rec.day_of_week) ? rec.day_of_week : nowEat.getUTCDay();
    let diff = target - cand.getUTCDay();
    if (diff < 0) diff += 7;
    if (diff === 0 && cand.getTime() <= nowEat.getTime()) diff = 7;
    cand.setUTCDate(cand.getUTCDate() + diff);
  } else if (cand.getTime() <= nowEat.getTime()) {
    cand.setUTCDate(cand.getUTCDate() + 1);
  }
  return new Date(cand.getTime() - EAT_MS); // EAT wall-clock → real UTC
}

function fmtWhen(iso) {
  return new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function actionLabel(action, target) {
  if (action === 'broadcast') return `broadcast to ${target}`;
  return `message to ${target}`;
}
function recurrenceLabel(rec) {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  if (rec?.kind === 'weekly') return `every ${days[rec.day_of_week] ?? 'week'} at ${rec.time_eat}`;
  return `every day at ${rec?.time_eat || '09:00'}`;
}

const FOLLOW_UP_INTERVALS = {
  every_6h:  { kind: 'daily', time_eat: null, interval_ms: 6 * 3600000 },
  daily:     { kind: 'daily', time_eat: '09:00' },
  every_2d:  { kind: 'daily', time_eat: '09:00', skip_days: 1 },
  weekly:    { kind: 'weekly', time_eat: '09:00' },
};

export async function createFollowUpTask(business, { target, message, interval = 'daily', max_attempts = 5 }) {
  if (!business.telegram_biz_conn_id) return { ok: false, error: 'no_secretary' };
  const sb = supabase();
  const customer = await findCustomerByQuery(business.id, target);
  if (!customer) return { ok: false, error: `no_customer_match` };
  if (!customer.telegram_id) return { ok: false, error: 'no_telegram_id' };

  const cap = Math.min(Math.max(max_attempts || 5, 1), 10);
  const intv = FOLLOW_UP_INTERVALS[interval] || FOLLOW_UP_INTERVALS.daily;
  let scheduled_at;
  if (intv.interval_ms) {
    scheduled_at = new Date(Date.now() + intv.interval_ms).toISOString();
  } else {
    const rec = { kind: intv.kind, time_eat: intv.time_eat || '09:00' };
    if (intv.kind === 'weekly') rec.day_of_week = new Date(Date.now() + EAT_MS).getUTCDay();
    const next = nextRunFromRecurrence(rec);
    if (intv.skip_days) next.setTime(next.getTime() + intv.skip_days * 86400000);
    scheduled_at = next.toISOString();
  }

  const { data, error } = await sb.from('agent_tasks').insert({
    business_id: business.id,
    type: 'owner_action',
    status: 'pending',
    title: `Follow up with ${customer.name || target}`.slice(0, 255),
    description: (message || '').slice(0, 500),
    scheduled_at,
    requires_approval: false,
    payload: {
      action: 'dm_client', target: customer.name || target, message,
      customer_id: customer.id, recipient_tg_id: customer.telegram_id,
      auto_send: true, chase_until_reply: true,
      interval, max_attempts: cap, attempt: 0,
    },
  }).select().single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, task: data, customer };
}

export async function createOwnerTask(businessId, { action, target, message, scheduled_at, recurrence }) {
  const sb = supabase();
  const title = action === 'broadcast'
    ? `Broadcast to ${target}`
    : `Message ${target}`;
  const { data, error } = await sb.from('agent_tasks').insert({
    business_id: businessId,
    type: 'owner_action',
    status: 'pending',
    title: title.slice(0, 255),
    description: (message || '').slice(0, 500),
    scheduled_at,
    requires_approval: true,
    payload: { action, target, message, recurrence: recurrence || { kind: 'once' } },
  }).select().single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, task: data };
}

export async function listOwnerTasks(businessId) {
  const sb = supabase();
  const { data } = await sb.from('agent_tasks')
    .select('id, title, scheduled_at, status, payload')
    .eq('business_id', businessId)
    .eq('type', 'owner_action')
    .in('status', ['pending', 'awaiting_approval'])
    .order('scheduled_at', { ascending: true })
    .limit(30);
  if (!data?.length) return '_No scheduled tasks. Tell me things like "message Sara on Friday" or "every Monday DM my VIPs"._';
  const lines = ["🗓 *What I'll do for you*", ''];
  for (const t of data) {
    const rec = t.payload?.recurrence;
    const repeat = rec && rec.kind && rec.kind !== 'once' ? ` · 🔁 ${recurrenceLabel(rec)}` : '';
    const whenStr = t.scheduled_at ? fmtWhen(t.scheduled_at) : 'soon';
    const pending = t.status === 'awaiting_approval' ? ' · ⏳ awaiting your approval' : '';
    lines.push(`• ${t.title || 'Task'} — _${whenStr}_${repeat}${pending}`);
  }
  return lines.join('\n');
}

export async function cancelOwnerTask(businessId, query) {
  const sb = supabase();
  const { data } = await sb.from('agent_tasks')
    .select('id, title, payload, scheduled_at')
    .eq('business_id', businessId)
    .eq('type', 'owner_action')
    .in('status', ['pending', 'awaiting_approval'])
    .order('scheduled_at', { ascending: true })
    .limit(30);
  if (!data?.length) return '_No scheduled tasks to cancel._';
  const q = (query || '').trim().toLowerCase();
  const match = data.find(t =>
    (t.title || '').toLowerCase().includes(q) ||
    (t.payload?.target || '').toLowerCase().includes(q) ||
    (t.payload?.message || '').toLowerCase().includes(q),
  ) || (data.length === 1 ? data[0] : null);
  if (!match) return "❌ I couldn't tell which task you mean. Say _list my tasks_ to see them, then tell me which to cancel.";
  await sb.from('agent_tasks').update({ status: 'cancelled' }).eq('id', match.id);
  return `🗑 Cancelled — _${match.title || 'task'}_.`;
}

// ────────────────────────────── Plan my day ──────────────────────────────
// Pulls today's reminders + scheduled tasks + open orders into one short plan
// with a nudge to act. Used by the plan_my_day tool (proactive chief-of-staff).
export async function planMyDay(business) {
  const sb = supabase();
  const now = Date.now();
  const dayEnd = new Date(now + 24 * 3600000).toISOString();

  const reminders = (await loadReminders(business.id))
    .filter(r => !r.fired && new Date(r.due_at).getTime() <= now + 24 * 3600000)
    .sort((a, b) => new Date(a.due_at) - new Date(b.due_at));

  const [{ data: tasks }, { data: orders }, { data: commitments }, { data: recentConvos }] = await Promise.all([
    sb.from('agent_tasks')
      .select('title, scheduled_at, status, payload')
      .eq('business_id', business.id).eq('type', 'owner_action')
      .in('status', ['pending', 'awaiting_approval'])
      .lte('scheduled_at', dayEnd).order('scheduled_at', { ascending: true }).limit(10),
    sb.from('orders')
      .select('total, currency, status, customers(name)')
      .eq('business_id', business.id).in('status', ['pending_payment', 'paid'])
      .order('created_at', { ascending: false }).limit(5),
    sb.from('customer_memory')
      .select('content, created_at, customers(name)')
      .eq('business_id', business.id).eq('kind', 'commitment')
      .gte('created_at', new Date(now - 7 * 24 * 3600000).toISOString())
      .order('created_at', { ascending: false }).limit(8),
    sb.from('conversations')
      .select('id, last_message_at, customers(name)')
      .eq('business_id', business.id)
      .gte('last_message_at', new Date(now - 24 * 3600000).toISOString())
      .order('last_message_at', { ascending: false })
      .limit(12),
  ]);

  // Find conversations where the customer is waiting for a reply
  const waiting = [];
  for (const conv of (recentConvos || [])) {
    try {
      const { data: lastMsg } = await sb.from('messages')
        .select('direction, content, created_at')
        .eq('conversation_id', conv.id)
        .order('created_at', { ascending: false })
        .limit(1).maybeSingle();
      if (lastMsg?.direction === 'inbound') {
        const ageH = Math.round((now - new Date(lastMsg.created_at).getTime()) / 3600000);
        if (ageH >= 1) {
          waiting.push({
            name: conv.customers?.name || 'Someone',
            snippet: (lastMsg.content || '').slice(0, 50).replace(/\n/g, ' '),
            hours: ageH,
          });
        }
      }
    } catch {}
  }

  const lines = [`🗓 *Your day — ${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}*`, ''];
  if (waiting.length) {
    lines.push('*💬 Waiting for your reply*');
    for (const w of waiting) lines.push(`• *${w.name}* (${w.hours}h ago): _${w.snippet}_`);
    lines.push('');
  }
  if (reminders.length) {
    lines.push('*⏰ Reminders*');
    for (const r of reminders) lines.push(`• ${new Date(r.due_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} — ${r.text}`);
    lines.push('');
  }
  if (commitments?.length) {
    lines.push('*🤝 Commitments to keep*');
    for (const c of commitments) lines.push(`• ${c.customers?.name ? `${c.customers.name}: ` : ''}${c.content}`);
    lines.push('');
  }
  if (tasks?.length) {
    lines.push('*📤 Scheduled outreach*');
    for (const t of tasks) lines.push(`• ${t.title}${t.status === 'awaiting_approval' ? ' _(needs your approval)_' : ''}`);
    lines.push('');
  }
  if (orders?.length) {
    lines.push('*🧾 Open orders*');
    for (const o of orders) lines.push(`• ${o.customers?.name || 'Customer'} — ${Number(o.total || 0).toLocaleString()} ${o.currency || 'ETB'} · ${o.status === 'paid' ? 'paid' : 'awaiting payment'}`);
    lines.push('');
  }
  if (!waiting.length && !reminders.length && !tasks?.length && !orders?.length && !commitments?.length) {
    lines.push("_All clear! Want me to set a reminder, follow up with a customer, or plan some outreach?_");
  } else {
    lines.push("_Want me to handle any of these? Just tell me._");
  }
  return lines.join('\n');
}

// ────────────────────── Message a family member / friend ──────────────────────
// Resolves one of the owner's saved personal contacts (mom/gf/brother/Sara…) and
// sends them a message — composing it in the owner's voice when given a GOAL
// ("make her happy") rather than literal text. This is the owner explicitly
// commanding an outbound message in the moment, so it sends directly (unlike
// scheduled tasks, which need approval).
// Role words → the synonyms we accept in a contact's aliases/context.
const ROLE_SYNONYMS = {
  gf: ['girlfriend', 'gf'], girlfriend: ['girlfriend', 'gf'], wife: ['wife'], bae: ['girlfriend', 'gf', 'bae'], babe: ['girlfriend', 'gf', 'babe'],
  bf: ['boyfriend', 'bf'], boyfriend: ['boyfriend', 'bf'], husband: ['husband'],
  mom: ['mom', 'mother', 'mum', 'mama'], mum: ['mom', 'mother', 'mum'], mother: ['mom', 'mother', 'mum'],
  dad: ['dad', 'father', 'papa'], father: ['dad', 'father'],
  bro: ['brother', 'bro'], brother: ['brother', 'bro'],
  sis: ['sister', 'sis'], sister: ['sister', 'sis'],
  son: ['son'], daughter: ['daughter'], wifey: ['wife', 'girlfriend'],
};

// Score a contact against the owner's reference. STRICT on purpose — sending to
// the wrong person in the owner's name is unacceptable, so we only accept:
//   5 = exact name or exact nickname match
//   4 = a role word (gf/mom/…) that this contact is explicitly tagged with
//   3 = the reference is a whole word in their name (e.g. "Sara" → "Sara Bekele")
// No loose substring / context guessing (that caused a wrong send).
function scorePersonalContact(c, q) {
  const name = (c.name || '').trim().toLowerCase();
  const aliases = (Array.isArray(c.aliases) ? c.aliases : []).map(a => String(a).trim().toLowerCase());
  const ctx = (c.context || '').toLowerCase();
  if (!q) return 0;
  if (name === q || aliases.includes(q)) return 5;
  const roleWords = ROLE_SYNONYMS[q];
  if (roleWords && roleWords.some(w => aliases.includes(w) || new RegExp(`\\b${w}\\b`).test(ctx))) return 4;
  if (name && name.split(/\s+/).includes(q)) return 3;
  return 0;
}

// Returns { match } when confident & unambiguous, else { candidates } to ask the
// owner, or {} when nothing matches.
function resolvePersonalContact(contacts, who) {
  const q = (who || '').trim().toLowerCase().replace(/^(my|to)\s+/, '');
  const scored = contacts
    .map(c => ({ c, s: scorePersonalContact(c, q) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s);
  if (!scored.length) return {};
  const top = scored[0];
  const tied = scored.filter(x => x.s === top.s);
  if (tied.length > 1) return { candidates: tied.map(x => x.c) };
  return { match: top.c };
}

async function composePersonalMessage(business, contact, goalOrMessage) {
  try {
    const rel = contact.relation || 'someone close';
    const aliases = Array.isArray(contact.aliases) && contact.aliases.length ? contact.aliases.join(', ') : '';
    const completion = await openai.chat.completions.create({
      model: MODEL_MINI, temperature: 0.7, max_tokens: 220,
      messages: [{
        role: 'user',
        content:
          `You are ${business.owner_name || 'the owner'} writing a PERSONAL Telegram message to ${contact.name} (${rel}${aliases ? `, you call them: ${aliases}` : ''}${contact.context ? `; what to know: ${contact.context}` : ''}).\n` +
          `The owner asked: "${goalOrMessage}".\n` +
          `If that's already a ready-to-send message, lightly polish it. If it's a GOAL (e.g. "make her happy", "say good morning", "apologize"), write a warm, genuine message that achieves it.\n` +
          `Sound like a real person texting someone they love or are close to — match the relationship. Use the language the owner would use (English, Amharic, or mixed). No quotation marks, no signature, no "[from owner]". Return ONLY the message text.`,
      }],
    });
    return (completion.choices?.[0]?.message?.content || '').trim();
  } catch (e) {
    console.warn('[composePersonalMessage]', e.message);
    return (goalOrMessage || '').trim();
  }
}

export async function ownerMessagePersonal(token, business, who, goalOrMessage) {
  const contacts = business.notification_prefs?.personal_contacts || [];
  if (!contacts.length) {
    return "I don't know your family or friends yet 💛 Add them in *People you know* (Settings → Your assistant), then I can message them for you.";
  }
  const { match, candidates } = resolvePersonalContact(contacts, who);

  // Ambiguous → ASK, never guess. Sending to the wrong person is not acceptable.
  if (candidates) {
    return `I want to make sure I message the right person — did you mean ${candidates.map(c => `*${c.name}*`).join(' or ')}? Tell me the exact name.`;
  }
  if (!match) {
    return `I'm not sure who "${who}" is, so I didn't send anything. In *People you know* give them a nickname (like "gf" or "mom"), then ask me again — or just tell me their exact name.`;
  }
  if (!match.telegram_id) {
    return `I know *${match.name}*, but I don't have their Telegram yet — add it in *People you know* and I'll be able to message them.`;
  }

  const message = await composePersonalMessage(business, match, goalOrMessage);
  if (!message) return `❌ I couldn't put that into words — try telling me a bit more.`;
  const res = await tg(token, 'sendMessage', { chat_id: match.telegram_id, text: message });
  if (!res?.ok) return `❌ Couldn't reach *${match.name}* just now — maybe they haven't started a chat with your bot.`;
  return `💛 Sent to *${match.name}*:\n\n${message}`;
}

// ────────────── Draft → approve → send (owner-commanded messages) ──────────────
// When notification_prefs.confirm_before_send !== false, an owner-commanded send
// is queued as an agent_tasks row (awaiting_approval) and shown to the owner with
// Send/Cancel — instead of going out immediately. Same row type the scheduled
// tasks use, so it also appears on the in-app Tasks board.

/** Create an awaiting-approval draft. Returns the task row (or null). */
export async function queueOwnerSend(business, { action, target, message_draft, recipient_tg_id }) {
  const sb = supabase();
  const title = action === 'broadcast' ? `Broadcast to ${target}` : `Message ${target}`;
  const { data, error } = await sb.from('agent_tasks').insert({
    business_id: business.id,
    type: 'owner_action',
    status: 'awaiting_approval',
    title: title.slice(0, 255),
    description: (message_draft || '').slice(0, 500),
    scheduled_at: new Date().toISOString(),
    requires_approval: true,
    payload: { action, target, message_draft, recipient_tg_id: recipient_tg_id || null, recurrence: { kind: 'once' } },
  }).select().single();
  if (error) { console.warn('[queueOwnerSend]', error.message); return null; }
  return data;
}

/** Resolve + compose a personal message; queue for approval or send now. */
export async function prepareMessagePersonal(token, business, who, goalOrMessage, confirmSend) {
  const contacts = business.notification_prefs?.personal_contacts || [];
  if (!contacts.length) {
    return { text: "I don't know your family or friends yet 💛 Add them in *People you know* (Settings → Your assistant), then I can message them for you." };
  }
  const { match, candidates } = resolvePersonalContact(contacts, who);
  if (candidates) return { text: `I want to message the right person — did you mean ${candidates.map(c => `*${c.name}*`).join(' or ')}? Tell me the exact name.` };
  if (!match) return { text: `I'm not sure who "${who}" is, so I didn't send anything. Give them a nickname (like "gf" or "mom") in *People you know*, or tell me their exact name.` };
  if (!match.telegram_id) return { text: `I know *${match.name}*, but I don't have their Telegram yet — add it in *People you know* and I'll be able to message them.` };

  const draft = await composePersonalMessage(business, match, goalOrMessage);
  if (!draft) return { text: `❌ I couldn't put that into words — try telling me a bit more.` };

  if (confirmSend) {
    const task = await queueOwnerSend(business, { action: 'message_person', target: match.name, message_draft: draft, recipient_tg_id: match.telegram_id });
    if (!task) return { text: `❌ Couldn't prepare that draft — try again.` };
    return { text: `📝 Draft to *${match.name}*:\n\n${draft}\n\n_Send it?_`, taskId: task.id };
  }
  const res = await tg(token, 'sendMessage', { chat_id: match.telegram_id, text: draft });
  if (!res?.ok) return { text: `❌ Couldn't reach *${match.name}* just now.` };
  return { text: `💛 Sent to *${match.name}*:\n\n${draft}` };
}

/** Perform the actual send for an approved owner_action task. Shared by the
 *  Telegram approve button (replyEngine) and the in-app Tasks board. */
export async function sendApprovedOwnerTask(token, business, task) {
  const p = task.payload || {};
  const draft = p.message_draft || p.message || '';
  let confirm = '';
  try {
    if (p.action === 'dm_client') {
      confirm = await ownerDmClient(token, business, `${p.target} ${draft}`);
    } else if (p.action === 'dm_team') {
      confirm = await ownerDmTeam(token, business, p.target, draft);
    } else if (p.action === 'broadcast') {
      const r = await broadcastToClients(token, business, { filter: p.target, message: draft });
      confirm = `✅ Broadcast sent — ${r.sent}/${r.count} delivered.`;
    } else if (p.action === 'message_person') {
      if (!p.recipient_tg_id) confirm = '❌ Missing recipient.';
      else {
        const r = await tg(token, 'sendMessage', {
          chat_id: p.recipient_tg_id, text: draft,
          ...(business.telegram_biz_conn_id && { business_connection_id: business.telegram_biz_conn_id }),
        });
        confirm = r?.ok ? `💛 Sent to *${p.target}*.` : `❌ Couldn't reach *${p.target}*.`;
      }
    } else {
      confirm = '❌ Unknown task action.';
    }
  } catch (e) {
    confirm = `❌ Couldn't send: ${e.message?.slice(0, 120) || 'error'}`;
  }

  const sb = supabase();
  const rec = p.recurrence;
  if (rec && (rec.kind === 'daily' || rec.kind === 'weekly')) {
    const next = nextRunFromRecurrence(rec);
    await sb.from('agent_tasks').update({
      status: 'pending',
      scheduled_at: next ? next.toISOString() : task.scheduled_at,
      notification_message_id: null,
      payload: { ...p, message_draft: null, last_sent_at: new Date().toISOString() },
    }).eq('id', task.id);
  } else {
    await sb.from('agent_tasks').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', task.id);
  }
  return confirm;
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
      await tg(token, 'sendMessage', {
        chat_id: c.telegram_id, text: message,
        ...(business.telegram_biz_conn_id && { business_connection_id: business.telegram_biz_conn_id }),
      });
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
  return `✅ *${name}* added!\n\nPrice: *${price.toLocaleString()} ETB*${stockStr}\n\nMiniMe will now include it in replies and customers can order it.`;
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

export async function loadOwnerHistory(businessId) {
  const sb = supabase();
  const { data } = await sb.from('businesses').select('notification_prefs').eq('id', businessId).single();
  return data?.notification_prefs?.owner_chat || [];
}

export async function saveOwnerHistory(businessId, history) {
  const sb = supabase();
  const { data: cur } = await sb.from('businesses').select('notification_prefs').eq('id', businessId).single();
  const prefs = { ...(cur?.notification_prefs || {}), owner_chat: history.slice(-MAX_OWNER_TURNS) };
  await sb.from('businesses').update({ notification_prefs: prefs }).eq('id', businessId);
}

/**
 * Core owner agent — runs the tool-using brain and RETURNS the reply text(s)
 * without any Telegram I/O. Action tools (dm_client, broadcast, research…) still
 * perform their side-effects (they message OTHER people); only the reply TO the
 * owner is returned, so this same brain powers both the Telegram DM
 * (handleOwnerPrompt) and the in-app Assistant chat (/api/agent/assistant).
 */
export async function runOwnerAgent({ token, business, ownerText, history = [] }) {
  // Load persistent business context (top partners, deals, campaigns, owner facts)
  let memoryBlock = '';
  try {
    const { loadOwnerContext } = await import('./ownerMemory');
    memoryBlock = await loadOwnerContext(business.id);
  } catch (e) { console.warn('[loadOwnerContext]', e.message); }

  // Who the owner's family/friends are — so "text my gf" / "message mom" resolves.
  const people = business.notification_prefs?.personal_contacts || [];
  const peopleBlock = people.length
    ? people.slice(0, 30).map(c =>
        `• ${c.name}${c.relation ? ` (${c.relation})` : ''}` +
        `${Array.isArray(c.aliases) && c.aliases.length ? ` — you call them: ${c.aliases.join(', ')}` : ''}` +
        `${c.context ? ` — ${String(c.context).slice(0, 120)}` : ''}`).join('\n')
    : '(none saved yet — the owner can add family/friends in "People you know")';

  const systemContent = `You are MiniMe — ${business.owner_name || 'the owner'}'s personal AI chief-of-staff. You work for them across BOTH their business (${business.name}) and their personal life. Today is ${new Date().toISOString().slice(0, 10)} (${new Date().toLocaleDateString('en-GB', { weekday: 'long' })}).

Your job: take work OFF their plate. Get things DONE, and PROACTIVELY suggest the next step so they don't have to think of everything themselves.

═══ CORE PRINCIPLE: ACT FIRST. DON'T ASK IF YOU CAN INFER. ═══
• "find me X" / "research X" / "compare X" → call research_market and JUST GO.
• "ask my supplier" / "contact my X" → use TOP PARTNERS in MEMORY, pick the best match, call message_other_business.
• "do it" / "yes" / "tell her" / "send that" → resolve against the last turns of THIS chat.
• "plan my day" / "what should I do" / "what's on" / "get me organized" → call plan_my_day.
• "message <person> on <day>" / "every Monday…" → schedule_task / schedule_recurring.
• "follow up with X until they reply" / "chase X" / "keep texting X" / "don't let them ghost" → follow_up (autonomous, no approval needed — sends and checks for reply automatically).
• "what do you know about X" / "tell me about Sara" / "who is X" / "anything on this customer" → recall_person.
• When drafting messages to people, write in the owner's voice — warm, brief, no quote marks, no "[from owner]".

═══ PERSONAL + BUSINESS ═══
This is a PERSONAL assistant, not only a shop tool. Help with personal things too — answer questions, think decisions through, draft messages, manage personal reminders/tasks (set_reminder, schedule_task). When a request is personal, NEVER pitch the business or mention products.

You know the owner's family and friends (below). When they say "text my gf", "message mom", "send this to <name>", or give a GOAL like "make my girlfriend happy" / "cheer him up" → call message_person (resolve who from this list). Write to them like the owner would to someone they love — warm and real.

PEOPLE YOU KNOW:
${peopleBlock}

═══ BE PROACTIVE ═══
After doing what they asked, when genuinely useful, add ONE short concrete suggestion for what to handle next (an order to chase, someone to follow up, a reminder worth setting). One line. Never nag, never pad.

ASK before acting ONLY when: (1) sending money over 5,000 ETB to a new recipient; (2) publishing publicly / broadcasting to >5 people; (3) the request is truly ambiguous and MEMORY can't resolve it.
For broadcast: call dm_all_clients with confirm:false first (returns count), confirm with the owner, then confirm:true after yes.

The \`reply\` tool is how you actually TALK — answer personal/general questions, give advice, chat naturally. Don't use it to ask "what budget?"/"which one?" — infer or use an action tool.

═══════════════ MEMORY (persistent context) ═══════════════
${memoryBlock || '(No prior activity yet — fresh account.)'}
═══════════════════════════════════════════════════════════════`;

  const messages = [{ role: 'system', content: systemContent }];
  for (const turn of history) {
    if (turn.role && turn.content) messages.push({ role: turn.role, content: turn.content });
  }
  messages.push({ role: 'user', content: ownerText });

  const completion = await openai.chat.completions.create({
    model: MODEL,
    temperature: 0.4,
    max_tokens: 700,
    tools: OWNER_TOOLS,
    tool_choice: 'auto',
    messages,
  });

  const msg = completion.choices[0].message;
  const calls = msg.tool_calls || [];
  const outputs = [];

  if (!calls.length) {
    if (msg.content) outputs.push(msg.content);
  } else {
    // When on (default), owner-commanded message sends are drafted for approval
    // (Send/Cancel) instead of going out immediately. Owner can turn this off.
    const confirmSend = business.notification_prefs?.confirm_before_send !== false;
    for (const c of calls) {
      let args = {};
      try { args = JSON.parse(c.function.arguments || '{}'); } catch {}
      let outText = '';
      let outItem = null; // structured output: { text, taskId } → renders Send/Cancel
      if (c.function.name === 'dm_client') {
        if (confirmSend) {
          const t = await queueOwnerSend(business, { action: 'dm_client', target: args.client_query, message_draft: args.message });
          outItem = t ? { text: `📝 Draft to *${args.client_query}*:\n\n${args.message}\n\n_Send it?_`, taskId: t.id } : { text: '❌ Could not prepare that draft.' };
        } else {
          outText = await ownerDmClient(token, business, `${args.client_query} ${args.message}`);
        }
      } else if (c.function.name === 'dm_team_member') {
        if (confirmSend) {
          const t = await queueOwnerSend(business, { action: 'dm_team', target: args.target, message_draft: args.message });
          outItem = t ? { text: `📝 Draft to *${args.target}*:\n\n${args.message}\n\n_Send it?_`, taskId: t.id } : { text: '❌ Could not prepare that draft.' };
        } else {
          outText = await ownerDmTeam(token, business, args.target, args.message);
        }
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
      } else if (c.function.name === 'schedule_task') {
        const when = eatIsoToUtc(args.when_iso);
        if (!when) outText = "❌ I couldn't understand that time — try again with a clearer day/time.";
        else {
          const r = await createOwnerTask(business.id, {
            action: args.action, target: args.target, message: args.message,
            scheduled_at: when.toISOString(), recurrence: { kind: 'once' },
          });
          outText = r.ok
            ? `📅 Scheduled — I'll draft your ${actionLabel(args.action, args.target)} and bring it to you to approve at *${fmtWhen(r.task.scheduled_at)}*.`
            : `❌ Couldn't schedule that (${r.error}).`;
        }
      } else if (c.function.name === 'schedule_recurring') {
        const first = nextRunFromRecurrence(args.recurrence);
        if (!first) outText = "❌ I couldn't work out that schedule — tell me a day and time.";
        else {
          const r = await createOwnerTask(business.id, {
            action: args.action, target: args.target, message: args.message,
            scheduled_at: first.toISOString(), recurrence: args.recurrence,
          });
          outText = r.ok
            ? `🔁 Recurring task set — ${recurrenceLabel(args.recurrence)}. I'll draft each one for your approval before it sends. First: *${fmtWhen(r.task.scheduled_at)}*.`
            : `❌ Couldn't schedule that (${r.error}).`;
        }
      } else if (c.function.name === 'follow_up') {
        const r = await createFollowUpTask(business, {
          target: args.target, message: args.message,
          interval: args.interval, max_attempts: args.max_attempts,
        });
        if (r.ok) {
          outText = `🔄 Got it — I'll follow up with *${r.customer.name || args.target}* ${args.interval === 'every_6h' ? 'every 6 hours' : args.interval === 'every_2d' ? 'every 2 days' : args.interval === 'weekly' ? 'weekly' : 'daily'} until they reply (max ${r.task.payload.max_attempts} times). First follow-up: *${fmtWhen(r.task.scheduled_at)}*.\n\n_I'll send it automatically and tell you when they reply._`;
        } else if (r.error === 'no_secretary') {
          outText = `❌ Follow-up requires your Telegram Business to be connected — messages send from your personal account. Go to Telegram → Settings → Business → Chatbots to connect.`;
        } else if (r.error === 'no_customer_match') {
          outText = `❌ I don't see a customer matching "${args.target}". Check your /customers list.`;
        } else if (r.error === 'no_telegram_id') {
          outText = `❌ That customer has no Telegram ID — I can't message them.`;
        } else {
          outText = `❌ Couldn't set up follow-up (${r.error}).`;
        }
      } else if (c.function.name === 'list_tasks') {
        outText = await listOwnerTasks(business.id);
      } else if (c.function.name === 'cancel_task') {
        outText = await cancelOwnerTask(business.id, args.query);
      } else if (c.function.name === 'message_other_business') {
        outText = await sendToOtherBusiness(business, args);
      } else if (c.function.name === 'research_market') {
        outText = await runResearchCampaign(business, args);
      } else if (c.function.name === 'connect_with_business') {
        outText = await connectWithBusiness(business, args);
      } else if (c.function.name === 'browse_network') {
        outText = await browseNetwork(business, args);
      } else if (c.function.name === 'message_person') {
        const r = await prepareMessagePersonal(token, business, args.who, args.goal_or_message, confirmSend);
        if (r.taskId) outItem = { text: r.text, taskId: r.taskId };
        else outText = r.text;
      } else if (c.function.name === 'plan_my_day') {
        outText = await planMyDay(business);
      } else if (c.function.name === 'remember_fact') {
        outText = await rememberFactForOwner(business, args.who, args.fact);
      } else if (c.function.name === 'recall_person') {
        outText = await recallPerson(business, args.who);
      } else if (c.function.name === 'reply') {
        outText = args.text || '...';
      }
      if (outItem) outputs.push(outItem);
      else if (outText) outputs.push(outText);
    }
  }

  return { outputs };
}

/**
 * Telegram wrapper around runOwnerAgent: fires due reminders, runs the brain,
 * sends each reply to the owner's chat, and persists the shared owner_chat
 * history (also used by the in-app Assistant so the thread stays continuous).
 */
export async function handleOwnerPrompt({ token, business, chatId, ownerText }) {
  try { await fireDueReminders(token, business); } catch {}
  const history = await loadOwnerHistory(business.id);

  const { outputs } = await runOwnerAgent({ token, business, ownerText, history });
  for (const out of outputs) {
    if (!out) continue;
    if (typeof out === 'string') {
      await tg(token, 'sendMessage', { chat_id: chatId, text: out, parse_mode: 'Markdown', disable_web_page_preview: true });
    } else if (out.text) {
      // A draft awaiting approval → attach Send / Cancel buttons.
      const reply_markup = out.taskId ? {
        inline_keyboard: [[
          { text: '✅ Send', callback_data: `task_send_${out.taskId}` },
          { text: '❌ Cancel', callback_data: `task_cancel_${out.taskId}` },
        ]],
      } : undefined;
      const res = await tg(token, 'sendMessage', { chat_id: chatId, text: out.text, parse_mode: 'Markdown', disable_web_page_preview: true, reply_markup });
      if (out.taskId && res?.ok && res.result?.message_id) {
        await supabase().from('agent_tasks').update({ notification_message_id: res.result.message_id }).eq('id', out.taskId);
      }
    }
  }

  const assistantSummary = outputs.map(o => (typeof o === 'string' ? o : (o?.text || ''))).join('\n\n').slice(0, 800);
  const next = [
    ...history,
    { role: 'user', content: ownerText.slice(0, 800) },
    { role: 'assistant', content: assistantSummary },
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

// ─────────────────────────── Connect With Business ───────────────────────────
async function connectWithBusiness(business, args) {
  try {
    const { sendWarmIntro, findBusinessByUsername } = await import('./b2b');
    const targetUsername = String(args.username || '').replace(/^@/, '').trim();
    if (!targetUsername) return `❌ Which business should I connect you with? Tell me their @username.`;
    const targetBiz = await findBusinessByUsername(targetUsername);
    if (!targetBiz) return `❌ @${targetUsername} isn't on MiniMe — they need to sign up first.`;
    const res = await sendWarmIntro({
      requesterBiz: business,
      targetBiz,
      campaignQuery: args.context || 'your inquiry',
      note: args.note,
    });
    return res.ok
      ? `🤝 *Intro sent to @${targetUsername}!*\n\n_They'll be notified and can reply through their bot. I'll DM you when they respond._`
      : `❌ Couldn't send intro (${res.error || 'unknown'}).`;
  } catch (e) {
    console.error('[connectWithBusiness]', e?.message || e);
    return `❌ Couldn't connect — try again in a moment.`;
  }
}

// ─────────────────────────── Browse Network ───────────────────────────────────
async function browseNetwork(business, args) {
  try {
    const { browseNetwork: browse } = await import('./b2b');
    const results = await browse({
      category: args.category,
      query: args.query,
      excludeId: business.id,
      limit: Math.min(args.limit || 10, 20),
    });
    if (!results.length) {
      return `🔍 No businesses found on MiniMe matching that.${args.category ? ` Try a broader category or leave it blank.` : ''}`;
    }
    const lines = [`📋 *MiniMe Businesses — ${args.category || args.query || 'All'}*\n`];
    for (const biz of results) {
      const handle = biz.telegram_bot_username ? ` (@${biz.telegram_bot_username})` : '';
      const loc = biz.location ? ` · ${biz.location}` : '';
      const tags = Array.isArray(biz.tags) && biz.tags.length ? `\n   _${biz.tags.slice(0, 4).join(', ')}_` : '';
      lines.push(`• *${escapeMdInline(biz.name)}*${escapeMdInline(handle)}${escapeMdInline(loc)}${tags}`);
    }
    lines.push(`\n_Say "connect me with @username" to send an intro, or "research [category]" to get quotes._`);
    return lines.join('\n');
  } catch (e) {
    console.error('[browseNetwork]', e?.message || e);
    return `❌ Couldn't load the directory — try again in a moment.`;
  }
}

function escapeMdInline(s) {
  return String(s || '').replace(/([_*\[\]()~`>#+=|{}.!\\-])/g, '\\$1');
}
