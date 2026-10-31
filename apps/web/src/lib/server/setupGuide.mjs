/**
 * Step-by-step setup guide inside the owner's bot chat (pure, no I/O).
 *
 * Owners finished sign-up and got a link plus "Commands: /preview · /learn ·
 * /orders · /teach …" — no idea what to do first. 440 of 687 shops never
 * added a product and only 32 set up Telebirr. The guide walks one step at a
 * time, with buttons, and the bot takes the next message as the answer:
 *
 *   1. Products     — photo + name + price, or just type "Injera 45 birr"
 *   2. Payments     — Telebirr number or CBE account, saved to Settings → Payments
 *   3. The basics   — hours, location, delivery (what customers ask first)
 *   4. Try it       — see a real customer answer
 *   5. Share        — send the shop link to customers
 *
 * State lives in notification_prefs.setup:
 *   { awaiting, awaiting_at, skipped: [], previewed, shared, delivery_done, dismissed }
 */

export const STEP_KEYS = ['products', 'payments', 'basics', 'preview', 'share'];

/**
 * Two kinds of owner, two setups. Shops sell through a bot link; service
 * people and individuals mostly use Secretary on their own Telegram (54 of
 * the 111 active shops; more Secretary messages than shop-bot messages, and
 * half of those chats are friends and family). They got the shop checklist
 * — catalog, payments, share a link — that fits half of them.
 */
export const TRACKS = {
  shop: ['products', 'payments', 'basics', 'preview', 'share'],
  secretary: ['connect', 'people', 'style', 'rules', 'products'],
};

/** Which setup this owner gets: chosen, else guessed from what they've done. */
export function trackFor(setup = {}, facts = {}) {
  if (setup.track === 'shop' || setup.track === 'secretary') return setup.track;
  if (facts.secretaryConnected && !(facts.productCount > 0)) return 'secretary';
  return facts.productCount > 0 || facts.hasPayment ? 'shop' : null;
}

const TITLES = {
  connect: 'Connect MiniMe to your Telegram',
  people: 'Tell me who your family and friends are',
  style: 'Choose how I sound',
  rules: 'Give me your first rule',
  products: 'Add what you sell',
  payments: 'Tell me how customers pay you',
  basics: 'Answer the 3 things customers ask first',
  preview: 'See how I answer a customer',
  share: 'Share your shop link',
};

const WHY = {
  connect: 'So I can answer people who message you, as you — when you allow it.',
  people: 'I chat warmly with them and never sell to them.',
  style: 'Professional with customers, playful with friends — or just like you.',
  rules: 'Something I must always or never do, e.g. never share your home address.',
  products: "Without prices I can't quote anyone or take an order.",
  payments: 'So I can send customers your Telebirr / CBE details with every order.',
  basics: 'Opening hours, where you are, and delivery.',
  preview: 'Check I sound right before customers see me.',
  share: 'Customers can only reach me through your link.',
};

/** Which awaiting states are valid, and how long one stays live. */
export const AWAITING = ['product', 'telebirr', 'cbe', 'hours', 'location', 'delivery', 'rule', 'intake'];
export const AWAITING_TTL_MS = 30 * 60 * 1000;

/** Live awaiting state, or null when none / expired. */
export function activeAwaiting(setup, now = Date.now()) {
  const a = setup?.awaiting;
  if (!a || !AWAITING.includes(a)) return null;
  const at = Date.parse(setup.awaiting_at || 0);
  if (!at || now - at > AWAITING_TTL_MS) return null;
  return a;
}

/**
 * Progress from real data, so a step done in the Mini App also counts.
 * facts: { productCount, hasPayment, hours, location }
 */
export function computeProgress(facts = {}, setup = {}) {
  const skipped = new Set(Array.isArray(setup.skipped) ? setup.skipped : []);
  const track = trackFor(setup, facts) || 'shop';
  const basicsDone = (!!String(facts.hours || '').trim() || skipped.has('hours'))
    && (!!String(facts.location || '').trim() || skipped.has('location'))
    && (!!setup.delivery_done || skipped.has('delivery'));
  const done = {
    connect: !!facts.secretaryConnected,
    people: (facts.peopleCount || 0) > 0,
    style: !!facts.styleSet || !!setup.style_done,
    rules: (facts.ownRuleCount || 0) > 0,
    products: (facts.productCount || 0) > 0,
    payments: !!facts.hasPayment,
    basics: basicsDone,
    preview: !!setup.previewed,
    share: !!setup.shared,
  };
  const steps = TRACKS[track].map(key => ({
    key, title: TITLES[key], why: WHY[key],
    done: done[key], skipped: !done[key] && skipped.has(key),
  }));
  const next = steps.find(s => !s.done && !s.skipped) || null;
  const doneCount = steps.filter(s => s.done).length;
  return { steps, next, doneCount, total: steps.length, complete: !next, track, chosen: !!trackFor(setup, facts) };
}

