const manifestService = require('../services/manifest');
const { buildHelpText } = require('./command'); // Assuming this is where help is built

/**
 * Handles /manifest and /b2b commands
 */
async function handleManifestCommand(ctx) {
  const { chatId, userId, businessId } = ctx;
  const args = ctx.args || '';

  try {
    // Basic usage: /manifest add "Web Design" 500 "Modern minimalist style"
    if (args.startsWith('add')) {
      const parts = args.split(' ');
      if (parts.length < 3) {
        return await ctx.bot.sendMessage(chatId, '❌ Usage: /manifest add "[Service]" [MinPrice] "[Description]"');
      }

      const serviceName = parts[1].replace(/['"]/g, '');
      const minPrice = parseFloat(parts[2]);
      const description = parts.slice(3).join(' ').replace(/['"]/g, '');

      if (isNaN(minPrice)) return await ctx.bot.sendMessage(chatId, '❌ Price must be a number.');

      await manifestService.upsertService(businessId, {
        service_name: serviceName,
        min_price: minPrice,
        description: description || 'No description provided',
      });

      return await ctx.bot.sendMessage(chatId, `✅ Added ${serviceName} to your B2B manifest at ${minPrice} ETB.`);
    }

    // Usage: /manifest list
    if (args === 'list') {
      const manifest = await manifestService.getManifest(businessId);
      if (!manifest || manifest.length === 0) {
        return await ctx.bot.sendMessage(chatId, '📂 Your manifest is currently empty. Use /manifest add to start selling!');
      }

      const list = manifest.map(s => `🔹 ${s.service_name}: ${s.min_price} ${s.currency} (${s.availability_status})`).join('\n');
      return await ctx.bot.sendMessage(chatId, `📂 **Your B2B Manifest:**\n\n${list}`);
    }

    return await ctx.bot.sendMessage(chatId, '🛠️ **Manifest Management:**\n\n/manifest add "[Service]" [Price] "[Desc]"\n/manifest list');
  } catch (e) {
    console.error('Manifest Handler Error:', e);
    return await ctx.bot.sendMessage(chatId, '❌ Error updating manifest. Please try again.');
  }
}

async function handleB2BCommand(ctx) {
  const { chatId, businessId } = ctx;
  const args = ctx.args || '';

  try {
    if (args.startsWith('level')) {
      const level = parseInt(args.split(' ')[1]);
      if (isNaN(level) || level < 1 || level > 3) {
        return await ctx.bot.sendMessage(chatId, '❌ Invalid level. Use 1 (Ghost), 2 (Agent), or 3 (Partner).');
      }

      await manifestService.setAgencyLevel(businessId, level);
      const levels = { 1: 'Ghost (Drafts only)', 2: 'Agent (Auto-negotiate)', 3: 'Partner (Full Auto)' };
      return await ctx.bot.sendMessage(chatId, `✅ B2B Agency Level set to **${level} - ${levels[level]}**.`);
    }

    return await ctx.bot.sendMessage(chatId, '🌐 **B2B Settings:**\n\n/b2b level [1-3] - Set your autonomy level\n/manifest - Manage your services');
  } catch (e) {
    console.error('B2B Handler Error:', e);
    return await ctx.bot.sendMessage(chatId, '❌ Error updating B2B settings.');
  }
}

module.exports = { handleManifestCommand, handleB2BCommand };
