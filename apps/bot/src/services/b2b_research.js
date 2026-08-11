const { supabase } = require('../../../packages/db/client');
const manifestService = require('./manifest');

/**
 * B2B Research & Discovery Service
 * Handles the logic for bots finding and querying other bots in the network.
 */
const b2bResearchService = {
  /**
   * Search the network for businesses providing a specific service.
   * This is the "Market Research" phase.
   */
  async discoverProviders(serviceName, constraints = {}) {
    const { minBudget, maxBudget, tags = [] } = constraints;

    // 1. Search manifests for matching service names or tags
    let query = supabase
      .from('business_manifests')
      .select('*, businesses(name, b2b_agency_level, owner_telegram_id)')
      .ilike('service_name', `%${serviceName}%`);

    if (tags.length > 0) {
      query = query.overlaps('tags', tags);
    }

    if (minBudget) {
      query = query.lte('max_price', minBudget); // Find those whose max price is within our budget
    }

    const { data, error } = await query;
    if (error) throw new Error(`Discovery Error: ${error.message}`);

    return data || [];
  },

  /**
   * The "Handshake": Initiate a B2B negotiation.
   * This moves from "Discovery" to "Transaction".
   */
  async initiateHandshake(initiatorId, targetBusinessId, serviceId, initialOffer) {
    // 1. Create the negotiation record
    const { data, error } = await supabase
      .from('b2b_negotiations')
      .insert({
        initiator_business_id: initiatorId,
        target_business_id: targetBusinessId,
        service_id: serviceId,
        current_offer: initialOffer,
        current_status: 'negotiating',
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw new Error(`Handshake Error: ${error.message}`);

    // 2. Notify the target business owner via their bot
    // This is where the "Inbound" side of the engine starts.
    return data;
  },

  /**
   * Analyze if a target bot is a "Good Match" based on manifests.
   */
  async evaluateMatch(targetManifest, requestConstraints) {
    const { budget, styleTags = [] } = requestConstraints;
    
    let matchScore = 0;
    if (targetManifest.min_price <= budget) matchScore += 50;
    
    const commonTags = targetManifest.tags.filter(tag => styleTags.includes(tag));
    matchScore += (commonTags.length * 10);

    return {
      isViable: targetManifest.min_price <= budget,
      score: matchScore,
      recommendation: matchScore > 60 ? 'Strong Match' : 'Possible Match'
    };
  }
};

module.exports = b2bResearchService;
