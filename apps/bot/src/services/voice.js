const { findById, update } = require('../../../../packages/db/queries/businesses');
const { analyzeVoiceProfile } = require('./ai');

async function rebuildVoiceProfile(businessId) {
  try {
    const business = await findById(businessId);
    if (!business) return null;
    if ((business.sample_replies || []).length < 3) return null;

    const profile = await analyzeVoiceProfile(business.sample_replies);
    if (!profile) return null;

    await update(businessId, { voice_embedding: profile });
    return profile;
  } catch (e) {
    console.error('rebuildVoiceProfile error:', e.message);
    return null;
  }
}

async function addSampleReply(businessId, replyText) {
  try {
    const business = await findById(businessId);
    if (!business) return;
    const samples = [...(business.sample_replies || []), replyText].slice(-100);
    await update(businessId, { sample_replies: samples });

    // Rebuild profile every 10 new samples
    if (samples.length % 10 === 0) {
      await rebuildVoiceProfile(businessId);
    }
  } catch (e) {
    console.error('addSampleReply error:', e.message);
  }
}

module.exports = { rebuildVoiceProfile, addSampleReply };
