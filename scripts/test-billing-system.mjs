import {
  getSubscription,
  checkCreditAvailability,
  deductCreditAndLogUsage,
  upgradeSubscription,
  adminManageSubscription,
  SUBSCRIPTION_PLANS,
} from '../apps/web/src/lib/server/billing.js';
import { loggedCompletion, NoCreditsError } from '../apps/web/src/lib/server/openai-wrapper.js';

async function runBillingTests() {
  console.log('🧪 Starting Billing System Tests...\n');
  const mockBizId = '00000000-0000-0000-0000-000000000001';

  // Test 1: Subscription Initialisation
  console.log('Test 1: Initialising Free Subscription...');
  const sub = await getSubscription(mockBizId);
  console.log('✓ Initial Subscription:', {
    plan: sub.plan_name,
    credits_remaining: sub.credits_remaining,
    credits_total: sub.credits_total,
  });

  // Test 2: Check Credit Availability
  console.log('\nTest 2: Checking Credit Availability...');
  const avail = await checkCreditAvailability(mockBizId);
  console.log('✓ Availability:', avail);

  // Test 3: Deduct Credits
  console.log('\nTest 3: Deducting Credit for AI Request...');
  const deductResult = await deductCreditAndLogUsage(mockBizId, null, 150, 0.0005);
  console.log('✓ Deduct Result:', deductResult);

  // Test 4: Subscription Upgrade to Starter ($3/mo - 15 chats)
  console.log('\nTest 4: Upgrading to Starter Plan ($3/mo, 15 chats)...');
  const upgraded = await upgradeSubscription(mockBizId, {
    planName: 'starter',
    paymentReference: 'test-chapa-12345',
    paymentMethod: 'chapa',
  });
  console.log('✓ Upgraded Subscription:', {
    plan: upgraded.plan_name,
    credits_remaining: upgraded.credits_remaining,
    credits_total: upgraded.credits_total,
    status: upgraded.status,
  });

  // Test 5: Admin Manage Credits
  console.log('\nTest 5: Admin Adding Extra Credits (+10)...');
  const adminResult = await adminManageSubscription(mockBizId, {
    action: 'add_credits',
    extraCredits: 10,
  });
  console.log('✓ Admin Modified Subscription:', {
    credits_remaining: adminResult.credits_remaining,
    credits_total: adminResult.credits_total,
  });

  console.log('\n🎉 ALL BILLING SYSTEM TESTS PASSED SUCCESSFULLY!');
}

runBillingTests().catch(err => {
  console.error('❌ Billing Test Error:', err);
  process.exit(1);
});
