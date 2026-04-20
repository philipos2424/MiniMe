const { supabase } = require('../../../../packages/db/client');
const { upsertDaily } = require('../../../../packages/db/queries/analytics');
const { findAll: findAllBusinesses } = require('../../../../packages/db/queries/businesses');

async function aggregateAllBusinesses() {
  try {
    const businesses = await findAllBusinesses();
    const today = new Date().toISOString().split('T')[0];
    for (const business of businesses) {
      await aggregateForBusiness(business.id, today);
    }
  } catch (e) {
    console.error('aggregateAllBusinesses error:', e.message);
  }
}

async function aggregateForBusiness(businessId, date) {
  try {
    const start = `${date}T00:00:00Z`;
    const end = `${date}T23:59:59Z`;

    const { data: messages } = await supabase
      .from('messages')
      .select('direction, is_ai_generated, status, ai_confidence, owner_edited, detected_sentiment, created_at')
      .eq('business_id', businessId)
      .gte('created_at', start)
      .lte('created_at', end);

    if (!messages) return;

    const inbound = messages.filter(m => m.direction === 'inbound');
    const outbound = messages.filter(m => m.direction === 'outbound');
    const aiDrafted = outbound.filter(m => m.is_ai_generated && m.status === 'drafted');
    const aiAutoSent = outbound.filter(m => m.is_ai_generated && m.status === 'sent');
    const aiApproved = outbound.filter(m => m.is_ai_generated && m.status === 'approved');
    const aiEdited = outbound.filter(m => m.owner_edited);
    const aiSkipped = outbound.filter(m => m.status === 'skipped');
    const ownerManual = outbound.filter(m => !m.is_ai_generated);

    const confidences = outbound.filter(m => m.ai_confidence).map(m => m.ai_confidence);
    const avgConf = confidences.length ? confidences.reduce((a, b) => a + b) / confidences.length : null;
    const editRate = aiAutoSent.length ? aiEdited.length / aiAutoSent.length : null;

    const sentiments = inbound.map(m => m.detected_sentiment);

    const { data: newCustomers } = await supabase
      .from('customers')
      .select('id')
      .eq('business_id', businessId)
      .gte('first_contact_at', start)
      .lte('first_contact_at', end);

    const { data: revenue } = await supabase
      .from('payments')
      .select('amount')
      .eq('business_id', businessId)
      .eq('status', 'completed')
      .eq('direction', 'inbound')
      .gte('created_at', start)
      .lte('created_at', end);

    await upsertDaily(businessId, date, {
      total_messages: messages.length,
      inbound_messages: inbound.length,
      outbound_messages: outbound.length,
      ai_drafted: aiDrafted.length,
      ai_auto_sent: aiAutoSent.length,
      ai_approved: aiApproved.length,
      ai_edited: aiEdited.length,
      ai_skipped: aiSkipped.length,
      owner_manual: ownerManual.length,
      avg_ai_confidence: avgConf,
      edit_rate: editRate,
      new_customers: newCustomers?.length || 0,
      revenue: (revenue || []).reduce((s, p) => s + Number(p.amount), 0),
      sentiment_positive: sentiments.filter(s => ['happy', 'interested'].includes(s)).length,
      sentiment_neutral: sentiments.filter(s => s === 'neutral').length,
      sentiment_negative: sentiments.filter(s => ['frustrated', 'angry', 'confused'].includes(s)).length,
    });
  } catch (e) {
    console.error('aggregateForBusiness error:', e.message);
  }
}

module.exports = { aggregateAllBusinesses, aggregateForBusiness };
