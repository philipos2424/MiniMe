/**
 * channelIngest.js — turn Telegram channel activity into catalog products.
 *
 * Two entry points, one pipeline:
 *   - handleChannelMembership(): a `my_chat_member` update where the bot is added
 *     to / removed from a channel as admin. Links (or unlinks) the channel to a
 *     business so we know whose catalog its posts belong to.
 *   - handleChannelPost(): a `channel_post` / `edited_channel_post` update. Reads
 *     the post, extracts product(s) with Claude, saves the exact structured record
 *     (with the post's photo hosted so buyers get the real image), and DMs the
 *     owner a confirmation.
 *
 * Business resolution:
 *   - Own-bot webhook passes the already-resolved `business` (from webhook secret).
 *   - Platform bot passes `business: null`; we resolve via source_channel_id
 *     (posts) or the owner who added the bot (membership).
 *
 * The SAME ingest core is reused by the manual "forward a post to the bot" path
 * so both behave identically.
 */
import { supabase } from './db';
import { tg, tgDownloadFile } from './telegramApi';
import { findByOwnerTelegramId, findBySourceChannelId, update as updateBusiness } from './businesses';
import { extractProductsFromText, extractProductFromMessage, upsertProductFromForward } from './teaching';

// A post is worth a Claude call only if it looks like it names a price/product.
// Cheap regex guard so channel announcements / greetings don't spawn junk rows.
const PRODUCT_SIGNAL = /(\d[\d,]*\.?\d*)\s*(etb|birr|ብር|usd|\$|br)\b|\b(price|ዋጋ|new item|now selling|for sale|in stock|available|order)\b/i;

function ownerChatId(business) {
  return business?.owner_private_chat_id || business?.owner_telegram_id || null;
}

async function dmOwner(business, token, text) {
  const chatId = ownerChatId(business);
  if (!chatId) return;
  await tg(token, 'sendMessage', { chat_id: chatId, text, parse_mode: 'Markdown' }).catch(() => {});
}

/**
 * Download the largest photo on a post and host it in Supabase Storage so the
 * saved product has a durable public image_url (Telegram file URLs embed the
 * bot token and are not durable). Returns a public URL or null.
 */
async function hostPhoto(token, businessId, photo) {
  try {
    const largest = photo[photo.length - 1];
    const buf = await tgDownloadFile(token, largest.file_id);
    if (!buf) return null;
    const sb = supabase();
    const storagePath = `products/${businessId}/chan-${Date.now()}.jpg`;
    const { error } = await sb.storage.from('documents').upload(storagePath, buf, {
      contentType: 'image/jpeg', upsert: true,
    });
    if (error) return null;
    const { data } = sb.storage.from('documents').getPublicUrl(storagePath);
    return data?.publicUrl || null;
  } catch {
    return null;
  }
}

/**
 * Core ingest shared by channel posts and forwarded posts.
 * `msg` is a Telegram message-like object with optional .photo, .caption, .text.
 * Returns { products: [{name, price, created}], skipped: bool }.
 */
export async function ingestPostToProducts({ msg, business, token, visionText = '' }) {
  const caption = (msg.caption || msg.text || '').trim();

  // Read the photo with Vision so a photo-only post (price in the image) works.
  // Callers that already ran Vision (e.g. the forward path) pass visionText to
  // avoid a second Vision call.
  if (!visionText && msg.photo?.length) {
    try {
      const { teachFromPhoto } = await import('./teachFromMedia');
      const r = await teachFromPhoto(token, business.id, msg);
      if (r?.ok && r.extracted_text) visionText = r.extracted_text;
    } catch { /* non-fatal — fall back to caption only */ }
  }

  const combined = [caption, visionText].filter(Boolean).join('\n').trim();
  if (!combined || !PRODUCT_SIGNAL.test(combined)) {
    return { products: [], skipped: true };
  }

  // Host the post photo once; attach it to every product from this post.
  const imageUrl = msg.photo?.length ? await hostPhoto(token, business.id, msg.photo) : null;

  // Prefer the plural extractor (multi-item posts); fall back to single.
  let items = [];
  try { items = await extractProductsFromText(combined); } catch { items = []; }
  if (!items.length) {
    try {
      const single = await extractProductFromMessage(combined);
      if (single) items = [single];
    } catch { /* ignore */ }
  }

  const results = [];
  for (const item of items) {
    try {
      const r = await upsertProductFromForward(business.id, item, imageUrl);
      if (r) results.push({ name: r.product?.name || item.name, price: r.product?.price ?? item.price, created: !!r.created });
    } catch { /* skip this item, keep going */ }
  }
  return { products: results, skipped: false };
}

