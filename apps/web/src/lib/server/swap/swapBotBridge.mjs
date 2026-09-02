/**
 * Everything the search bot needs to know about swaps, in one module.
 *
 * searchBot.js is already 1800+ lines. It gets four call-outs to this file and
 * no swap logic of its own, so the feature can be read, tested and removed as
 * a unit.
 */
import { newDraft, advanceDraft, draftPrompt, publishDraft } from './swapPost.mjs';
import { fetchSwapMatches, selectSwapCards, formatSwapBlocks, swapEmptyLine, isCommercialQuery } from './swapSearch.mjs';
import { recordInterest, recordReport, revealText } from './swapInterest.mjs';
import { postLang } from './swapParse.mjs';
import { DRAFT_TTL_MINUTES, REVEALS_PER_DAY, EXPIRY_DAYS } from './constants.mjs';

/** `sw:want:abc` → { action: 'want', arg: 'abc' }. Leaves `sb:` callbacks alone. */
export function parseSwapCallback(data) {
  const s = String(data || '');
  if (!s.startsWith('sw:')) return null;
  const [, action, ...rest] = s.split(':');
  if (!action) return null;
  return { action, arg: rest.join(':') };
}

// ── Draft store ─────────────────────────────────────────────────────────────
// In Postgres, not a Map: on Vercel the instance that answered step 1 is not
// guaranteed to answer step 2, and a lost half-finished post is a lister who
// does not come back.

export async function loadDraft(sb, userId) {
  const { data } = await sb.from('swap_drafts').select('*').eq('telegram_user_id', userId).maybeSingle();
  if (!data) return null;
  if (Date.now() - new Date(data.updated_at).getTime() > DRAFT_TTL_MINUTES * 60000) {
    await clearDraft(sb, userId);
    return null;
  }
  return data;
}

export async function saveDraft(sb, draft) {
  await sb.from('swap_drafts').upsert({
    telegram_user_id: draft.telegram_user_id,
    chat_id: draft.chat_id,
    step: draft.step,
    payload: draft.payload,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'telegram_user_id' });
}

export async function clearDraft(sb, userId) {
  await sb.from('swap_drafts').delete().eq('telegram_user_id', userId);
}

const say = (tg, token, chatId, prompt) => tg(token, 'sendMessage', {
  chat_id: chatId, text: prompt.text, parse_mode: 'Markdown',
  reply_markup: prompt.keyboard ? { inline_keyboard: prompt.keyboard } : undefined,
});

// ── Entry points ────────────────────────────────────────────────────────────

/** A photo arrived. Open a draft, or attach to the one already open. */
export async function handleSwapPhoto({ sb, tg, token, msg }) {
  const userId = msg.from?.id;
  const chatId = msg.chat.id;
  const fileId = msg.photo?.[msg.photo.length - 1]?.file_id;
  if (!userId || !fileId) return;

  const existing = await loadDraft(sb, userId);
  if (existing) {
    const { draft } = advanceDraft(existing, { kind: 'photo', fileId });
    await saveDraft(sb, draft);
    return;
  }

  const draft = newDraft({ telegramUserId: userId, chatId, fileId });
  await saveDraft(sb, draft);
  await say(tg, token, chatId, draftPrompt('await_kind', 'en'));
}

/**
 * A text message arrived. If a draft is mid-flow it belongs to the wizard, not
 * to search. Returns true when consumed.
 */
export async function handleSwapDraftText({ sb, tg, token, msg }) {
  const userId = msg.from?.id;
  if (!userId) return false;
  const draft = await loadDraft(sb, userId);
  if (!draft || draft.step === 'await_kind') return false;

  const r = advanceDraft(draft, { kind: 'text', value: msg.text });
  if (r.publish) return finishDraft({ sb, tg, token, draft: r.draft, msg });

  await saveDraft(sb, r.draft);
  if (r.prompt) await say(tg, token, msg.chat.id, r.prompt);
  return true;
}

