const { supabase } = require('../../../packages/db/client');

/**
 * B2B Negotiation History Service
 * Ensures both parties can see the chat history of their offers.
 */
const negotiationHistoryService = {
  /**
   * Records an offer or counter-offer in the ledger.
   */
  async logOffer(negotiationId, senderId, content, offerDetails = {}) {
    const { error } = await supabase
      .from('b2b_negotiations_history')
      .insert({
        negotiation_id: negotiationId,
        sender_business_id: senderId,
        message_content: content,
        offer_data: offerDetails, // JSON: { price, currency, etc }
        created_at: new Date().toISOString(),
      });
    if (error) throw new Error(`LogOffer Error: ${error.message}`);
    return true;
  },

  /**
   * Retrieves the full history of a negotiation.
   */
  async getNegotiationThread(negotiationId) {
    const { data, error } = await supabase
      .from('b2b_negotiations_history')
      .select('*')
      .eq('negotiation_id', negotiationId)
      .order('created_at', { ascending: true });

    if (error) throw new Error(`GetThread Error: ${error.message}`);
    return data || [];
  },

  /**
   * Builds a human-readable "Thread View" for the notification.
   */
  async buildThreadSummary(negotiationId) {
    const history = await this.getNegotiationThread(negotiationId);
    if (!history || history.length === 0) return "No history yet.";

    // Determine whose side "Me" is: the initiator of the negotiation
    const { data: neg } = await supabase
      .from('b2b_negotiations')
      .select('initiator_business_id')
      .eq('id', negotiationId)
      .maybeSingle();
    const mySideId = neg?.initiator_business_id;

    let summary = "📜 **Negotiation History:**\\n";
    history.forEach((entry, i) => {
      const side = mySideId && entry.sender_business_id === mySideId ? "Me" : "Them";
      const price = entry.offer_data?.price ? ` [${entry.offer_data.price} ETB]` : "";
      summary += `${i + 1}. ${side}: ${entry.message_content.substring(0, 50)}${price}...\\n`;
    });
    return summary;
  }
};

module.exports = negotiationHistoryService;