/** Compact owner confirmation line(s) for an ingest result. */
function confirmationText(products, channelTitle) {
  if (!products.length) return null;
  const src = channelTitle ? ` from *${channelTitle}*` : '';
  if (products.length === 1) {
    const p = products[0];
    const price = p.price != null ? ` — ${p.price} ETB` : '';
    return `📥 ${p.created ? 'Added' : 'Updated'}${src}: *${p.name}*${price} ✅`;
  }
  const created = products.filter(p => p.created).length;
  const updated = products.length - created;
  const parts = [];
  if (created) parts.push(`${created} new`);
  if (updated) parts.push(`${updated} updated`);
  const names = products.slice(0, 5).map(p => `• ${p.name}`).join('\n');
  return `📥 Catalog updated${src} — ${parts.join(', ')}:\n${names}`;
}

/**
 * Claim leadership for an album (media group) so only one invocation confirms.
 * Returns true if THIS invocation is the leader (should reply), false for
 * siblings (ingest silently). Non-album posts always return true.
 */
async function claimAlbumLeader(mediaGroupId, businessId) {
  if (!mediaGroupId) return true;
  const { error } = await supabase()
    .from('channel_import_groups')
    .insert({ media_group_id: String(mediaGroupId), business_id: businessId });
  // Unique-violation → someone already claimed it → we're a sibling.
  return !error;
}

/**
 * Handle `channel_post` / `edited_channel_post`.
 * @returns true if the update was a channel post we handled (so the caller stops).
 */
export async function handleChannelPost({ update, business, token }) {
  const post = update.channel_post || update.edited_channel_post;
  if (!post || post.chat?.type !== 'channel') return false;
  const chatId = String(post.chat.id);

  // Resolve the business this channel belongs to.
  let biz = business;
  if (biz) {
    if (!biz.source_channel_id) {
      // Own-bot tenant posting from a channel we haven't recorded yet — adopt it.
      await updateBusiness(biz.id, {
        source_channel_id: chatId,
        source_channel_username: post.chat.username || null,
        source_channel_title: post.chat.title || null,
      });
      biz = { ...biz, source_channel_id: chatId };
    } else if (String(biz.source_channel_id) !== chatId) {
      return true; // bot admins some other channel for this tenant — ignore it
    }
  } else {
    biz = await findBySourceChannelId(chatId);
  }
  if (!biz) return true; // unlinked channel — nothing to do, but it was a channel post

  const { products, skipped } = await ingestPostToProducts({ msg: post, business: biz, token });
  if (skipped || !products.length) return true;

  const isLeader = await claimAlbumLeader(post.media_group_id, biz.id);
  if (isLeader) {
    const text = confirmationText(products, post.chat.title);
    if (text) await dmOwner(biz, token, text);
  }
  return true;
}

/**
 * Handle `my_chat_member` — link/unlink the channel when the bot is added or
 * removed as an admin.
 * @returns true if this was a channel membership update we handled.
 */
export async function handleChannelMembership({ update, business, token }) {
  const m = update.my_chat_member;
  if (!m || m.chat?.type !== 'channel') return false;
  const status = m.new_chat_member?.status;
  const chatId = String(m.chat.id);

  // Resolve business: own-bot passes it in; platform bot uses the admin who added us.
  let biz = business;
  if (!biz && m.from?.id) biz = await findByOwnerTelegramId(String(m.from.id));
  if (!biz) return true;

  if (status === 'administrator' || status === 'member') {
    await updateBusiness(biz.id, {
      source_channel_id: chatId,
      source_channel_username: m.chat.username || null,
      source_channel_title: m.chat.title || null,
    });
    await dmOwner(
      biz, token,
      `✅ *Watching ${m.chat.title || 'your channel'}* — new product posts will be added to your catalog automatically. Post a product to try it.`,
    );
  } else if (status === 'left' || status === 'kicked') {
    if (String(biz.source_channel_id) === chatId) {
      await updateBusiness(biz.id, { source_channel_id: null, source_channel_username: null, source_channel_title: null });
      await dmOwner(biz, token, `⚠️ I've stopped watching *${m.chat.title || 'your channel'}* (removed as admin). Re-add me as an admin to resume auto-importing products.`);
    }
  }
  return true;
}
