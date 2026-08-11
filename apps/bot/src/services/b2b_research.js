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

    // 1. Search Manifests (Primary - Deterministic)
    let manifestQuery = supabase.from('business_manifests').select('*, businesses(name, b2b_agency_level, owner_telegram_id)');

    if (serviceName) {
      manifestQuery = manifestQuery.ilike('service_name', `%${serviceName}%`);
    }
    if (tags.length > 0) {
      manifestQuery = manifestQuery.overlaps('tags', tags);
    }
    if (minBudget) {
      manifestQuery = manifestQuery.lte('max_price', minBudget);
    }

    const { data: manifests, error: mError } = await manifestQuery;
    if (mError) console.error('B2B Manifest Discovery Error:', mError);

    // 2. Fallback/Bridge: Search General Businesses (Secondary - Connected)
    // We look for businesses that are connected/shared but don't have a manifest for this service yet
    const { data: connectedBiz, error: bError } = await supabase
      .from('businesses')
      .select('id, name, owner_telegram_id, b2b_agency_level')
      .neq('id', 'self'); // Exclude current user

    if (bError) console.error('B2B General Discovery Error:', bError);

    // 3. Merge Results
    // Manifests are "Tier 1" (Qualified), ConnectedBiz are "Tier 2" (Leads)
    const results = manifests || [];
    
    if (connectedBiz) {
      connectedBiz.forEach(biz => {
        // Only add if they aren't already in the manifest list
        const alreadyExists = results.some(r => r.businesses.id === biz.id);
        if (!alreadyExists) {
          results.push({
            id: null, // No manifest ID
            service_name: 'Connected Partner (No Manifest)',
            min_price: 0,
            max_price: 0,
            currency: 'TBD',
            tags: [],
            businesses: biz
          });
        }
      });
    }

    return results;
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
