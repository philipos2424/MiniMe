
const { supabase } = require('../../../packages/db/client');

async function checkHandles() {
  const handles = ['Nurimportbot', 'Thebakeshopbot', 'CoffeeCornerET', 'EventGuruET', 'FitHubEthiopia', 'GreenMarketET', 'RideShareEthiopia', 'HomeCleanET', 'BookBazaarET'];
  console.log('--- Checking Registered Businesses ---');
  
  for (const handle of handles) {
    const cleanHandle = handle.replace('@', '');
    const { data, error } = await supabase
      .from('businesses')
      .select('id, name, owner_telegram_id')
      .eq('owner_telegram_id', cleanHandle);
      
    if (error) {
      console.log(`❌ Error checking {handle}: ${error.message}`);
    } else if (data && data.length > 0) {
      console.log(`✅ FOUND: ${handle} (Business: ${data[0].name})`);
    } else {
      console.log(`👻 NOT FOUND: ${handle}`);
    }
  }
}

checkHandles().catch(console.error);
