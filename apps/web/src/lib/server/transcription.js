/**
 * Voice + photo transcription for the webhook reply engine.
 *
 * The polling bot used `bot.getFileLink(fileId)` — we don't have a bot
 * instance here, so we hit the Telegram Bot API directly:
 *   1. POST /getFile  → { file_path }
 *   2. GET  https://api.telegram.org/file/bot<token>/<file_path>
 */
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function getFileUrl(token, fileId) {
  const r = await fetch(`https://api.telegram.org/bot${token}/getFile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_id: fileId }),
  });
  const j = await r.json();
  if (!j?.ok || !j.result?.file_path) throw new Error(`getFile failed: ${j?.description}`);
  return `https://api.telegram.org/file/bot${token}/${j.result.file_path}`;
}

export async function transcribeTelegramAudio(token, msg) {
  try {
    const media = msg.voice || msg.audio || msg.video_note;
    if (!media) return null;

    const fileUrl = await getFileUrl(token, media.file_id);
    const resp = await fetch(fileUrl, { signal: AbortSignal.timeout(30000) });
    if (!resp.ok) throw new Error(`file download ${resp.status}`);
    const buf = Buffer.from(await resp.arrayBuffer());

    const ext = msg.voice ? 'ogg' : (msg.audio?.mime_type || '').includes('mpeg') ? 'mp3' : 'mp4';
    const file = await OpenAI.toFile(buf, `voice.${ext}`);

    const tr = await openai.audio.transcriptions.create({ model: 'whisper-1', file });
    return { text: (tr.text || '').trim(), duration: media.duration || null };
  } catch (err) {
    console.error('transcribeTelegramAudio:', err.message);
    return null;
  }
}

export async function describeTelegramPhoto(token, msg) {
  try {
    const photos = msg.photo;
    if (!photos?.length) return null;
    const best = photos[photos.length - 1];
    const fileUrl = await getFileUrl(token, best.file_id);

    const resp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Describe this image in 2-3 sentences. If it shows a product, receipt, screenshot, or document, say what it shows clearly. If there is text in Amharic or English, quote the important parts.' },
          { type: 'image_url', image_url: { url: fileUrl } },
        ],
      }],
    });
    return (resp.choices[0]?.message?.content || '').trim() || null;
  } catch (err) {
    console.error('describeTelegramPhoto:', err.message);
    return null;
  }
}