async function finishDraft({ sb, tg, token, draft, msg }) {
  draft.telegram_username = msg.from?.username || null;
  const chatId = draft.chat_id || msg.chat.id;
  const lang = draft.payload.lang;

  if (!draft.telegram_username) {
    await clearDraft(sb, draft.telegram_user_id);
    await tg(token, 'sendMessage', {
      chat_id: chatId,
      text: lang === 'am'
        ? 'ለመቀየር የቴሌግራም @username ያስፈልጋል። Settings > Username ላይ አስቀምጠው እንደገና ይሞክሩ።'
        : 'To swap, people need a way to reach you. Set a Telegram @username (Settings > Username), then send the photo again.',
    });
    return true;
  }

  const res = await publishDraft(sb, draft);
  await clearDraft(sb, draft.telegram_user_id);

  if (res.refused) {
    await tg(token, 'sendMessage', {
      chat_id: chatId,
      text: res.refused === 'save_failed'
        ? "Couldn't save that — try again in a moment."
        : `Sorry, ${res.refused} can't be swapped on MiniMe.`,
    });
    return true;
  }

  await tg(token, 'sendMessage', {
    chat_id: chatId, parse_mode: 'Markdown',
    text: lang === 'am'
      ? `✅ ተለጠፈ። *${res.item.title}* የሚፈልጉ ሰዎች ያዩታል።`
      : `✅ Live. People searching for *${res.item.title}* will see it.`,
    reply_markup: { inline_keyboard: [[{ text: lang === 'am' ? '📋 የእኔ ልውውጦች' : '📋 My swaps', callback_data: 'sw:mine:0' }]] },
  });
  return true;
}

/** Route every `sw:` callback. Returns true when handled. */
export async function handleSwapCallback({ sb, tg, token, cq, rateLimitPersistent }) {
  const parsed = parseSwapCallback(cq.data);
  if (!parsed) return false;
  const chatId = cq.message.chat.id;
  const userId = cq.from.id;

  switch (parsed.action) {
    case 'kind': {
      const draft = await loadDraft(sb, userId);
      if (!draft) return true;
      if (parsed.arg === 'find') {
        await clearDraft(sb, userId);
        await tg(token, 'sendMessage', { chat_id: chatId, text: "I can't search by picture yet — type what you're looking for." });
        return true;
      }
      const r = advanceDraft(draft, { kind: 'tap', value: 'swap' });
      await saveDraft(sb, r.draft);
      if (r.prompt) await say(tg, token, chatId, r.prompt);
      return true;
    }

    case 'cond':
    case 'area': {
      const draft = await loadDraft(sb, userId);
      if (!draft) return true;
      const r = advanceDraft(draft, { kind: 'tap', value: parsed.arg });
      if (r.publish) { await finishDraft({ sb, tg, token, draft: r.draft, msg: cq.message ? { ...cq.message, from: cq.from } : cq }); return true; }
      await saveDraft(sb, r.draft);
      if (r.prompt) await say(tg, token, chatId, r.prompt);
      return true;
    }

    case 'want': {
      // The offer line is what makes a tap cost a sentence. Park the item id
      // in a draft-shaped row so the next text message is read as the offer.
      const cap = await rateLimitPersistent(String(userId), 'swap-reveal', REVEALS_PER_DAY, 86400);
      if (!cap.ok) {
        await tg(token, 'sendMessage', { chat_id: chatId, text: "You've asked for a lot of contacts today — try again tomorrow." });
        return true;
      }
      await saveDraft(sb, {
        telegram_user_id: userId, chat_id: chatId,
        step: 'await_offer', payload: { item_id: parsed.arg, photo_file_ids: [], lang: 'en' },
      });
      await tg(token, 'sendMessage', { chat_id: chatId, text: 'What are you offering? (one line)' });
      return true;
    }

    case 'report': {
      const { data: item } = await sb.from('swap_items').select('id, telegram_user_id').eq('id', parsed.arg).maybeSingle();
      if (item) await recordReport(sb, { itemId: item.id, reporterUserId: userId, reportedUserId: item.telegram_user_id, reason: null });
      await tg(token, 'sendMessage', { chat_id: chatId, text: 'Reported. Thank you — we review these.' });
      return true;
    }

    case 'keep': {
      await sb.from('swap_items')
        .update({ expires_at: new Date(Date.now() + EXPIRY_DAYS * 86400000).toISOString(), expiry_asked_at: null })
        .eq('id', parsed.arg);
      await tg(token, 'sendMessage', { chat_id: chatId, text: '👍 Kept live for another 3 weeks.' });
      return true;
    }

    case 'gone':
    case 'done': {
      await sb.from('swap_items').update({ status: parsed.action === 'done' ? 'swapped' : 'expired' }).eq('id', parsed.arg);
      await tg(token, 'sendMessage', { chat_id: chatId, text: parsed.action === 'done' ? '🎉 Nice one. Post closed.' : 'Closed.' });
      return true;
    }

    case 'notyet':
      await tg(token, 'sendMessage', { chat_id: chatId, text: 'No problem — it stays live.' });
      return true;

    case 'mine': {
      const { data: rows } = await sb.from('swap_items')
        .select('id, title, wants_text, status, view_count, interest_count')
        .eq('telegram_user_id', userId).neq('status', 'expired').limit(10);
      const text = rows?.length
        ? rows.map(r => `*${r.title}* → ${r.wants_text}\n👁 ${r.view_count} · 🙋 ${r.interest_count} · ${r.status}`).join('\n\n')
        : "You haven't posted anything to swap yet. Send me a photo to start.";
      await tg(token, 'sendMessage', {
        chat_id: chatId, text, parse_mode: 'Markdown',
        reply_markup: rows?.length
          ? { inline_keyboard: rows.map(r => [{ text: `🙈 Hide — ${r.title}`.slice(0, 64), callback_data: `sw:hide:${r.id}` }]) }
          : undefined,
      });
      return true;
    }

    case 'hide':
      await sb.from('swap_items').update({ status: 'hidden' }).eq('id', parsed.arg).eq('telegram_user_id', userId);
      await tg(token, 'sendMessage', { chat_id: chatId, text: 'Hidden.' });
      return true;

    default:
      return true;
  }
}

