import { whatchimp } from './whatchimp.js';
import { tg } from './telegram.js'; // Assuming tg provider exists

/**
 * Messaging Gateway
 * Central routing for all outbound communications across different channels.
 */
export const messagingGateway = {
  /**
   * Sends a message to a customer via their preferred or specified channel.
   * @param {Object} customer - The customer object from the DB.
   * @param {string} content - The message text.
   * @param {Object} options - Optional overrides { channel: 'whatsapp' | 'telegram' }.
   */
  async send(customer, content, options = {}) {
    const channel = options.channel || customer.preferred_channel || 'telegram';
    
    console.log(`[Gateway] Routing message to ${customer.name} via ${channel}...`);

    try {
      if (channel === 'whatsapp') {
        if (!customer.whatsapp_phone) {
          throw new Error(`Customer ${customer.name} has no WhatsApp phone number.`);
        }
        const result = await whatchimp.sendMessage(customer.whatsapp_phone, content);
        if (!result.success) throw new Error(result.error);
        return { channel: 'wa', success: true, data: result.data };
      } 
      
      if (channel === 'telegram') {
        if (!customer.telegram_id) {
          throw new Error(`Customer ${customer.name} has no Telegram ID.`);
        }
        const result = await tg.sendMessage(customer.telegram_id, content);
        if (!result.success) throw new Error(result.error);
        return { channel: 'tg', success: true, data: result.data };
      }

      throw new Error(`Unsupported channel: ${channel}`);
    } catch (error) {
      console.error(`[Gateway] Failed to send via ${channel}:`, error.message);
      return { success: false, error: error.message };
    }
  },

  /**
   * Helper to determine the best channel for a specific intent.
   * Can be expanded with AI logic later.
   */
  suggestChannel(customer, intent) {
    if (intent === 'formal_outreach') return 'whatsapp';
    if (intent === 'quick_reply') return 'telegram';
    return customer.preferred_channel || 'telegram';
  }
};
