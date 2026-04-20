const { aggregateAllBusinesses } = require('../services/analytics');

async function runAnalyticsAggregation() {
  console.log('Running daily analytics aggregation...');
  await aggregateAllBusinesses();
}

module.exports = { runAnalyticsAggregation };