function bar(done, total) {
  return '●'.repeat(done) + '○'.repeat(Math.max(0, total - done));
}

/** The checklist message. */
export function guideText(progress, { ownerFirst = '' } = {}) {
  if (!progress.chosen) {
    return [`👋 *${ownerFirst ? `${ownerFirst}, what` : 'What'} do you want MiniMe to do for you?*`, '',
      '🛍️ *Sell for my shop* — customers message your shop bot; I answer, quote prices and take orders.',
      '',
      '📱 *Answer my own Telegram* — I reply to people who message *you*, as you: customers, friends and family, each the right way.',
      '', '_You can do both later._'].join('\n');
  }
  const sec = progress.track === 'secretary';
  const head = progress.complete
    ? `🎉 *${ownerFirst ? `${ownerFirst}, you're` : "You're"} all set!*`
    : `📋 *Let's get ${sec ? 'your assistant' : 'your shop'} ready${ownerFirst ? `, ${ownerFirst}` : ''}*`;
  const lines = [head, `${bar(progress.doneCount, progress.total)}  ${progress.doneCount} of ${progress.total} done`, ''];
  progress.steps.forEach((s, i) => {
    const mark = s.done ? '✅' : s.skipped ? '⏭️' : (progress.next?.key === s.key ? '👉' : '▫️');
    lines.push(`${mark} ${i + 1}. ${s.title}`);
  });
  lines.push('');
  if (progress.complete && sec) {
    lines.push("I'm answering people who message you now — customers as your business, family and friends as you. I'll ask whenever I'm not sure who someone is or don't know an answer.");
    lines.push('', 'Type /who to sort new people, /personality to change how I sound, or /help for more.');
  } else if (progress.complete) {
    lines.push("I'm answering your customers now. When someone orders, I'll send you the order here, and I'll ask you whenever I don't know something.");
    lines.push('', 'Type /help any time to see what else I can do.');
  } else {
    lines.push(`*Next:* ${progress.next.title}`, `_${progress.next.why}_`);
  }
  return lines.join('\n');
}

/** Buttons under the checklist. */
export function guideKeyboard(progress) {
  if (!progress.chosen) {
    return { inline_keyboard: [
      [{ text: '🛍️ Sell for my shop', callback_data: 'setup_track_shop' }],
      [{ text: '📱 Answer my own Telegram', callback_data: 'setup_track_secretary' }],
    ] };
  }
  if (progress.complete) return { inline_keyboard: [[{ text: '📥 Who’s waiting on me?', callback_data: 'owner_inbox' }]] };
  const rows = [[{ text: `▶️ Start: ${progress.next.title}`, callback_data: `setup_go_${progress.next.key}` }]];
  if (progress.track === 'shop' && ['products', 'basics'].includes(progress.next.key)) {
    rows.push([{ text: '✍️ Describe it all in one message', callback_data: 'setup_intake' }]);
  }
  rows.push([
    { text: '⏭️ Skip this step', callback_data: `setup_skip_${progress.next.key}` },
    { text: '✖️ Later', callback_data: 'setup_hide' },
  ]);
  rows.push([{ text: progress.track === 'secretary' ? '🛍️ Switch to shop setup' : '📱 Switch to my-Telegram setup', callback_data: `setup_track_${progress.track === 'secretary' ? 'shop' : 'secretary'}` }]);
  return { inline_keyboard: rows };
}

