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
    // We only look for businesses that are explicitly marked as part of the B2B agency network
    const { data: connectedBiz, error: bError } = await supabase
      .from('businesses')
      .select('id, name, owner_telegram_id, b2b_agency_level')
      .neq('id', 'self')
      .gt('b2b_agency_level', 0); // CRITICAL: Only include those with agency level > 0

    if (bError) console.error('B2B General Discovery Error:', bError);

    // 3. Merge Results
    const results = manifests || [];
    
    if (connectedBiz) {
      connectedBiz.forEach(biz => {
        const alreadyExists = results.some(r => r.businesses && r.businesses.id === biz.id);
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
   * Synergy Analysis: Finds businesses that would BENEFIT from the user's services.
   * Instead of searching for a service, it searches for ICPs (Ideal Customer Profiles).
   */
  async findSynergies(userBusinessId) {
    // 1. Get the user's own manifest to see what they offer
    const { data: userManifest, error: mError } = await supabase
      .from('business_manifests')
      .select('service_name, tags')
      .eq('businesses.id', userBusinessId)
      .single();

    if (mError || !userManifest) {
      throw new Error('Your business must have a B2B manifest to calculate synergies.');
    }

    // 2. Simple Synergy Map (Value Proposition -> Target ICP)
    const synergyMap = {
      'ai': ['Agency', 'Consultant', 'SaaS', 'E-commerce', 'Founder'],
      'crm': ['Real Estate', 'Sales', 'Lawyer', 'Medical', 'Agency'],
      'automation': ['Operations', 'Manager', 'Entrepreneur', 'Scale'],
      'secretary': ['CEO', 'Solo', 'Professional', 'Executive'],
      'bot': ['Marketplace', 'Store', 'Service Provider']
    };

    const userCore = (userManifest.service_name + ' ' + (userManifest.tags || []).join(' ')).toLowerCase();
    let targetKeywords = [];

    for (const [key, targets] of Object.entries(synergyMap)) {
      if (userCore.includes(key)) {
        targetKeywords.push(...targets);
      }
    }

    if (targetKeywords.length === 0) {
      targetKeywords = ['Agency', 'Consultant', 'Entrepreneur'];
    }

    // 3. Search the network for these target ICPs
    const results = [];
    for (const keyword of targetKeywords) {
      const providers = await this.discoverProviders(keyword);
      results.push(...providers);
    }

    // Deduplicate by business ID
    return Array.from(new Map(results.map(item => [item.businesses.id, item])).values());
  },

  /**
   * The "Handshake": Initiate a B2B negotiation.
   */
  async initiateHandshake(initiatorId, targetBusinessId, serviceId, initialOffer) {
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
    return data;
  }
};

module.exports = b2bResearchService;
