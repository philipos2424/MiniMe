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

// Name → business-type guess for the first screen. A pre-selected, editable
// default; the owner's own tap always wins. Terms match at a word start; a
// trailing space means the whole word only ("it " must not match "habit").
const CATEGORY_HINTS = [
  ['electronics_phones', ['phone', 'mobile', 'electronic', 'computer', 'laptop', 'gadget']],
  ['beauty_wellness', ['salon', 'beauty', 'spa ', 'barber', 'hair', 'nail', 'cosmetic', 'makeup']],
  ['food_beverage', ['cafe', 'coffee', 'restaurant', 'kitchen', 'grill', 'pizza', 'bakery', 'burger', 'juice', 'food']],
  ['catering_food', ['catering']],
  ['clothing_fashion', ['fashion', 'boutique', 'wear', 'style', 'clothing', 'shoe', 'tailor', 'dress']],
  ['vehicles_automotive', ['garage', 'auto', 'car ', 'cars', 'motor', 'tyre', 'tire']],
  ['photography_video', ['photo', 'studio', 'video', 'film']],
  ['printing_signage', ['print', 'sign ', 'signs', 'signage']],
  ['branding_design', ['design', 'brand', 'creative']],
  ['it_tech', ['tech', 'software', 'web', 'digital', 'it ']],
  ['events_entertainment', ['event', 'wedding', 'party', 'dj ']],
  ['construction_interior', ['construction', 'interior', 'build', 'furniture']],
  ['transport_delivery', ['transport', 'delivery', 'logistic', 'courier', 'taxi']],
  ['wholesale_supply', ['wholesale', 'supply', 'supplies', 'import', 'trading']],
  ['training_consulting', ['consult', 'training', 'academy', 'tutor', 'coach']],
];
export function guessCategory(name) {
  const normalized = ` ${String(name || '').toLowerCase()} `;
  return CATEGORY_HINTS.find(([, terms]) => terms.some(term => normalized.includes(` ${term}`)))?.[0] || '';
}

// International calling code → country, longest prefix first. Shared codes
// (+1, +7, +44 islands…) resolve to the largest market; the owner can change it.
const CALLING_CODES = {
  1:'US', 7:'RU', 20:'EG', 27:'ZA', 30:'GR', 31:'NL', 32:'BE', 33:'FR', 34:'ES', 36:'HU', 39:'IT', 40:'RO', 41:'CH', 43:'AT', 44:'GB', 45:'DK', 46:'SE', 47:'NO', 48:'PL', 49:'DE',
  51:'PE', 52:'MX', 53:'CU', 54:'AR', 55:'BR', 56:'CL', 57:'CO', 58:'VE', 60:'MY', 61:'AU', 62:'ID', 63:'PH', 64:'NZ', 65:'SG', 66:'TH', 81:'JP', 82:'KR', 84:'VN', 86:'CN', 90:'TR', 91:'IN', 92:'PK', 93:'AF', 94:'LK', 95:'MM', 98:'IR',
  211:'SS', 212:'MA', 213:'DZ', 216:'TN', 218:'LY', 220:'GM', 221:'SN', 222:'MR', 223:'ML', 224:'GN', 225:'CI', 226:'BF', 227:'NE', 228:'TG', 229:'BJ', 230:'MU', 231:'LR', 232:'SL', 233:'GH', 234:'NG', 235:'TD', 236:'CF', 237:'CM', 238:'CV', 240:'GQ', 241:'GA', 242:'CG', 243:'CD', 244:'AO', 249:'SD', 250:'RW', 251:'ET', 252:'SO', 253:'DJ', 254:'KE', 255:'TZ', 256:'UG', 257:'BI', 258:'MZ', 260:'ZM', 261:'MG', 263:'ZW', 264:'NA', 265:'MW', 266:'LS', 267:'BW', 268:'SZ', 291:'ER',
  351:'PT', 352:'LU', 353:'IE', 354:'IS', 355:'AL', 356:'MT', 357:'CY', 358:'FI', 359:'BG', 370:'LT', 371:'LV', 372:'EE', 373:'MD', 374:'AM', 375:'BY', 380:'UA', 381:'RS', 385:'HR', 386:'SI', 387:'BA', 420:'CZ', 421:'SK',
  852:'HK', 855:'KH', 856:'LA', 880:'BD', 886:'TW', 960:'MV', 961:'LB', 962:'JO', 963:'SY', 964:'IQ', 965:'KW', 966:'SA', 967:'YE', 968:'OM', 970:'PS', 971:'AE', 972:'IL', 973:'BH', 974:'QA', 975:'BT', 976:'MN', 977:'NP', 992:'TJ', 993:'TM', 994:'AZ', 995:'GE', 996:'KG', 998:'UZ',
};
export function countryFromPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  for (const length of [3, 2, 1]) {
    const code = CALLING_CODES[digits.slice(0, length)];
    if (code) return code;
  }
  return '';
}