/** The offer line for a pending `sw:want`. Returns true when consumed. */
export async function handleSwapOfferText({ sb, tg, token, msg }) {
  const userId = msg.from?.id;
  const draft = userId ? await loadDraft(sb, userId) : null;
  if (!draft || draft.step !== 'await_offer') return false;

  const itemId = draft.payload.item_id;
  await clearDraft(sb, userId);

  const r = await recordInterest(sb, {
    itemId, fromUserId: userId, fromUsername: msg.from?.username, offerText: msg.text,
  });

  const chatId = msg.chat.id;
  if (r.error) {
    const text = {
      not_found: 'That swap is no longer available.',
      own_item: "That's your own post.",
      duplicate: "You've already been given their contact for this one.",
      no_username: "That person hasn't set a Telegram username, so they can't be reached.",
    }[r.error] || 'Something went wrong — try again.';
    await tg(token, 'sendMessage', { chat_id: chatId, text });
    return true;
  }

  const { toSeeker, toLister } = revealText({
    item: r.item, offerText: msg.text, fromUsername: msg.from?.username || 'someone', lang: r.item.lang,
  });

  await tg(token, 'sendMessage', {
    chat_id: chatId, text: toSeeker, parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: [[
      { text: `💬 Open chat with @${r.item.telegram_username}`, url: `https://t.me/${r.item.telegram_username}` },
      { text: '⚠️ Report', callback_data: `sw:report:${itemId}` },
    ]] },
  });

  // The lister hears about it at the same moment, so no DM arrives cold.
  await tg(token, 'sendMessage', {
    chat_id: r.item.telegram_user_id, text: toLister, parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: [[{ text: '⚠️ Report', callback_data: `sw:report:${itemId}` }]] },
  }).catch(() => {});

  await sb.from('swap_items').update({
    interest_count: (r.item.interest_count || 0) + 1,
    first_reveal_at: r.item.first_reveal_at || new Date().toISOString(),
  }).eq('id', itemId);

  return true;
}

/** Append the swap blocks under a finished set of business results. */
export async function appendSwapBlocks({ sb, tg, token, chatId, senderId, query, parsed }) {
  if (isCommercialQuery(query)) return;
  const lang = postLang(query);

  const { haves, wants } = await fetchSwapMatches(sb, {
    keywords: parsed?.keywords || [],
    category: parsed?.category || null,
    excludeUserId: senderId,
  });

  const sel = selectSwapCards({ haves, wants, searcherArea: null });
  const block = formatSwapBlocks({ haves: sel.haves, wants: sel.wants, query, lang });

  if (!block) {
    await tg(token, 'sendMessage', { chat_id: chatId, text: swapEmptyLine(query, lang) }).catch(() => {});
    return;
  }

  await tg(token, 'sendMessage', {
    chat_id: chatId, text: block.text, parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: block.keyboard },
  }).catch(() => {});
}
