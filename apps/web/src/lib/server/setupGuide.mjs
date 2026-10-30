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

const TITLES = {
  products: 'Add what you sell',
  payments: 'Tell me how customers pay you',
  basics: 'Answer the 3 things customers ask first',
  preview: 'See how I answer a customer',
  share: 'Share your shop link',
};

const WHY = {
  products: "Without prices I can't quote anyone or take an order.",
  payments: 'So I can send customers your Telebirr / CBE details with every order.',
  basics: 'Opening hours, where you are, and delivery.',
  preview: 'Check I sound right before customers see me.',
  share: 'Customers can only reach me through your link.',
};

/** Which awaiting states are valid, and how long one stays live. */
export const AWAITING = ['product', 'telebirr', 'cbe', 'hours', 'location', 'delivery'];
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
  const basicsDone = (!!String(facts.hours || '').trim() || skipped.has('hours'))
    && (!!String(facts.location || '').trim() || skipped.has('location'))
    && (!!setup.delivery_done || skipped.has('delivery'));
  const done = {
    products: (facts.productCount || 0) > 0,
    payments: !!facts.hasPayment,
    basics: basicsDone,
    preview: !!setup.previewed,
    share: !!setup.shared,
  };
  const steps = STEP_KEYS.map(key => ({
    key, title: TITLES[key], why: WHY[key],
    done: done[key], skipped: !done[key] && skipped.has(key),
  }));
  const next = steps.find(s => !s.done && !s.skipped) || null;
  const doneCount = steps.filter(s => s.done).length;
  return { steps, next, doneCount, total: steps.length, complete: !next };
}

function bar(done, total) {
  return '●'.repeat(done) + '○'.repeat(Math.max(0, total - done));
}

/** The checklist message. */
export function guideText(progress, { ownerFirst = '' } = {}) {
  const head = progress.complete
    ? `🎉 *${ownerFirst ? `${ownerFirst}, you're` : "You're"} all set!*`
    : `📋 *Let's get your shop ready${ownerFirst ? `, ${ownerFirst}` : ''}*`;
  const lines = [head, `${bar(progress.doneCount, progress.total)}  ${progress.doneCount} of ${progress.total} done`, ''];
  progress.steps.forEach((s, i) => {
    const mark = s.done ? '✅' : s.skipped ? '⏭️' : (progress.next?.key === s.key ? '👉' : '▫️');
    lines.push(`${mark} ${i + 1}. ${s.title}`);
  });
  lines.push('');
  if (progress.complete) {
    lines.push("I'm answering your customers now. When someone orders, I'll send you the order here, and I'll ask you whenever I don't know something.");
    lines.push('', 'Type /help any time to see what else I can do.');
  } else {
    lines.push(`*Next:* ${progress.next.title}`, `_${progress.next.why}_`);
  }
  return lines.join('\n');
}

/** Buttons under the checklist. */
export function guideKeyboard(progress) {
  if (progress.complete) return { inline_keyboard: [[{ text: '📥 Who’s waiting on me?', callback_data: 'owner_inbox' }]] };
  const rows = [[{ text: `▶️ Start: ${progress.next.title}`, callback_data: `setup_go_${progress.next.key}` }]];
  rows.push([
    { text: '⏭️ Skip this step', callback_data: `setup_skip_${progress.next.key}` },
    { text: '✖️ Later', callback_data: 'setup_hide' },
  ]);
  return { inline_keyboard: rows };
}

/** First question of a step: { text, keyboard, awaiting }. */
export function stepStart(key, { exampleProduct = '', businessName = '' } = {}) {
  switch (key) {
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
