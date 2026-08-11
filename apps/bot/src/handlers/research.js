const b2bResearchService = require('../services/b2b_research');
const manifestService = require('../services/manifest');

/**
 * Handles /find and /research commands
 */
async function handleResearchCommand(ctx) {
  const { chatId, businessId } = ctx;
  const args = ctx.args || '';

  if (!args) {
    return await ctx.bot.sendMessage(chatId, '🔍 **Market Research**\\n\\nUsage: `/find [Service Name]`\\nExample: `/find Copywriter`');
  }

  try {
    await ctx.bot.sendChatAction(chatId, 'typing');
    
    // 1. Direct Listing: If user asks for "others" or "all", we search for anything
    const searchTerm = (args.toLowerCase().includes('other') || args.toLowerCase().includes('all')) ? '' : args;
    
    // SYNERGY CHECK: If user asks "who can benefit", "synergy", "who needs my bot", etc.
    if (args.toLowerCase().match(/benefit|synergy|who needs|who can use/)) {
      await ctx.bot.sendChatAction(chatId, 'typing');
      try {
        const synergies = await b2bResearchService.findSynergies(businessId);
        if (!synergies || synergies.length === 0) {
          return await ctx.bot.sendMessage(chatId, `🔍 I analyzed your business profile but couldn't find an ideal match in the current network. Try adding more tags to your manifest!`);
        }
        
        let synergyResponse = `🚀 **Synergy Analysis Complete**\\\\n\\\\nBased on your services, these businesses would benefit most from your a-bot:\\\\n\\\\n`;
        synergies.forEach((p, i) => {
          const biz = p.businesses;
          synergyResponse += `${i + 1}. **${biz.name}** (ICP Match)\\\\n`;
          synergyResponse += `⚙️ Level: ${biz.b2b_agency_level === 3 ? 'Partner' : biz.b2b_agency_level === 2 ? 'Agent' : 'Ghost'}\\\\n`;
          synergyResponse += `--------------------\\\\n`;
        });
        synergyResponse += `\\n👉 To pitch them, use: \`/negotiate [Number] [Your Budget]\``;
        return await ctx.bot.sendMessage(chatId, synergyResponse, { parse_mode: 'Markdown' });
      } catch (e) {
        console.error('Synergy Error:', e);
        return await ctx.bot.sendMessage(chatId, `❌ ${e.message}`);
      }
    }

    const providers = await b2bResearchService.discoverProviders(searchTerm);
    
    if (!providers || providers.length === 0) {
      return await ctx.bot.sendMessage(chatId, `🔍 I searched the network but couldn't find any providers for "${args}". Try a broader term!`);
    }

    // 2. Format the results as "Qualified Leads"
    let response = `🔍 **Found ${providers.length} providers matching "${searchTerm || 'all'}":**\\n\\n`;
    
    providers.forEach((p, i) => {
      const biz = p.businesses;
      response += `${i + 1}. **${biz.name}**\\n`;
      response += `💰 Price: ${p.min_price} ${p.currency}\\n`;
      response += `🏷️ Tags: ${p.tags.join(', ') || 'None'}\\n`;
      response += `⚙️ Level: ${biz.b2b_agency_level === 3 ? 'Partner' : biz.b2b_agency_level === 2 ? 'Agent' : 'Ghost'}\\n`;
      response += `--------------------\\n`;
    });

    response += `\\n👉 To start a negotiation, use: \`/negotiate [Number] [Your Budget]\``;

    return await ctx.bot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
  } catch (e) {
    console.error('Research Handler Error:', e);
    return await ctx.bot.sendMessage(chatId, '❌ Error searching the B2B network.');
  }
}

async function handleNegotiateCommand(ctx) {
  const { chatId, businessId } = ctx;
  const args = ctx.args || '';

  try {
    const parts = args.split(' ');
    if (parts.length < 2) {
      return await ctx.bot.sendMessage(chatId, '❌ Usage: `/negotiate [ProviderNumber] [Budget]`');
    }

    const providerIndex = parseInt(parts[0]) - 1;
    const budget = parseFloat(parts[1]);

    // 1. Re-discover to get the target
    const providers = await b2bResearchService.discoverProviders(ctx.last_search_term || 'all'); 
    // Note: In a real app, we'd store last_search_term in session/DB
    
    if (!providers[providerIndex]) {
      return await ctx.bot.sendMessage(chatId, '❌ Invalid provider number.');
    }

    const target = providers[providerIndex];
    const targetBizId = target.businesses.id;
    const serviceId = target.id;

    // 2. Initiate the B2B Handshake
    const negotiation = await b2bResearchService.initiateHandshake(businessId, targetBizId, serviceId, budget);

    return await ctx.bot.sendMessage(chatId, `🤝 **Handshake Initiated!**\\n\\nI've sent a request to ${target.businesses.name} for ${budget} ${target.currency}.\\n\\nI'll notify you as soon as their bot responds.`);
  } catch (e) {
    console.error('Negotiate Handler Error:', e);
    return await ctx.bot.sendMessage(chatId, '❌ Error initiating negotiation.');
  }
}

module.exports = { handleResearchCommand, handleNegotiateCommand };
