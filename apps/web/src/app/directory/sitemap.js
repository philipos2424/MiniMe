/**
 * /directory/sitemap.xml — Dynamic sitemap for Google indexing.
 * Includes the main directory, all category pages, and every business profile.
 */
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const BASE = process.env.WEB_URL || 'https://web-theta-one-68.vercel.app';

const CATEGORIES = [
  'branding_design', 'printing_signage', 'photography_video', 'catering_food',
  'food_beverage', 'it_tech', 'events_entertainment', 'clothing_fashion',
  'beauty_wellness', 'construction_interior', 'transport_delivery',
  'training_consulting', 'wholesale_supply', 'electronics_phones',
];

export default async function sitemap() {
  const entries = [
    // Main directory
    { url: `${BASE}/directory`, lastModified: new Date(), changeFrequency: 'hourly', priority: 1 },
    // Category pages
    ...CATEGORIES.map(cat => ({
      url: `${BASE}/directory?cat=${cat}`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.8,
    })),
  ];

  // Individual business profiles
  try {
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    );
    const { data } = await sb
      .from('businesses')
      .select('telegram_bot_username, updated_at')
      .eq('b2b_discoverable', true)
      .not('telegram_bot_username', 'is', null);

    for (const biz of data || []) {
      entries.push({
        url: `${BASE}/directory/${biz.telegram_bot_username}`,
        lastModified: biz.updated_at ? new Date(biz.updated_at) : new Date(),
        changeFrequency: 'weekly',
        priority: 0.6,
      });
    }
  } catch {}

  return entries;
}
