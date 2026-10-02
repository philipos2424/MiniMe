import { SCREENS, COUNTRIES, CURRENCIES, CATEGORIES, FULFILMENT_OPTIONS } from '../onboarding-config.mjs';

// A deliberate allowlist: never accept business_id, Telegram IDs, or arbitrary
// business fields from this owner-facing form.
export function validateOnboarding(body) {
  const profile = {};
  const business = {};
  const fail = (field, message) => { const error = new Error(message); error.field = field; throw error; };
  const string = (key, max, required = false) => {
    if (typeof body[key] !== 'string') fail(key, 'Please enter a valid value.');
    const value = body[key].trim();
    if ((required && !value) || value.length > max) fail(key, required && !value ? 'Please fill in this field.' : 'This value is too long.');
    return value;
  };
  if ('owner_name' in body) business.owner_name = string('owner_name', 100, true);
  if ('currency' in body) {
    business.currency = string('currency', 3);
    if (!CURRENCIES.includes(business.currency)) fail('currency', 'Choose a currency from the list.');
  }
  if ('category' in body) {
    business.category = string('category', 80) || null;
    if (business.category && !CATEGORIES.some(([key]) => key === business.category)) fail('category', 'Choose a business type from the list.');
  }
  if ('country_code' in body) {
    profile.country_code = string('country_code', 2);
    if (!COUNTRIES.some(c => c.code === profile.country_code)) fail('country_code', 'Choose a country from the list.');
  }
  if ('owner_contact_email' in body) {
    profile.owner_contact_email = string('owner_contact_email', 254) || null;
    if (profile.owner_contact_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.owner_contact_email)) fail('owner_contact_email', 'Enter a valid email address or leave it blank.');
  }
  if ('owner_contact_phone' in body) {
    const value = string('owner_contact_phone', 32).replace(/[\s().-]/g, '');
    if (value && !/^\+[1-9]\d{6,14}$/.test(value)) fail('owner_contact_phone', 'Include your country code, for example +1 202 555 0123, or leave it blank.');
    profile.owner_contact_phone = value || null;
  }
  if ('state' in body) {
    const value = body.state;
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('state', 'Invalid progress.');
    const state = { version: 2 };
    if (!SCREENS.includes(value.screen)) fail('state', 'Invalid onboarding step.');
    state.screen = value.screen;
    state.completed = Array.isArray(value.completed) ? [...new Set(value.completed.filter(s => SCREENS.includes(s)))].slice(0, 8) : [];
    state.knowledge = value.knowledge === true;
    state.uploaded = value.uploaded === true;
    for (const [key, max] of Object.entries({ name: 100, offer: 4000, question: 1000, answer: 1500, savedOffer: 4000, savedAnswer: 2600, uploadName: 255, correction: 1500, previewQuestion: 1000, fact_price: 120, fact_hours: 120, savedFacts: 600 })) {
      if (value[key] !== undefined) {
        if (typeof value[key] !== 'string' || value[key].length > max) fail('state', 'Invalid saved progress.');
        state[key] = value[key];
      }
    }
    if (value.fact_fulfilment !== undefined) {
      if (!['', ...FULFILMENT_OPTIONS.map(([key]) => key)].includes(value.fact_fulfilment)) fail('state', 'Invalid saved progress.');
      state.fact_fulfilment = value.fact_fulfilment;
    }
    for (const key of ['picked_offerings', 'custom_offerings']) {
      if (value[key] !== undefined) {
        if (!Array.isArray(value[key]) || value[key].some(item => typeof item !== 'string' || item.length > 40)) fail('state', 'Invalid saved progress.');
        state[key] = [...new Set(value[key].map(item => item.trim()).filter(Boolean))].slice(0, 8);
      }
    }
    profile.state = state;
  }
  return { profile, business };
}

export function ownerOnboardingResponse(row) {
  return row ? { country_code: row.country_code || '', owner_contact_email: row.owner_contact_email || '', owner_contact_phone: row.owner_contact_phone || '', state: row.state || {} } : { state: {} };
}
