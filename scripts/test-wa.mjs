import 'dotenv/config';
import path from 'path';
import fs from 'fs';
import { whatchimp } from '../apps/web/src/lib/server/whatchimp.js';

// Explicitly load env into process.env before importing or calling
const envPath = path.resolve('/mnt/c/Users/HPZBOOK-G9/minime/.env');
if (fs.existsSync(envPath)) {
  const envFile = fs.readFileSync(envPath, 'utf8');
  envFile.split('\\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valParts] = trimmed.split('=');
      const value = valParts.join('=').trim().replace(/^['"]/, '').replace(/['"]$/, '');
      process.env[key.trim()] = value;
    }
  });
}

async function runWAtest() {
  const TEST_PHONE = '251953405253'; 
  const TEST_MESSAGE = '🚀 MiniMe Integration Test: The system is now omnichannel!';
  
  console.log('--- 🧪 MiniMe WhatsApp Direct Test ---');
  console.log(`Target Phone: ${TEST_PHONE}`);
  console.log(`Message: ${TEST_MESSAGE}`);
  console.log(`API Key Loaded: ${process.env.WHATCHIMP_API_KEY ? '✅ Yes' : '❌ No'}\n`);

  try {
    console.log('Verifying WhatChimp API connectivity...');
    
    const result = await whatchimp.sendMessage(TEST_PHONE, TEST_MESSAGE);

    if (result.success) {
      console.log('\n✅ SUCCESS!');
      console.log('WhatChimp Response:', JSON.stringify(result.data, null, 2));
    } else {
      console.log('\n❌ API ERROR');
      console.log('Error Detail:', JSON.stringify(result.error, null, 2));
    }

  } catch (error) {
    console.error('\n❌ CRITICAL FAILURE');
    console.error('Error Message:', error.message);
  }
}

runWAtest();
