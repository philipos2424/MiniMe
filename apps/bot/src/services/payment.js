const axios = require('axios');
const { create: createPayment, update: updatePayment, findByChapaRef } = require('../../../../packages/db/queries/payments');
const { PLANS } = require('../../../../packages/shared/constants');

async function generatePaymentLink(business) {
  try {
    const txRef = `minime-${business.id}-${Date.now()}`;
    const plan = PLANS.pro;

    const response = await axios.post(
      'https://api.chapa.co/v1/transaction/initialize',
      {
        amount: plan.price,
        currency: plan.currency,
        email: business.email || 'owner@minime.app',
        first_name: business.owner_name || 'Owner',
        tx_ref: txRef,
        return_url: `${process.env.WEB_URL}/settings/billing?success=true`,
        callback_url: `${process.env.BASE_URL}/api/payment/callback`,
        customization: { title: 'MiniMe Pro Subscription', description: `${plan.name} — ${plan.duration_days} days` },
      },
      { headers: { Authorization: `Bearer ${process.env.CHAPA_SECRET_KEY}` } }
    );

    await createPayment({
      business_id: business.id,
      amount: plan.price,
      currency: plan.currency,
      method: 'chapa',
      status: 'pending',
      direction: 'inbound',
      chapa_tx_ref: txRef,
      description: `${plan.name} subscription`,
    });

    return response.data?.data?.checkout_url || null;
  } catch (e) {
    console.error('generatePaymentLink error:', e.message);
    return null;
  }
}

async function handleChapaCallback(body) {
  try {
    const { tx_ref, status } = body;
    if (!tx_ref) return;

    const payment = await findByChapaRef(tx_ref);
    if (!payment) return;

    // Server-to-server verification with Chapa to prevent spoofing
    let verifiedStatus = status;
    try {
      const verifyRes = await axios.get(`https://api.chapa.co/v1/transaction/verify/${tx_ref}`, {
        headers: { Authorization: `Bearer ${process.env.CHAPA_SECRET_KEY}` }
      });
      const verifyData = verifyRes.data?.data;

      if (verifyData) {
        verifiedStatus = verifyData.status;

        // Double check amount and currency if they exist in our record
        if (payment.amount && Number(verifyData.amount) !== Number(payment.amount)) {
          console.error(`[payment verify] amount mismatch for ${tx_ref}: expected ${payment.amount}, got ${verifyData.amount}`);
          verifiedStatus = 'failed';
        }
        if (payment.currency && verifyData.currency !== payment.currency) {
          console.error(`[payment verify] currency mismatch for ${tx_ref}: expected ${payment.currency}, got ${verifyData.currency}`);
          verifiedStatus = 'failed';
        }
      }
    } catch (ve) {
      console.error(`[payment verify] Chapa verification API failed for ${tx_ref}:`, ve.message);
      // In production, we should probably not proceed if verification fails
      if (process.env.NODE_ENV === 'production') return;
    }

    if (verifiedStatus === 'success') {
      await updatePayment(payment.id, { status: 'completed', completed_at: new Date().toISOString() });

      const { update: updateBusiness } = require('../../../../packages/db/queries/businesses');
      const expiresAt = new Date(Date.now() + 30 * 86400000).toISOString();
      await updateBusiness(payment.business_id, {
        subscription_status: 'active',
        subscription_expires_at: expiresAt,
      });
    } else {
      await updatePayment(payment.id, { status: 'failed' });
    }
  } catch (e) {
    console.error('handleChapaCallback error:', e.message);
  }
}

/**
 * Generate a Chapa payment link for a customer to pay THIS business a specific amount.
 * Returns the checkout URL or null.
 */
async function generateCustomerPaymentLink(business, customer, amount, description) {
  try {
    if (!process.env.CHAPA_SECRET_KEY) {
      console.warn('CHAPA_SECRET_KEY missing — cannot generate customer payment link');
      return null;
    }
    if (!amount || amount <= 0) return null;

    const txRef = `cust-${business.id}-${customer?.id || 'anon'}-${Date.now()}`;
    const response = await axios.post(
      'https://api.chapa.co/v1/transaction/initialize',
      {
        amount,
        currency: 'ETB',
        email: customer?.email || 'customer@minime.app',
        first_name: customer?.name?.split(' ')[0] || 'Customer',
        last_name: customer?.name?.split(' ').slice(1).join(' ') || '',
        tx_ref: txRef,
        return_url: `${process.env.WEB_URL || 'https://minime.app'}/thanks`,
        callback_url: `${process.env.BASE_URL}/api/payment/callback`,
        customization: {
          title: `Payment to ${business.name}`.slice(0, 16),
          description: (description || `Payment for ${business.name}`).slice(0, 50),
        },
      },
      { headers: { Authorization: `Bearer ${process.env.CHAPA_SECRET_KEY}` } }
    );

    await createPayment({
      business_id: business.id,
      customer_id: customer?.id || null,
      amount,
      currency: 'ETB',
      method: 'chapa',
      status: 'pending',
      direction: 'inbound',
      chapa_tx_ref: txRef,
      description: description || 'Customer payment',
    });

    return response.data?.data?.checkout_url || null;
  } catch (e) {
    console.error('generateCustomerPaymentLink error:', e.response?.data || e.message);
    return null;
  }
}

async function sendPaymentReminder(bot, business, customer, amount) {
  const ownerChatId = business.owner_private_chat_id;
  if (!ownerChatId) return;
  await bot.sendMessage(ownerChatId,
    `💰 Payment reminder sent to ${customer?.name || 'customer'} for ${amount} ETB`
  );
}

module.exports = { generatePaymentLink, generateCustomerPaymentLink, handleChapaCallback, sendPaymentReminder };
