import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { findByOwnerTelegramId } from '../../../../lib/server/businesses';
import { supabase } from '../../../../lib/server/db';
import { canonicalCategory } from '../../../../lib/server/categoryMap.mjs';
import { validateOnboarding, ownerOnboardingResponse } from '../../../../lib/server/onboardingState.mjs';

export const dynamic = 'force-dynamic';
const json = (body, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
async function owner(request) {
  const data = request.headers.get('x-telegram-init-data');
  if (!data || !verifyTelegramInitData(data, process.env.TELEGRAM_BOT_TOKEN)) return null;
  const user = parseTelegramUser(data);
  return user?.id ? findByOwnerTelegramId(user.id) : null;
}
export async function GET(request) {
  try {
    const business = await owner(request);
    if (!business) return json({ error: 'unauthorized' }, 401);
    const { data, error } = await supabase().from('business_onboarding').select('country_code,owner_contact_email,owner_contact_phone,state').eq('business_id', business.id).maybeSingle();
    if (error) return json({ error: 'Could not load saved progress. Please retry.' }, 503);
    return json(ownerOnboardingResponse(data));
  } catch { return json({ error: 'Could not load saved progress. Please retry.' }, 503); }
}
export async function PATCH(request) {
  try {
    const business = await owner(request);
    if (!business) return json({ error: 'unauthorized' }, 401);
    let validated;
    try { validated = validateOnboarding(await request.json()); }
    catch (e) { return json({ error: e.message, field: e.field }, 400); }
    const sb = supabase();
    if ('category' in validated.business) validated.business.category_canonical = canonicalCategory(validated.business.category);
    if (Object.keys(validated.business).length) {
      const { error } = await sb.from('businesses').update(validated.business).eq('id', business.id);
      if (error) return json({ error: 'Could not save your details. Please retry.' }, 503);
    }
    const existing = await sb.from('business_onboarding').select('country_code,owner_contact_email,owner_contact_phone,state').eq('business_id', business.id).maybeSingle();
    if (existing.error) return json({ error: 'Could not save your progress. Please retry.' }, 503);
    const { error } = await sb.from('business_onboarding').upsert({ ...existing.data, business_id: business.id, ...validated.profile, updated_at: new Date().toISOString() }, { onConflict: 'business_id' });
    if (error) return json({ error: 'Could not save your progress. Please retry.' }, 503);
    return json({ ok: true });
  } catch { return json({ error: 'Could not save your progress. Please retry.' }, 503); }
}