// Device timezone → country for the most common markets. Only a starting
// suggestion; unknown zones leave the field empty.
const TIME_ZONES = {
  'Africa/Addis_Ababa':'ET', 'Africa/Nairobi':'KE', 'Africa/Lagos':'NG', 'Africa/Accra':'GH', 'Africa/Johannesburg':'ZA', 'Africa/Cairo':'EG', 'Africa/Kampala':'UG', 'Africa/Dar_es_Salaam':'TZ', 'Africa/Kigali':'RW', 'Africa/Asmara':'ER', 'Africa/Djibouti':'DJ', 'Africa/Mogadishu':'SO', 'Africa/Khartoum':'SD', 'Africa/Juba':'SS', 'Africa/Casablanca':'MA', 'Africa/Algiers':'DZ', 'Africa/Tunis':'TN', 'Africa/Dakar':'SN', 'Africa/Abidjan':'CI', 'Africa/Douala':'CM', 'Africa/Kinshasa':'CD', 'Africa/Luanda':'AO', 'Africa/Lusaka':'ZM', 'Africa/Harare':'ZW', 'Africa/Maputo':'MZ',
  'Asia/Dubai':'AE', 'Asia/Riyadh':'SA', 'Asia/Qatar':'QA', 'Asia/Kuwait':'KW', 'Asia/Jerusalem':'IL', 'Asia/Beirut':'LB', 'Asia/Amman':'JO', 'Asia/Baghdad':'IQ', 'Asia/Tehran':'IR', 'Asia/Karachi':'PK', 'Asia/Kolkata':'IN', 'Asia/Calcutta':'IN', 'Asia/Dhaka':'BD', 'Asia/Kathmandu':'NP', 'Asia/Colombo':'LK', 'Asia/Bangkok':'TH', 'Asia/Jakarta':'ID', 'Asia/Manila':'PH', 'Asia/Singapore':'SG', 'Asia/Kuala_Lumpur':'MY', 'Asia/Ho_Chi_Minh':'VN', 'Asia/Shanghai':'CN', 'Asia/Hong_Kong':'HK', 'Asia/Taipei':'TW', 'Asia/Seoul':'KR', 'Asia/Tokyo':'JP', 'Asia/Tashkent':'UZ', 'Asia/Almaty':'KZ', 'Asia/Tbilisi':'GE', 'Asia/Yerevan':'AM', 'Asia/Baku':'AZ',
  'Europe/London':'GB', 'Europe/Dublin':'IE', 'Europe/Paris':'FR', 'Europe/Berlin':'DE', 'Europe/Madrid':'ES', 'Europe/Rome':'IT', 'Europe/Amsterdam':'NL', 'Europe/Brussels':'BE', 'Europe/Zurich':'CH', 'Europe/Vienna':'AT', 'Europe/Stockholm':'SE', 'Europe/Oslo':'NO', 'Europe/Copenhagen':'DK', 'Europe/Helsinki':'FI', 'Europe/Warsaw':'PL', 'Europe/Prague':'CZ', 'Europe/Lisbon':'PT', 'Europe/Athens':'GR', 'Europe/Istanbul':'TR', 'Europe/Kiev':'UA', 'Europe/Kyiv':'UA', 'Europe/Moscow':'RU', 'Europe/Bucharest':'RO',
  'America/New_York':'US', 'America/Chicago':'US', 'America/Denver':'US', 'America/Los_Angeles':'US', 'America/Phoenix':'US', 'America/Toronto':'CA', 'America/Vancouver':'CA', 'America/Mexico_City':'MX', 'America/Sao_Paulo':'BR', 'America/Argentina/Buenos_Aires':'AR', 'America/Bogota':'CO', 'America/Lima':'PE', 'America/Santiago':'CL',
  'Australia/Sydney':'AU', 'Australia/Melbourne':'AU', 'Australia/Perth':'AU', 'Pacific/Auckland':'NZ',
};
export function countryFromTimeZone(zone) {
  return TIME_ZONES[zone] || '';
}

// Optional "real details" on the offer screen. MiniMe only states what the
// owner wrote here — these become plain facts, never guesses.
export const FULFILMENT_OPTIONS = [
  ['delivery', 'We deliver', 'We deliver to customers.'],
  ['pickup', 'Pickup / visit us', 'Customers pick up or visit us in person; we do not deliver.'],
  ['both', 'Delivery or pickup', 'Customers can choose delivery or pickup.'],
  ['online', 'Online / remote', 'We serve customers online or remotely.'],
];
export function factsStatement({ fact_price = '', fact_hours = '', fact_fulfilment = '' } = {}) {
  const parts = [];
  if (fact_price.trim()) parts.push(`Typical prices: ${fact_price.trim()}.`);
  if (fact_hours.trim()) parts.push(`Opening hours: ${fact_hours.trim()}.`);
  const fulfilment = FULFILMENT_OPTIONS.find(([value]) => value === fact_fulfilment)?.[2];
  if (fulfilment) parts.push(fulfilment);
  return parts.join(' ');
}