/** First question of a step: { text, keyboard, awaiting }. */
export function stepStart(key, { exampleProduct = '', businessName = '', botUsername = 'MiniMeAgentBot' } = {}) {
  switch (key) {
    case 'connect':
      return {
        awaiting: null,
        text: [
          '📱 *Connect MiniMe to your Telegram*',
          '',
          '1. Open Telegram *Settings → Telegram Business → Chatbots*',
          `   (no Business menu? Settings → Telegram Premium first)`,
          `2. Type *@${botUsername}* and add it`,
          '3. Turn on *Reply to messages*',
          '',
          "Then come back and tap the button. I'll only reply the way you set up in the next steps.",
        ].join('\n'),
        keyboard: { inline_keyboard: [[{ text: "✅ I've connected it", callback_data: 'setup_check_connect' }]] },
      };
    case 'people':
      return {
        awaiting: null,
        text: "👨‍👩‍👧 *Who are your family and friends?*\n\nI'll show you the people I've seen — one tap each. You can also just tell me any time: _Sara is my sister_.",
        keyboard: null, // the caller sends the /who card
      };
    case 'style':
      return { awaiting: null, text: '🎭 *How should I sound?*', keyboard: null }; // caller sends the personality menu
    case 'rules':
      return {
        awaiting: 'rule',
        text: "📏 *Your first rule*\n\nTell me one thing I must *always* or *never* do when I reply as you. For example:\n_Never share my home address_\n_Always reply to customers in Amharic_\n_Never talk business with my family_",
        keyboard: { inline_keyboard: [[{ text: '⏭️ Skip', callback_data: 'setup_skip_rules' }]] },
      };
    case 'products':
      return {
        awaiting: 'product',
        text: [
          '🛍️ *Step 1 — Add what you sell*',
          '',
          'Send me a *photo* with its name and price as the caption, like:',
          '_Red dress 1500 birr_',
          '',
          'No photo? Just type it: _Injera 45 birr_',
          '',
          'Send as many as you like, one per message. Tap *Done* when you’re finished.',
        ].join('\n'),
        keyboard: { inline_keyboard: [[{ text: '✅ Done adding', callback_data: 'setup_done_products' }]] },
      };
    case 'payments':
      return {
        awaiting: null,
        text: '💳 *Step 2 — How do customers pay you?*\n\nPick one. You can add the other later.',
        keyboard: { inline_keyboard: [
          [{ text: '📱 Telebirr', callback_data: 'setup_pay_telebirr' }, { text: '🏦 CBE account', callback_data: 'setup_pay_cbe' }],
          [{ text: '⏭️ Skip — I take cash only', callback_data: 'setup_skip_payments' }],
        ] },
      };
    case 'basics':
      return basicsQuestion('hours');
    case 'preview':
      return {
        awaiting: null,
        text: `👀 *Step 4 — See how I answer*\n\nI'll answer a customer question${exampleProduct ? ` about *${exampleProduct}*` : ''} exactly the way a customer would see it.`,
        keyboard: { inline_keyboard: [[{ text: '👀 Show me', callback_data: 'setup_run_preview' }]] },
      };
    case 'share':
      return {
        awaiting: null,
        text: `📣 *Step 5 — Share your shop link*\n\nCustomers reach ${businessName ? `*${businessName}*` : 'your shop'} through this link. Put it in your Telegram channel, bio, and status.`,
        keyboard: null, // filled by the caller with the real link
      };
    default:
      return null;
  }
}

/** One of the three basics questions. */
export function basicsQuestion(which) {
  const q = {
    hours: ['🕘 *Step 3 of 5 — When are you open?*', 'For example: _Mon–Sat 8:30am–7pm, closed Sunday_'],
    location: ['📍 *Where are you?*', 'For example: _Bole, near Edna Mall, 2nd floor_'],
    delivery: ['🚚 *Do you deliver? How much does it cost?*', 'For example: _Yes, in Addis — 150 birr, same day_ or _No, pickup only_'],
  }[which];
  return {
    awaiting: which,
    text: `${q[0]}\n\n${q[1]}`,
    keyboard: { inline_keyboard: [[{ text: '⏭️ Skip', callback_data: `setup_skip_${which}` }]] },
  };
}

/** The question after `which` within the basics step, or null when basics are finished. */
export function nextBasics(which) {
  return { hours: 'location', location: 'delivery' }[which] || null;
}

/**
 * First basics question still worth asking from `from` on: skips what the
 * profile already has (hours, location) and what was answered or skipped.
 * Owners were asked their hours again right after setting them in the app.
 */
export function nextOpenBasics(facts = {}, setup = {}, from = 'hours') {
  const skipped = new Set(Array.isArray(setup.skipped) ? setup.skipped : []);
  const answered = {
    hours: !!String(facts.hours || '').trim(),
    location: !!String(facts.location || '').trim(),
    delivery: !!setup.delivery_done,
  };
  for (let q = from; q; q = nextBasics(q)) {
    if (!answered[q] && !skipped.has(q)) return q;
  }
  return null;
}

/** Escape text for Telegram's legacy Markdown (links with _ broke the share step). */
export function mdEscape(text) {
  return String(text ?? '').replace(/([_*`\[])/g, '\\$1');
}

/** Normalise an Ethiopian mobile number to +2519XXXXXXXX / +2517XXXXXXXX, or null. */
export function normalizeEtPhone(text) {
  const digits = String(text || '').replace(/[^\d+]/g, '');
  let m = digits.match(/^(?:\+?251|0)?([79]\d{8})$/);
  return m ? `+251${m[1]}` : null;
}

/** A CBE account number (13 digits, usually starting 1000), or null. */
export function normalizeCbeAccount(text) {
  const digits = String(text || '').replace(/\D/g, '');
  return /^\d{13}$/.test(digits) ? digits : null;
}

/** Commands and "cancel" end a guided step instead of being taken as the answer. */
export function cancelsAwaiting(text) {
  const t = String(text || '').trim();
  return t.startsWith('/') || /^(cancel|stop|exit|ይቅር|አቁም)$/i.test(t);
}
