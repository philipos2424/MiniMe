const { findById, update, updateTier } = require('../../../../packages/db/queries/customers');
const { getRecentMessages } = require('../../../../packages/db/queries/messages');
const { enrichCustomer } = require('./ai');

async function enrichCustomerProfile(customerId, newMessage, intent, businessId) {
  try {
    const customer = await findById(customerId);
    if (!customer) return;

    // Update language preference
    if (intent.language && intent.language !== 'mixed') {
      await update(customerId, { language_preference: intent.language });
    }

    // Update sentiment average
    const sentimentScore = { happy: 1, interested: 0.75, neutral: 0.5, confused: 0.4, frustrated: 0.25, angry: 0 }[intent.sentiment] ?? 0.5;
    const newAvg = (customer.sentiment_avg * 0.8) + (sentimentScore * 0.2);
    await update(customerId, { sentiment_avg: newAvg, last_active_at: new Date().toISOString() });

    // 🧠 THE SCRIBE: Extract durable facts
    try {
      const { extractCustomerFacts } = require('./ai');
      const facts = await extractCustomerFacts(newMessage);
      if (facts && facts.length > 0) {
        const { insertCustomerMemory } = require('../../../../packages/db/queries/customerMemory');
        for (const fact of facts) {
          await insertCustomerMemory({
            business_id: businessId,
            customer_id: customer.telegram_id,
            fact: fact.text,
            category: fact.category,
            importance: fact.importance,
          });
        }
      }
    } catch (e) {
      console.warn('Scribe extraction failed:', e.message);
    }

    // 📅 THE TASKER: Extract action items
    try {
      const { extractTasks } = require('./ai');
      const tasks = await extractTasks(newMessage, customerId);
      if (tasks && tasks.length > 0) {
        const { insertBusinessTask } = require('../../../../packages/db/queries/businessTasks');
        for (const task of tasks) {
          if (task.is_commitment) {
            await insertBusinessTask({
              business_id: businessId,
              customer_id: customer.telegram_id,
              description: task.description,
              deadline: task.deadline,
              priority: task.priority,
            });
          }
        }
      }
    } catch (e) {
      console.warn('Tasker extraction failed:', e.message);
    }

    // Every 5 messages, do a deeper AI enrichment (legacy support)
    const msgCount = customer.total_orders; 
    if (msgCount % 5 === 0) {
      await deepEnrich(customerId, customer);
    }
  } catch (e) {
    console.error('enrichCustomerProfile error:', e.message);
  }
}

async function deepEnrich(customerId, customer) {
  try {
    const { supabase } = require('../../../../packages/db/client');
    const { data: msgs } = await supabase
      .from('messages')
      .select('content')
      .eq('customer_id', customerId)
      .eq('direction', 'inbound')
      .order('created_at', { ascending: false })
      .limit(20);

    if (!msgs || msgs.length < 3) return;

    const profile = await enrichCustomer(msgs);
    if (!profile) return;

    await update(customerId, {
      language_preference: profile.language_preference || customer.language_preference,
      tags: [...new Set([...(customer.tags || []), ...(profile.suggested_tags || [])])],
      preferences: { ...customer.preferences, ...profile },
      ai_notes: profile.special_notes,
    });
  } catch (e) {
    console.error('deepEnrich error:', e.message);
  }
}

async function recordPurchase(customerId, amount) {
  try {
    const customer = await findById(customerId);
    if (!customer) return;
    const newOrders = (customer.total_orders || 0) + 1;
    const newSpent = (Number(customer.total_spent) || 0) + Number(amount);
    await updateTier(customerId, newOrders, newSpent);
  } catch (e) {
    console.error('recordPurchase error:', e.message);
  }
}

module.exports = { enrichCustomerProfile, recordPurchase };
