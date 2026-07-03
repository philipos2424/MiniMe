/**
 * channelBackfill.js — import a channel's EXISTING posts (the back-catalog).
 *
 * Telegram's Bot API can't read channel history, so auto-monitoring only ever
 * catches NEW posts. But a public channel exposes its recent posts on the web
 * preview at https://t.me/s/<username>. We fetch and parse that (text + photo
 * URL per post) and run each through the same `ingestPostToProducts` pipeline
 * the live/forward paths use — so an owner whose catalog already lives in a
 * channel can pull it in with one tap instead of re-posting or forwarding.
 *
 * Limits (by design, kept honest for the UI):
 *   - Public channels only. Private channels have no web preview → owner is
 *     told to forward posts instead.
 *   - The preview returns the ~20 most recent posts, not full history.
 *   - We extract from post TEXT (the caption most product posts already have),
 *     not Vision — a photo-only post with the price only in the image won't
 *     parse. The photo is still hosted and attached when text names the product.
 */
import { ingestPostToProducts } from './channelIngest';

function decodeEntities(s) {
  return String(s || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

/**
 * Fetch + parse the public preview into [{ postId, text, photoUrl }].
 * Returns { ok, posts, reason } — reason 'private_or_empty' when the preview
 * has no readable posts (private channel, wrong handle, or truly empty).
 */
export async function fetchChannelPreview(username) {
  const handle = String(username || '').trim().replace(/^@/, '').replace(/^https?:\/\/t\.me\/(s\/)?/i, '');
  if (!/^[A-Za-z0-9_]{4,32}$/.test(handle)) return { ok: false, reason: 'bad_handle', posts: [] };

  let html;
  try {
    const r = await fetch(`https://t.me/s/${handle}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MiniMeBot/1.0)' },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return { ok: false, reason: 'fetch_failed', posts: [] };
    html = await r.text();
  } catch {
    return { ok: false, reason: 'fetch_failed', posts: [] };
  }

  // Split into per-message chunks on the message wrapper class.
  const chunks = html.split('tgme_widget_message_wrap').slice(1);
  const posts = [];
  for (const chunk of chunks) {
    const idM = chunk.match(/data-post="([^"]+)"/);
    const postId = idM ? idM[1] : null;
    const textM = chunk.match(/tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/);
    const text = textM ? decodeEntities(textM[1]) : '';
    // background-image:url('...') — the URL is HTML-entity encoded in the markup.
    const photoM = chunk.match(/tgme_widget_message_photo_wrap[\s\S]{0,400}?background-image:url\((?:&#39;|['"])(https:[^'")]+?)(?:&#39;|['"])\)/);
    const photoUrl = photoM ? decodeEntities(photoM[1]) : null;
    if (text || photoUrl) posts.push({ postId, text, photoUrl });
  }

  if (!posts.length) return { ok: false, reason: 'private_or_empty', posts: [] };
  return { ok: true, posts };
}

/**
 * Import a channel's back-catalog. Reuses ingestPostToProducts per post; product
 * name de-dupe (upsertProductFromForward) makes re-running safe/idempotent.
 * Returns a summary the UI shows the owner.
 */
export async function importChannelBackCatalog({ business, username, limit = 20 }) {
  const preview = await fetchChannelPreview(username);
  if (!preview.ok) return { ok: false, reason: preview.reason, scanned: 0, added: 0, updated: 0 };

  const posts = preview.posts.slice(0, limit);
  let added = 0, updated = 0, scannedProduct = 0;
  const names = [];
  for (const p of posts) {
    // No bot token here (scrape path); ingest hosts the photo from photoUrl and
    // extracts from text. token is unused when msg.photo is absent.
    const { products, skipped } = await ingestPostToProducts({
      msg: { text: p.text, photoUrl: p.photoUrl },
      business,
      token: null,
    });
    if (skipped) continue;
    scannedProduct++;
    for (const pr of products) {
      if (pr.created) { added++; names.push(pr.name); }
      else updated++;
    }
  }
  return { ok: true, scanned: posts.length, productPosts: scannedProduct, added, updated, names: names.slice(0, 8) };
}
