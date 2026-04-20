const { findById, setTrustLevel } = require('../../../../packages/db/queries/businesses');
const { getTodayStats } = require('../../../../packages/db/queries/messages');
const { TRUST_LEVELS } = require('../../../../packages/shared/constants');

async function evaluateTrustPromotion(businessId) {
  try {
    const business = await findById(businessId);
    if (!business || business.trust_level >= TRUST_LEVELS.FULL_AGENT) return;

    const stats = await getTodayStats(businessId);
    const aiSent = stats.filter(m => m.is_ai_generated && m.status === 'sent').length;
    const edited = stats.filter(m => m.owner_edited).length;
    const editRate = aiSent > 0 ? edited / aiSent : 1;
    const avgConf = stats.filter(m => m.ai_confidence).reduce((s, m) => s + m.ai_confidence, 0) / (stats.filter(m => m.ai_confidence).length || 1);

    // Promote if edit rate < 10% and avg confidence > 85% over 20+ messages
    if (aiSent >= 20 && editRate < 0.1 && avgConf > 0.85) {
      const nextLevel = business.trust_level + 1;
      await setTrustLevel(businessId, nextLevel);
      return nextLevel;
    }
    return null;
  } catch (e) {
    console.error('evaluateTrustPromotion error:', e.message);
    return null;
  }
}

module.exports = { evaluateTrustPromotion };
