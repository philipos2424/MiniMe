const b2bResearchService = require('../services/b2b_research');
const manifestService = require('../services/manifest');

/**
 * Handles /find and /research commands
 */
async function handleResearchCommand(ctx) {
  const { bot, msg, business, chatId, senderId } = ctx;
  const args = ctx.args || '';

  if (!args) {
    return await bot.sendMessage(chatId, '🔍 **Market Research**\n\nUsage: `/find [Service Name]`\nExample: `/find Copywriter`');
  }

  try {
    await bot.sendChatAction(chatId, 'typing');
    
    // TRUTH GUARD: Intercept any "Who can benefit/Who needs my bot" style queries 
    // and force them through the deterministic Synergy Engine.
    if (args.toLowerCase().match(/benefit|synergy|who needs|who can use|find businesses for me/)) {
      return await handleSynergyQuery({ bot, msg, business, chatId, senderId, args });
    }

    // 1. Direct Listing: If user asks for "others" or "all", we search for anything
    const searchTerm = (args.toLowerCase().includes('other') || args.toLowerCase().includes('all')) ? '' : args;
    const providers = await b2bResearchService.discoverProviders(searchTerm);

    if (!providers || providers.length === 0) {
      return await bot.sendMessage(chatId, `🔍 I searched the network but couldn't find any providers for "${args}". Try a broader term!`);
    }

    // 2. Format the results as "Qualified Leads"
    let response = `🔍 **Found ${providers.length} providers matching "${searchTerm || 'all'}":**\n\n`;
    
    providers.forEach((p, i) => {
      const biz = p.businesses;
      response += `${i + 1}. **${biz.name}**\n`;
      response += `💰 Price: ${p.min_price} ${p.currency}\n`;
      response += `🏷️ Tags: ${p.tags.join(', ') || 'None'}\n`;
      response += `⚙️ Level: ${biz.b2b_agency_level === 3 ? 'Partner' : biz.b2b_agency_level === 2 ? 'Agent' : 'Ghost'}\n`;
      response += `--------------------\n`;
    });

    response += `\n👉 To start a negotiation, use: \`/negotiate [Number] [Your Budget]\``;

    return await bot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
  } catch (e) {
    console.error('Research Handler Error:', e);
    return await bot.sendMessage(chatId, '❌ Error searching the B2B network.');
  }
}

/**
 * Deterministic Synergy Engine:
 * Finds real businesses that would benefit from the user's specific offerings.
 */
async function handleSynergyQuery(ctx) {
  const { bot, business, chatId, senderId } = ctx;

  try {
    await bot.sendChatAction(chatId, 'typing');
    
    // 1. Find actual synergistic businesses from DB
    const synergies = await b2bResearchService.findSynergies(business.id);
    
    if (!synergies || synergies.length === 0) {
      return await bot.sendMessage(chatId, '🔍 I analyzed the network, but I couldn't find any registered businesses that currently fit your ideal customer profile. Try updating your /manifest with more tags!');
    }

    // 2. Build the "Lead Card"
    let response = `🎯 **Synergy Analysis Complete**\n\nI found ${synergies.length} businesses that would actually benefit from your services:\n\n`;
    
    synergies.forEach((s, i) => {
      const biz = s.businesses;
      response += `${i + 1}. **${biz.name}** (Handle: @${biz.owner_telegram_id || 'Contact via Secretary'})\n`;
      response += `💡 Why: Their profile matches your core value proposition.\n`;
      response += `--------------------\n`;
    });

    response += `\n🚀 **Next Step:**\nTo send them all a personalized pitch, just say: \"Send them all DMs based on their benefit\"`;

    return await bot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
  } catch (e) {
    console.error('Synergy Error:', e);
    return await bot.sendMessage(chatId, '❌ Error calculating synergies: ' + e.message);
  }
}

async function handleNegotiateCommand(ctx) {
  const { chatId, businessId } = ctx;
  const args = ctx.args || '';

  try {
    const parts = args.split(' ');
    if (parts.length < 2) {
      return await bot.sendMessage(chatId, '❌ Usage: `/negotiate [ProviderNumber] [Budget]`');
    }

    const providerIndex = parseInt(parts[0]) - 1;
    const budget = parseFloat(parts[1]);

    const providers = await b2bResearchService.discoverProviders(ctx.last_search_term || 'all'); 
    
    if (!providers[providerIndex]) {
      return await bot.sendMessage(chatId, '❌ Invalid provider number.');
    }

    const target = providers[providerIndex];
    const targetBizId = target.businesses.id;
    const serviceId = target.id;

    const negotiation = await b2bResearchService.initiateHandshake(businessId, targetBizId, serviceId, budget);

    return await bot.sendMessage(chatId, `🤝 **Handshake Initiated!**\n\nI've sent a request to ${target.businesses.name} for ${budget} ${target.currency}.\n\nI'll notify you as soon as their bot responds.`);
  } catch (e) {
    console.error('Negotiate Handler Error:', e);
    return await bot.sendMessage(chatId, '❌ Error initiating negotiation.');
  }
}

module.exports = { handleResearchCommand, handleNegotiateCommand, handleSynergyQuery };
