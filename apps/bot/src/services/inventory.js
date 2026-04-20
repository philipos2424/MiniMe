const { findByBusiness, updateStock, getLowStock } = require('../../../../packages/db/queries/products');

async function checkAndAlertLowStock(bot, business) {
  try {
    const low = await getLowStock(business.id);
    if (!low.length) return;

    const ownerChatId = business.owner_private_chat_id;
    if (!ownerChatId) return;

    const list = low.map(p => `• ${p.name}: ${p.stock_quantity} left (threshold: ${p.low_stock_threshold})`).join('\n');
    await bot.sendMessage(ownerChatId, `⚠️ *Low Stock Alert*\n\n${list}`, { parse_mode: 'Markdown' });
  } catch (e) {
    console.error('checkAndAlertLowStock error:', e.message);
  }
}

async function deductStock(businessId, productName, quantity) {
  try {
    const products = await findByBusiness(businessId);
    const product = products.find(p => p.name.toLowerCase().includes(productName.toLowerCase()));
    if (!product) return false;
    await updateStock(product.id, -quantity);
    return true;
  } catch (e) {
    console.error('deductStock error:', e.message);
    return false;
  }
}

module.exports = { checkAndAlertLowStock, deductStock };
