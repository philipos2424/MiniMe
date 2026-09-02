/**
 * The board prunes itself.
 *
 * Two questions, each asked at most once per item: "do you still have it"
 * before a post ages out, and "did you swap it" three days after the first
 * person got the lister's handle. Silence is a valid answer to both — the post
 * simply goes dark. Nobody moderates this by hand.
 *
 * `send` is injected so the whole job is testable without a bot token.
 */
import { COMPLETION_DELAY_DAYS } from './constants.mjs';

const DAY = 86400000;

const P = {
  en: {
    expiry: (t) => `Still have the *${t}*?`,
    keep: '✅ Yes, keep it live', gone: '❌ Gone',
    completion: (t) => `Did you swap the *${t}*?`,
    done: '🎉 Yes', notYet: 'Not yet',
  },
  am: {
    expiry: (t) => `*${t}* አሁንም አለዎት?`,
    keep: '✅ አዎ፣ ይቀጥል', gone: '❌ የለም',
    completion: (t) => `*${t}* ተቀይሯል?`,
    done: '🎉 አዎ', notYet: 'ገና',
  },
};

const lang_ = (l) => P[l === 'am' ? 'am' : 'en'];

export function expiryPrompt(item, lang = 'en') {
  const m = lang_(lang);
  return {
    text: m.expiry(item.title),
    keyboard: [[
      { text: m.keep, callback_data: `sw:keep:${item.id}` },
      { text: m.gone, callback_data: `sw:gone:${item.id}` },
    ]],
  };
}

export function completionPrompt(item, lang = 'en') {
  const m = lang_(lang);
  return {
    text: m.completion(item.title),
    keyboard: [[
      { text: m.done,   callback_data: `sw:done:${item.id}` },
      { text: m.notYet, callback_data: `sw:notyet:${item.id}` },
    ]],
  };
}

// No chat_id column on swap_items — the search bot only ever talks to
// listers in private chats, where the chat id equals the Telegram user id.
const COLS = 'id, title, telegram_user_id, lang, status, first_reveal_at, completion_asked_at, expiry_asked_at, expires_at';

/**
 * One pass. Returns counts rather than throwing on a per-item failure: a
 * lister who blocked the bot must not stop the other hundred prompts.
 */
export async function runSwapLifecycle(sb, { send, now = Date.now() } = {}) {
  const nowIso = new Date(now).toISOString();
  let expiryAsked = 0, completionAsked = 0, expired = 0;

  // ── Ask before expiring ───────────────────────────────────────────────────
  const { data: expiring } = await sb.from('swap_items').select(COLS)
    .eq('status', 'active')
    .lte('expires_at', new Date(now + 2 * DAY).toISOString())
    .is('expiry_asked_at', null)
    .limit(200);

  for (const item of expiring || []) {
    try {
      const p = expiryPrompt(item, item.lang);
      await send({ chatId: item.telegram_user_id, text: p.text, keyboard: p.keyboard });
      await sb.from('swap_items').update({ expiry_asked_at: nowIso }).eq('id', item.id);
      expiryAsked++;
    } catch (e) {
      console.warn('[swap] expiry prompt failed:', item.id, e.message);
    }
  }

  // ── Ask whether the swap happened ─────────────────────────────────────────
  const { data: revealed } = await sb.from('swap_items').select(COLS)
    .eq('status', 'active')
    .lt('first_reveal_at', new Date(now - COMPLETION_DELAY_DAYS * DAY).toISOString())
    .is('completion_asked_at', null)
    .limit(200);

  for (const item of revealed || []) {
    try {
      const p = completionPrompt(item, item.lang);
      await send({ chatId: item.telegram_user_id, text: p.text, keyboard: p.keyboard });
      await sb.from('swap_items').update({ completion_asked_at: nowIso }).eq('id', item.id);
      completionAsked++;
    } catch (e) {
      console.warn('[swap] completion prompt failed:', item.id, e.message);
    }
  }

  // ── Retire what is past due and unanswered ────────────────────────────────
  const { data: dead } = await sb.from('swap_items').select('id')
    .eq('status', 'active').lte('expires_at', nowIso).limit(500);

  for (const item of dead || []) {
    try {
      await sb.from('swap_items').update({ status: 'expired' }).eq('id', item.id);
      expired++;
    } catch (e) {
      console.warn('[swap] retire failed:', item.id, e.message);
    }
  }

  return { expiryAsked, completionAsked, expired };
}
