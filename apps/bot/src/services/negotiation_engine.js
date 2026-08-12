const negotiationHistoryService = require('./negotiation_history');
const { supabase } = require('../../../packages/db/client');

/**
 * B2B Negotiation Engine
 * Handles the deterministic logic for accepting, rejecting, or countering B2B offers.
 */
const negotiationEngine = {
  /**
   * Evaluates an incoming offer against the business manifest.
   * Deterministic: No LLM here, only hard rules.
   */
  async evaluateIncomingOffer(businessId, offer) {
    const { serviceId, proposedPrice } = offer;

    // 1. Fetch the specific service manifest
    const { data: manifest, error } = await supabase
      .from('business_manifests')
      .select('*')
      .eq('id', serviceId)
      .single();

    if (error || !manifest) throw new Error('Service manifest not found');

    // 2. Hard Rule: Budget too low
    if (proposedPrice < manifest.min_price) {
      return {
        action: 'REJECT',
        reason: `Offer ${proposedPrice} is below minimum price ${manifest.min_price}`,
        counterOffer: manifest.min_price,
        confidence: 1.0
      };
    }

    // 3. Hard Rule: Perfect match or higher
    if (proposedPrice >= manifest.min_price && proposedPrice <= manifest.max_price) {
      return {
        action: 'ACCEPT',
        reason: 'Offer is within acceptable range',
        confidence: 1.0
      };
    }

    // 4. Offer is above max price (Rare, but we accept it!)
    return {
      action: 'ACCEPT',
      reason: 'Premium offer accepted',
      confidence: 1.0
    };
  },

  /**
   * Handles a counter-offer from a target bot.
   */
  async evaluateCounterOffer(businessId, counterOffer) {
    const { proposedPrice, maxBudget } = counterOffer;

    // If the counter is still within our budget, we accept.
    if (proposedPrice <= maxBudget) {
      return { action: 'ACCEPT', confidence: 1.0 };
    }

    return { action: 'REJECT', reason: 'Counter-offer exceeds budget', confidence: 1.0 };
  },

  /**
   * Updates the negotiation state in the DB.
   */
  async updateNegotiationState(negotiationId, newState, finalPrice = null, offerContent = null, senderId = null) {
    // 1. Log to history first to ensure transparency
    if (offerContent) {
      await negotiationHistoryService.logOffer(negotiationId, senderId, offerContent, { price: finalPrice });
    }

    const { error } = await supabase
      .from('b2b_negotiations')
      .update({
        current_status: newState,
        final_price: finalPrice,
        updated_at: new Date().toISOString(),
      })
      .eq('id', negotiationId);

    if (error) throw new Error(`State Update Error: ${error.message}`);
    return true;
  }
};

module.exports = negotiationEngine;
