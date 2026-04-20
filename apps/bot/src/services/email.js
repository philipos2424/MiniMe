/**
 * Email service for international supplier outreach.
 * Uses Resend if RESEND_API_KEY is set; otherwise returns null so callers
 * can fall back to a mailto: link the owner taps from Telegram.
 */
const axios = require('axios');

async function sendEmail({ to, subject, text, html, replyTo, fromName }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) {
    console.warn('email.sendEmail: RESEND_API_KEY / RESEND_FROM_EMAIL missing — skipping send');
    return { sent: false, reason: 'no_provider' };
  }
  try {
    const res = await axios.post(
      'https://api.resend.com/emails',
      {
        from: fromName ? `${fromName} <${from}>` : from,
        to: Array.isArray(to) ? to : [to],
        subject,
        text,
        html: html || undefined,
        reply_to: replyTo || undefined,
      },
      { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 15000 }
    );
    return { sent: true, id: res.data?.id || null };
  } catch (e) {
    console.error('email.sendEmail error:', e.response?.data || e.message);
    return { sent: false, reason: 'provider_error', error: e.message };
  }
}

/** Build a tappable mailto: URL for owners to send manually. */
function buildMailtoLink({ to, subject, body }) {
  const enc = encodeURIComponent;
  return `mailto:${to}?subject=${enc(subject || '')}&body=${enc(body || '')}`;
}

module.exports = { sendEmail, buildMailtoLink };
