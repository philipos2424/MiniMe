/**
 * Deliver one re-engagement DM and record it.
 *
 * Recording is not optional bookkeeping: without a reengagement_sends row we
 * cannot tell a working message from a lucky one, and the send schedule in
 * eligibility.mjs reads these rows to know how many times we have already
 * asked. A send we fail to record is a send we may repeat.
 */
import { supabase } from '../db';
import { renderMessage } from './copy.mjs';

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || process.env.WEB_URL || '').trim().replace(/\/$/, '');

/** Map a copy action to a Telegram inline-keyboard button. */
function toTelegramButton(btn) {
  if (btn.action.startsWith('exit:')) {
    return { text: btn.text, callback_data: `reengage_${btn.action}` };
  }
  if (btn.action === 'help_token') {
    return { text: btn.text, callback_data: 'reengage_help_token' };
  }
  const paths = {
    open_app: '', open_teach: '?step=teach', open_connect: '?step=connect', go_shared: '?step=connect&mode=shared',
  };
  const url = `${APP_URL}${paths[btn.action] ?? ''}`;
  return { text: btn.text, web_app: { url } };
}

export async function sendReengagement({ token, candidate, facts }) {
  const { telegramId, business, stage, variant, decision } = candidate;
  const message = renderMessage({ stage, variant, isFinal: decision.isFinal, facts });
  const chatId = business?.owner_private_chat_id || telegramId;

  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: message.text,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: message.buttons.map(row => row.map(toTelegramButton)) },
    }),
    signal: AbortSignal.timeout(8000),
  });

  const sb = supabase();

  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    console.warn(`[reengage/send] ${telegramId} failed: ${r.status} ${body?.description || ''}`);
    // 403 means they blocked the bot. Honour that permanently.
    if (r.status === 403 && business?.id) {
      const prefs = business.notification_prefs || {};
      await sb.from('businesses').update({
        notification_prefs: {
          ...prefs,
          owner_nudges: {
            ...(prefs.owner_nudges || {}),
            opted_out: true,
            opted_out_reason: 'telegram_403',
            opted_out_at: new Date().toISOString(),
          },
        },
      }).eq('id', business.id).then(() => {}, () => {});
    }
    return { ok: false, status: r.status, recorded: false };
  }

  const { error } = await sb.from('reengagement_sends').insert({
    telegram_id: telegramId,
    business_id: business?.id || null,
    stage,
    variant,
  });
  if (error) console.warn(`[reengage/send] attribution write failed for ${telegramId}:`, error.message);

  return { ok: true, status: r.status, recorded: !error };
}
