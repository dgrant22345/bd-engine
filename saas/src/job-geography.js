const CANADA_COUNTRY_RE = /\b(canada|canadian)\b/i;
const US_COUNTRY_RE = /\b(us|usa|u\.s\.a?|united states(?: of america)?)\b/i;
const NORTH_AMERICA_REGION_RE = /\bnorth america\b/i;
const OTHER_REGION_RE = /\b(emea|europe|european union|uk|united kingdom|england|scotland|wales|ireland|netherlands|germany|france|spain|italy|poland|sweden|norway|denmark|finland|switzerland|austria|portugal|belgium|australia|new zealand|india|singapore|japan|china|hong kong|latin america|latam|apac|asia|africa|middle east)\b/i;
const CANADA_PROVINCE_RE = /\b(ontario|british columbia|alberta|quebec|québec|nova scotia|manitoba|saskatchewan|new brunswick|newfoundland(?: and labrador)?|prince edward island|pei|yukon|northwest territories|nunavut)\b/i;
const US_STATE_RE = /\b(california|new york|texas|washington|massachusetts|florida|illinois|georgia|colorado|arizona|virginia|pennsylvania|north carolina|ohio|michigan|new jersey|maryland|oregon|minnesota|tennessee|utah|district of columbia)\b/i;
const CANADA_CITY_RE = /\b(toronto|gta|mississauga|brampton|markham|vaughan|oakville|ottawa|waterloo|kitchener|hamilton|calgary|edmonton|montreal|montréal|vancouver|burnaby|richmond|surrey|victoria|kelowna|quebec city|halifax|winnipeg|regina|saskatoon|london|guelph|barrie|windsor|kingston|cambridge|laval|gatineau|longueuil|fredericton|moncton|charlottetown|dartmouth|kanata|nepean|st\.? john'?s)\b/i;
const US_CITY_RE = /\b(seattle|boston|chicago|austin|denver|atlanta|san francisco|los angeles|new york city|miami|dallas|houston|phoenix|portland|philadelphia|detroit|minneapolis|nashville|salt lake city)\b/i;
const CANADA_CODE_RE = /(?:^|,\s*|\s*-\s*|\(\s*)(on|bc|ab|qc|ns|mb|sk|nb|pe|pei|yt|nt|nu)(?=\s*(?:,|\/|\||\)|$))/i;
const US_CODE_RE = /(?:^|,\s*)(ca|ny|tx|wa|ma|fl|il|ga|co|az|va|pa|nc|oh|mi|nj|md|or|mn|tn|ut|dc)(?=\s*(?:,|\/|\||\)|$))/i;
const OTHER_COUNTRY_CODE_RE = /(?:^|,\s*)(nl|gb|uk|ie|de|fr|es|it|pl|se|no|dk|fi|ch|at|pt|be|au|nz|in|sg|jp|cn|hk)(?=\s*(?:,|\/|\||\)|$))/i;
const NEWFOUNDLAND_CODE_RE = /\b(st\.? john'?s|corner brook|gander|newfoundland(?: and labrador)?),\s*nl\b/i;

const GTA_CITY_RE = /\b(toronto|gta|mississauga|brampton|markham|vaughan|oakville|scarborough|north york|richmond hill|etobicoke|burlington|milton|pickering|ajax|whitby|oshawa|kitchener|waterloo|hamilton)\b/i;
const NON_GTA_CANADA_RE = /\b(vancouver|calgary|edmonton|montreal|winnipeg|halifax|quebec|bc|ab|qc)\b/i;

const CANADA_SQL_STRONG_TERMS = [
  'canada', 'canadian', 'ontario', 'british columbia', 'alberta', 'quebec', 'québec',
  'nova scotia', 'manitoba', 'saskatchewan', 'new brunswick', 'newfoundland',
  'prince edward island', 'yukon', 'northwest territories', 'nunavut',
];
const CANADA_SQL_CITY_TERMS = [
  'toronto', 'gta', 'mississauga', 'brampton', 'markham', 'vaughan', 'oakville',
  'ottawa', 'waterloo', 'kitchener', 'hamilton', 'calgary', 'edmonton', 'montreal',
  'montréal', 'vancouver', 'burnaby', 'richmond', 'surrey', 'victoria', 'kelowna',
  'quebec city', 'halifax', 'winnipeg', 'regina', 'saskatoon', 'london', 'guelph',
  'barrie', 'windsor', 'kingston', 'cambridge', 'laval', 'gatineau', 'longueuil',
  'fredericton', 'moncton', 'charlottetown', 'dartmouth', 'kanata', 'nepean',
  'corner brook', 'gander',
  "st. john's", 'st johns',
];
const CONFLICTING_SQL_TERMS = [
  'united states', 'usa', 'california', 'new york', 'texas', 'washington',
  'massachusetts', 'florida', 'illinois', 'georgia', 'colorado', 'arizona',
  'virginia', 'pennsylvania', 'north carolina', 'ohio', 'michigan', 'new jersey',
  'maryland', 'oregon', 'minnesota', 'tennessee', 'utah', 'district of columbia',
  'emea', 'europe', 'european union', 'united kingdom', 'england', 'scotland',
  'wales', 'ireland', 'netherlands', 'germany', 'france', 'spain', 'italy',
  'poland', 'sweden', 'norway', 'denmark', 'finland', 'switzerland', 'austria',
  'portugal', 'belgium', 'australia', 'new zealand', 'india', 'singapore',
  'japan', 'china', 'hong kong', 'latin america', 'latam', 'apac', 'asia',
  'africa', 'middle east',
];
const CANADA_CODE_SQL_PATTERN = '(^|,[[:space:]]*|[[:space:]]*-[[:space:]]*|[(][[:space:]]*)(on|bc|ab|qc|ns|mb|sk|nb|pe|pei|yt|nt|nu)([[:space:]]*(,|/|[|]|[)]|$))';
const CONFLICTING_CODE_SQL_PATTERN = '(^|,[[:space:]]*)(ca|ny|tx|wa|ma|fl|il|ga|co|az|va|pa|nc|oh|mi|nj|md|or|mn|tn|ut|dc|nl|gb|uk|ie|de|fr|es|it|pl|se|no|dk|fi|ch|at|pt|be|au|nz|in|sg|jp|cn|hk)([[:space:]]*(,|/|[|]|[)]|$))';

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function sqlLiteral(value) {
  return String(value).replaceAll("'", "''");
}

function ilikeAny(expression, terms) {
  return terms.map((term) => `${expression} ILIKE '%${sqlLiteral(term)}%'`).join(' OR ');
}

export function parseGeographyFocus(geographyFocus) {
  const geography = String(geographyFocus || '').toLowerCase().trim();
  if (!geography) return { canada: true, us: true, other: false };
  if (/global|anywhere|worldwide|international|\ball\b|every/.test(geography)) {
    return { canada: true, us: true, other: true };
  }
  const us = /\b(us|usa|u\.s\.a?|united states|america)\b/.test(geography);
  const canada = /canad/.test(geography);
  if (!us && !canada) return { canada: true, us: true, other: true };
  return { canada, us, other: false };
}

export function classifyJobRegion(item = {}, accountItem = null) {
  const locations = Array.isArray(item.locations) ? item.locations : String(item.location || '').split(' | ');
  if (locations.length > 1) {
    const regions = new Set(locations.map((location) => classifyJobRegion({ location })));
    if (regions.has('north_america') || (regions.has('canada') && regions.has('us'))) return 'north_america';
    if (regions.has('canada')) return 'canada';
    if (regions.has('us')) return 'us';
    if (regions.has('remote')) return 'remote';
  }
  const text = [
    item.location,
    item.country,
    item.region,
    item.office,
    !item.location && accountItem?.location,
  ].filter(Boolean).join(' ').trim();
  if (!text) return 'unknown';

  const canadaCountry = CANADA_COUNTRY_RE.test(text);
  const usCountry = US_COUNTRY_RE.test(text);
  if (NORTH_AMERICA_REGION_RE.test(text)) return 'north_america';
  if (canadaCountry && usCountry) return 'north_america';
  if (canadaCountry) return 'canada';
  if (usCountry) return 'us';
  if (NEWFOUNDLAND_CODE_RE.test(text)) return 'canada';
  if (OTHER_REGION_RE.test(text) || OTHER_COUNTRY_CODE_RE.test(text)) return 'other';
  if (CANADA_CODE_RE.test(text)) return 'canada';
  if (US_CODE_RE.test(text)) return 'us';
  if (CANADA_PROVINCE_RE.test(text)) return 'canada';
  if (US_STATE_RE.test(text)) return 'us';
  if (CANADA_CITY_RE.test(text)) return 'canada';
  if (US_CITY_RE.test(text)) return 'us';
  if (/remote/i.test(text)) return 'remote';
  return 'other';
}

export function jobMatchesGeography(item, accountItem, allow) {
  const allowed = allow || { canada: true, us: true, other: false };
  if (allowed.canada && allowed.us && allowed.other) return true;
  switch (classifyJobRegion(item, accountItem)) {
    case 'canada': return allowed.canada;
    case 'us': return allowed.us;
    case 'north_america': return allowed.canada || allowed.us;
    case 'remote': return allowed.canada || allowed.us || allowed.other;
    case 'other': return allowed.other;
    case 'unknown': return true;
    default: return true;
  }
}

export function isGtaLocation(location) {
  const text = String(location || '').trim();
  if (!text) return false;
  if (GTA_CITY_RE.test(text)) return true;
  if (/\b(canada|ontario)\b/i.test(text) || /(?:^|,\s*)(on|ontario)(?:\s+|,|$)/i.test(text)) {
    return !NON_GTA_CANADA_RE.test(text);
  }
  return false;
}

export function locationMatchesGeography(item = {}, geography = '') {
  const requested = normalizeKey(geography);
  if (requested === 'gta') return isGtaLocation(item.location || item.geography || '');
  const region = classifyJobRegion({
    ...item,
    location: item.location || item.geography || '',
  });
  if (requested === 'canada') return region === 'canada' || region === 'north_america';
  if (requested === 'us') return region === 'us' || region === 'north_america';
  if (requested === 'canada_us') return ['canada', 'us', 'north_america'].includes(region);
  return true;
}

export function buildCanadaJobLocationSql(expression = 'j.location') {
  const strongCanada = ilikeAny(expression, CANADA_SQL_STRONG_TERMS);
  const canadaCities = ilikeAny(expression, CANADA_SQL_CITY_TERMS);
  const conflicts = ilikeAny(expression, CONFLICTING_SQL_TERMS);
  return `(
    (${strongCanada}) OR
    ${expression} ~* '(st\\.? john''?s|corner brook|gander|newfoundland( and labrador)?),[[:space:]]*nl' OR
    ${expression} ~* '${CANADA_CODE_SQL_PATTERN}' OR
    ((${canadaCities}) AND NOT ((${conflicts}) OR ${expression} ~* '${CONFLICTING_CODE_SQL_PATTERN}'))
  )`;
}

// Generate PostgreSQL patterns from the same rules as the in-memory classifier.
// Expressions are code-owned, never user input; filter values remain parameters.
function regexSql(expression, regex) {
  const pattern = regex.source.replaceAll('\\b', '\\y').replaceAll('(?:', '(');
  return `${expression} ~* '${sqlLiteral(pattern)}'`;
}

export function buildJobGeographySql(geography, expression = 'j.location') {
  if (geography === 'gta') {
    return `(${regexSql(expression, GTA_CITY_RE)} OR ((${regexSql(expression, /\b(canada|ontario)\b/i)} OR ${regexSql(expression, /(?:^|,\s*)(on|ontario)(?:\s+|,|$)/i)}) AND NOT ${regexSql(expression, NON_GTA_CANADA_RE)}))`;
  }
  if (!['canada', 'us', 'canada_us'].includes(geography)) return 'TRUE';
  const text = 'location_part';
  const match = (regex) => regexSql(text, regex);
  const region = `CASE
    WHEN ${match(NORTH_AMERICA_REGION_RE)} OR (${match(CANADA_COUNTRY_RE)} AND ${match(US_COUNTRY_RE)}) THEN 'north_america'
    WHEN ${match(CANADA_COUNTRY_RE)} THEN 'canada'
    WHEN ${match(US_COUNTRY_RE)} THEN 'us'
    WHEN ${match(NEWFOUNDLAND_CODE_RE)} THEN 'canada'
    WHEN ${match(OTHER_REGION_RE)} OR ${match(OTHER_COUNTRY_CODE_RE)} THEN 'other'
    WHEN ${match(CANADA_CODE_RE)} THEN 'canada'
    WHEN ${match(US_CODE_RE)} THEN 'us'
    WHEN ${match(CANADA_PROVINCE_RE)} THEN 'canada'
    WHEN ${match(US_STATE_RE)} THEN 'us'
    WHEN ${match(CANADA_CITY_RE)} THEN 'canada'
    WHEN ${match(US_CITY_RE)} THEN 'us' ELSE 'other' END`;
  const allowed = geography === 'canada_us' ? "'canada', 'us', 'north_america'" : `'${geography}', 'north_america'`;
  return `EXISTS (SELECT 1 FROM unnest(string_to_array(COALESCE(${expression}, ''), ' | ')) AS location_part WHERE (${region}) IN (${allowed}))`;
}

export function classifyWorkStyle(item = {}) {
  const declared = normalizeKey(item.workplaceType);
  if (['remote', 'hybrid', 'onsite'].includes(declared)) return declared;
  const text = [item.location, item.title, item.department, item.employmentType, item.commitment].filter(Boolean).join(' ').toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  if (/\bhybrid\b/.test(text)) return 'hybrid';
  if (/\b(remote|work from home|distributed|anywhere)\b/.test(text)) return 'remote';
  if (/\b(on site|onsite|in office|office based)\b/.test(text)) return 'onsite';
  return 'unknown';
}

export function buildJobWorkStyleSql(alias = 'j') {
  const declared = `lower(COALESCE(${alias}.raw->>'workplaceType', ''))`;
  const text = `lower(regexp_replace(concat_ws(' ', ${alias}.location, ${alias}.title, ${alias}.raw->>'department', ${alias}.raw->>'employmentType', ${alias}.raw->>'commitment'), '[^a-zA-Z0-9]+', ' ', 'g'))`;
  return `CASE WHEN ${declared} IN ('remote', 'hybrid', 'onsite') THEN ${declared}
    WHEN ${regexSql(text, /\bhybrid\b/i)} THEN 'hybrid'
    WHEN ${regexSql(text, /\b(remote|work from home|distributed|anywhere)\b/i)} THEN 'remote'
    WHEN ${regexSql(text, /\b(on site|onsite|in office|office based)\b/i)} THEN 'onsite' ELSE 'unknown' END`;
}
