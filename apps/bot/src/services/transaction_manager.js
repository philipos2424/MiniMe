const { supabase } = require('../../../packages/db/client');
const negotiationEngine = require('./negotiation_engine');
const b2bResearchService = require('./b2b_research');
const secretaryCloser = require('./secretary_closer');

/**
 * B2B Transaction Manager
 * Coordinates the flow between discovery, negotiation, and handoff.
 */
const transactionManager = {
  /**
   * The "Tick" function: Processes an inbound negotiation request.
   */
  async processInboundRequest(negotiationId) {
    const { data: neg, error } = await supabase
      .from('b2b_negotiations')
      .select('*, business_manifests!service_id(*)')
      .eq('id', negotiationId)
      .single();

    if (error || !neg) throw new Error('Negotiation record not found');

    const offer = {
      serviceId: neg.service_id,
      proposedPrice: neg.current_offer
    };

    // 1. Deterministic Evaluation
    const evaluation = await negotiationEngine.evaluateIncomingOffer(neg.target_business_id, offer);

    // 2. Apply Result
    if (evaluation.action === 'ACCEPT') {
      await negotiationEngine.updateNegotiationState(negotiationId, 'accepted', neg.current_offer);
      return { status: 'accepted', price: neg.current_offer };
    } else {
      await negotiationEngine.updateNegotiationState(negotiationId, 'countered', evaluation.counterOffer);
      return { status: 'countered', price: evaluation.counterOffer };
    }
  },

  /**
   * Finalizes the deal and triggers the Secretary.
   */
  async finalizeDeal(negotiationId) {
    const { data: neg } = await supabase
      .from('b2b_negotiations')
      .select('*, businesses!target_business_id(owner_telegram_id, name), business_manifests!service_id(service_name)')
      .eq('id', negotiationId)
      .single();

    if (!neg) throw new Error('Negotiation not found');

    // 1. Get the user's persona from the business record
    const { data: biz } = await supabase
      .from('businesses')
      .select('persona')
      .eq('id', neg.initiator_business_id)
      .single();

    // 2. Draft the closing message via the Secretary
    const message = await secretaryCloser.draftClosingMessage({
      targetName: neg.businesses.name,
      finalPrice: neg.final_price,
      serviceName: neg.business_manifests.service_name,
      persona: biz?.persona || 'Default'
    });

    // 3. Send via Secretary personal account
    const sendResult = await secretaryCloser.sendClosingDM(neg.businesses.owner_telegram_id, message);

    // 4. Mark as completed in DB
    await negotiationEngine.updateNegotiationState(negotiationId, 'completed');
    
    return {
      success: sendResult.success,
      dmSent: sendResult.success,
      finalPrice: neg.final_price
    };
  }
};

module.exports = transactionManager;
