/**
 * @typedef {Object} Business
 * @property {string} id
 * @property {number} owner_telegram_id
 * @property {number} business_group_chat_id
 * @property {string} name
 * @property {number} trust_level
 * @property {boolean} panic_mode
 * @property {string} subscription_status
 * @property {Object} voice_embedding
 * @property {string[]} sample_replies
 */

/**
 * @typedef {Object} Customer
 * @property {string} id
 * @property {string} business_id
 * @property {number} telegram_id
 * @property {string} name
 * @property {string} tier
 * @property {number} total_spent
 * @property {number} total_orders
 */

/**
 * @typedef {Object} Message
 * @property {string} id
 * @property {string} conversation_id
 * @property {string} direction - 'inbound' | 'outbound'
 * @property {string} content
 * @property {boolean} is_ai_generated
 * @property {number} ai_confidence
 * @property {string} status - 'drafted' | 'approved' | 'sent' | 'failed' | 'skipped'
 */

/**
 * @typedef {Object} Intent
 * @property {string} intent
 * @property {string} sentiment
 * @property {string} urgency
 * @property {string} language
 * @property {string[]} topics
 */

module.exports = {};
