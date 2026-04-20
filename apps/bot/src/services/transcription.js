const OpenAI = require('openai');
const axios = require('axios');

function getOpenAI() { return new OpenAI({ apiKey: process.env.OPENAI_API_KEY }); }

/**
 * Download a Telegram voice / audio / video-note file and transcribe via Whisper.
 * Returns { text, duration } or null on failure.
 */
async function transcribeTelegramAudio(bot, msg) {
  try {
    const media = msg.voice || msg.audio || msg.video_note;
    if (!media) return null;

    const fileId = media.file_id;
    const duration = media.duration || null;

    const fileLink = await bot.getFileLink(fileId);
    const resp = await axios.get(fileLink, { responseType: 'arraybuffer', timeout: 30000 });
    const buffer = Buffer.from(resp.data);

    const ext = msg.voice ? 'ogg' : (msg.audio?.mime_type || '').includes('mpeg') ? 'mp3' : 'mp4';
    const file = await OpenAI.toFile(buffer, `voice.${ext}`);

    const tr = await getOpenAI().audio.transcriptions.create({
      model: 'whisper-1',
      file,
    });

    return { text: (tr.text || '').trim(), duration };
  } catch (err) {
    console.error('transcribeTelegramAudio error:', err.message);
    return null;
  }
}

/**
 * Describe a Telegram photo using gpt-4o vision.
 * Returns a short caption/description or null.
 */
async function describeTelegramPhoto(bot, msg) {
  try {
    const photos = msg.photo;
    if (!photos || !photos.length) return null;
    // Pick highest-resolution photo
    const best = photos[photos.length - 1];
    const fileLink = await bot.getFileLink(best.file_id);

    const resp = await getOpenAI().chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Describe this image in 2-3 sentences. If it shows a product, receipt, screenshot, or document, say what it shows clearly. If there is text in Amharic or English, quote the important parts.' },
          { type: 'image_url', image_url: { url: fileLink } },
        ],
      }],
    });
    return (resp.choices[0]?.message?.content || '').trim() || null;
  } catch (err) {
    console.error('describeTelegramPhoto error:', err.message);
    return null;
  }
}

module.exports = { transcribeTelegramAudio, describeTelegramPhoto };
