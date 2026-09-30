// Shared by the activation endpoints and the onboarding disclosure.
export const TRIAL_DAYS = 30;
export const ONBOARDING_TRIAL = {
  days: TRIAL_DAYS,
  paymentRequired: false,
  afterTrial: 'After your trial, MiniMe drafts replies for you to review and send on Free. Choose Pro if you want automatic sending to continue.',
};

export const SCREENS = ['business', 'offer', 'answer', 'preview', 'location', 'contact', 'review', 'success'];
export function resumeScreen(value) {
  if (SCREENS.includes(value)) return value;
  return { welcome: 'business', shop_name: 'business', customer_chat: 'offer', connect: 'location' }[value] || 'business';
}
// The current flow is intentionally four moments. `answer`, `location`, and
// `contact` remain here only so unfinished legacy sessions can resume safely.
export const STAGE = { business: 0, offer: 1, answer: 1, preview: 1, location: 2, contact: 2, review: 2, success: 3 };
export const CATEGORIES = [
  ['food_beverage', 'Food & drink'], ['clothing_fashion', 'Clothing & fashion'],
  ['beauty_wellness', 'Beauty & wellness'], ['electronics_phones', 'Electronics'],
  ['training_consulting', 'Professional services'], ['it_tech', 'Technology'],
  ['photography_video', 'Photography & video'], ['catering_food', 'Catering'],
  ['branding_design', 'Design'], ['printing_signage', 'Printing'],
  ['events_entertainment', 'Events'], ['construction_interior', 'Construction & interiors'],
  ['transport_delivery', 'Transport & delivery'], ['wholesale_supply', 'Wholesale'],
  ['vehicles_automotive', 'Vehicles'], ['other', 'Something else'],
];
// ISO 3166-1 country/territory codes; names come from the runtime's English CLDR data.
const codes = 'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW';
const names = new Intl.DisplayNames(['en'], { type: 'region' });
export const COUNTRIES = codes.split(' ').map(code => ({ code, name: names.of(code) })).sort((a, b) => a.name.localeCompare(b.name));
// Stable across Node and browser ICU versions (avoids hydration differences).
export const CURRENCIES = 'AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BRL BSD BTN BWP BYN BZD CAD CDF CHF CLP CNY COP CRC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE SOS SRD SSP STN SYP SZL THB TJS TMT TND TND TOP TRY TTD TWD TZS UAH UGX USD UYU UZS VES VND VUV WST XAF XCD XCG XOF XPF YER ZAR ZMW ZWG'.split(' ').filter((v,i,a)=>a.indexOf(v)===i);
const currencyGroups = {
  EUR: 'AD AT AX BE BL CY DE EE ES FI FR GF GP GR HR IE IT LT LU LV MC ME MF MQ MT NL PM PT RE SI SK SM TF VA YT',
  USD: 'AS BQ EC FM GU IO MH MP PA PR PW SV TC TL UM US VG VI',
  XOF: 'BF BJ CI GW ML NE SN TG', XAF: 'CF CG CM GA GQ TD', XCD: 'AG AI DM GD KN LC MS VC',
  AUD: 'AU CC CX HM KI NF NR TV', NZD: 'CK NU NZ PN TK', GBP: 'GB GG IM JE',
  DKK: 'DK FO GL', NOK: 'BV NO SJ', XPF: 'NC PF WF', CHF: 'CH LI',
};
const directCurrencies = { AE: 'AED', AF: 'AFN', AL: 'ALL', AM: 'AMD', AO: 'AOA', AR: 'ARS', AW: 'AWG', AZ: 'AZN', BA: 'BAM', BB: 'BBD', BD: 'BDT', BG: 'EUR', BH: 'BHD', BI: 'BIF', BM: 'BMD', BN: 'BND', BO: 'BOB', BR: 'BRL', BS: 'BSD', BT: 'BTN', BW: 'BWP', BY: 'BYN', BZ: 'BZD', CA: 'CAD', CD: 'CDF', CL: 'CLP', CN: 'CNY', CO: 'COP', CR: 'CRC', CU: 'CUP', CV: 'CVE', CZ: 'CZK', DJ: 'DJF', DO: 'DOP', DZ: 'DZD', EG: 'EGP', ER: 'ERN', ET: 'ETB', FJ: 'FJD', FK: 'FKP', GE: 'GEL', GH: 'GHS', GI: 'GIP', GM: 'GMD', GN: 'GNF', GY: 'GYD', HK: 'HKD', HN: 'HNL', HT: 'HTG', HU: 'HUF', ID: 'IDR', IL: 'ILS', IN: 'INR', IQ: 'IQD', IR: 'IRR', IS: 'ISK', JM: 'JMD', JO: 'JOD', JP: 'JPY', KE: 'KES', KG: 'KGS', KH: 'KHR', KM: 'KMF', KP: 'KPW', KR: 'KRW', KW: 'KWD', KY: 'KYD', KZ: 'KZT', LA: 'LAK', LB: 'LBP', LK: 'LKR', LR: 'LRD', LS: 'LSL', LY: 'LYD', MA: 'MAD', MD: 'MDL', MG: 'MGA', MK: 'MKD', MM: 'MMK', MN: 'MNT', MO: 'MOP', MR: 'MRU', MU: 'MUR', MV: 'MVR', MW: 'MWK', MX: 'MXN', MY: 'MYR', MZ: 'MZN', NA: 'NAD', NG: 'NGN', NI: 'NIO', NP: 'NPR', OM: 'OMR', PE: 'PEN', PG: 'PGK', PH: 'PHP', PK: 'PKR', PL: 'PLN', PY: 'PYG', QA: 'QAR', RO: 'RON', RS: 'RSD', RU: 'RUB', RW: 'RWF', SA: 'SAR', SB: 'SBD', SC: 'SCR', SD: 'SDG', SE: 'SEK', SG: 'SGD', SH: 'SHP', SO: 'SOS', SR: 'SRD', SS: 'SSP', ST: 'STN', SY: 'SYP', SZ: 'SZL', TH: 'THB', TJ: 'TJS', TM: 'TMT', TN: 'TND', TO: 'TOP', TR: 'TRY', TT: 'TTD', TW: 'TWD', TZ: 'TZS', UA: 'UAH', UG: 'UGX', UY: 'UYU', UZ: 'UZS', VE: 'VES', VN: 'VND', VU: 'VUV', WS: 'WST', YE: 'YER', ZA: 'ZAR', ZM: 'ZMW', ZW: 'ZWG' };
export function suggestedCurrency(country) {
  const candidate = directCurrencies[country] || Object.entries(currencyGroups).find(([, regions]) => regions.split(' ').includes(country))?.[0];
  return CURRENCIES.includes(candidate) ? candidate : '';
}
