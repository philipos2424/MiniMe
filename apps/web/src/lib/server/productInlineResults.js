/**
 * Shared "answer an inline query with this business's products" logic, used
 * by both the shared agent-bot (owner searching their own catalog from any
 * chat) and tenant custom bots (once an owner enables /setinline on their
 * own bot via BotFather — the Bot API can't turn that on for them).
 *
 * Mirrors the article-card shape of searchBot.js's handleSearchBotInline,
 * which searches ACROSS businesses; this searches products WITHIN one.
 */
export async function fetchInlineProducts(sb, businessId, query) {
  let q = sb.from('products')
    .select('id, name, name_am, price, currency, stock_quantity, image_url, is_active')
    .eq('business_id', businessId)
    .eq('is_active', true)
    .order('stock_quantity', { ascending: false })
    .limit(10);
  if (query) q = q.or(`name.ilike.%${query}%,name_am.ilike.%${query}%`);
  const { data } = await q;
  return data || [];
}

export function buildProductInlineArticles(products) {
  return products.map((p) => {
    const price = p.price != null ? `${Number(p.price).toLocaleString()} ${p.currency || 'ETB'}` : '';
    const stock = p.stock_quantity != null
      ? p.stock_quantity <= 0 ? ' · ❌ Out of stock' : p.stock_quantity <= 5 ? ` · ⚠️ ${p.stock_quantity} left` : ' · ✅ In stock'
      : '';
    const article = {
      type: 'article',
      id: p.id,
      title: `${p.name}${p.name_am ? ` / ${p.name_am}` : ''}`,
      description: `${price}${stock}`,
      input_message_content: {
        message_text: `🛍️ *${p.name}*\n💰 ${price || 'Price on request'}${stock}`,
        parse_mode: 'Markdown',
      },
    };
    if (p.image_url) article.thumbnail_url = p.image_url;
    return article;
  });
}

export function emptyInlineArticle(id, title, description) {
  return {
    type: 'article',
    id,
    title,
    description,
    input_message_content: { message_text: description },
  };
}
