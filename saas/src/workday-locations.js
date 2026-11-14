// Workday lists a role open in several places as "3 Locations" (French boards:
// "3 emplacements"). That text names no country, so a workspace focused on
// Canada dropped those roles: 296 of TD's 1,673 roles and 91 of Sun Life's 276
// in November 2026. The role's own page (the CXS detail endpoint) names every
// location and the country; it is read once per role and remembered.

const MULTI_LOCATION_RE = /^\s*\d+\s+(?:locations?|emplacements?|lieux|ubicaciones|standorte)\s*$/i;
const CACHE_LIMIT = 50_000;
const MAX_PLACES = 5;
const cache = new Map();

export function isWorkdayMultiLocation(text) {
  return MULTI_LOCATION_RE.test(String(text || ''));
}

// https://x.wd3.myworkdayjobs.com/wday/cxs/x/Site/jobs + /job/... -> the role's detail URL.
export function getWorkdayDetailUrl(apiUrl, externalPath) {
  const path = String(externalPath || '');
  if (!/^\/job\//.test(path)) return '';
  const base = String(apiUrl || '').replace(/\/jobs\/?$/, '');
  return /^https:\/\/[^/]+\.myworkdayjobs\.com\/wday\/cxs\//i.test(base) ? `${base}${path}` : '';
}

// "Dieppe, New Brunswick, Canada; Moncton, New Brunswick; Riverview, New Brunswick"
export function formatWorkdayLocations(info = {}) {
  const places = [...new Set([info.location, ...(Array.isArray(info.additionalLocations) ? info.additionalLocations : [])]
    .map((value) => String(value || '').trim()).filter(Boolean))];
  if (!places.length) return '';
  const country = String(info.country?.descriptor || '').trim();
  if (country && !places[0].toLowerCase().includes(country.toLowerCase())) places[0] = `${places[0]}, ${country}`;
  const shown = places.slice(0, MAX_PLACES).join('; ');
  return places.length > MAX_PLACES ? `${shown}; and ${places.length - MAX_PLACES} more` : shown;
}

function remember(key, value) {
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
  cache.set(key, value);
}

// Replaces "N Locations" on each posting with the places its page names.
// Bounded: at most `limit` pages a call, `concurrency` at a time, and nothing
// started after the deadline. Unresolved postings keep their original text.
export async function resolveWorkdayLocations(postings, { apiUrl, getJson, concurrency = 6, limit = 300, deadlineAt = Infinity, clock = () => performance.now() } = {}) {
  const stats = { multiLocation: 0, fromCache: 0, fetched: 0, unresolved: 0 };
  const queue = [];
  for (const posting of postings || []) {
    if (!isWorkdayMultiLocation(posting?.locationsText)) continue;
    stats.multiLocation += 1;
    const url = getWorkdayDetailUrl(apiUrl, posting.externalPath);
    if (!url) { stats.unresolved += 1; continue; }
    const known = cache.get(url);
    if (known) {
      posting.locationsSummary = posting.locationsText;
      posting.locationsText = known;
      stats.fromCache += 1;
    } else {
      queue.push([posting, url]);
    }
  }
  const work = queue.slice(0, limit);
  stats.unresolved += queue.length - work.length;
  let next = 0;
  const worker = async () => {
    while (next < work.length) {
      const [posting, url] = work[next++];
      if (clock() >= deadlineAt) { stats.unresolved += 1; continue; }
      try {
        const text = formatWorkdayLocations((await getJson(url))?.jobPostingInfo);
        if (!text) { stats.unresolved += 1; continue; }
        remember(url, text);
        posting.locationsSummary = posting.locationsText;
        posting.locationsText = text;
        stats.fetched += 1;
      } catch {
        stats.unresolved += 1;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, work.length)) }, worker));
  return stats;
}

export function clearWorkdayLocationCache() {
  cache.clear();
}
