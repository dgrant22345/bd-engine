// Phenom career sites (jobs.rbc.com, jobs.bmo.com, jobs.bell.ca, ...): custom
// domains whose pages carry the site's settings in `phApp.ddo`, and a public
// "widgets" endpoint on the same host that the site's own search page calls.
//
// Observed in November 2026:
// - one request returns at most 500 roles;
// - paging is not stable (ties in the default order), so a board larger than
//   one page is read in a second order and the two are joined;
// - each country locale lists only that country's roles (BMO: /ca/en lists
//   540 Canadian roles, /us/en 496 American ones, none shared), so the
//   Canadian and US English listings are read alongside the site's own.

export const PHENOM_PAGE_SIZE = 500;
const PHENOM_MAX_ROLES = 5000;
const EXTRA_LOCALES = [['en_ca', 'ca'], ['en_us', 'us']];
const SORT_ORDERS = ['', 'Most recent'];

// The site's settings from a Phenom page, or null when the page is not one.
// The widgets endpoint must be on the page's own host.
export function readPhenomSite(html, pageUrl) {
  const text = String(html || '');
  if (!/phApp\.ddo\s*=/.test(text)) return null;
  const pick = (pattern) => text.match(pattern)?.[1] || '';
  const refNum = pick(/"refNum"\s*:\s*"([A-Za-z0-9_-]{2,40})"/);
  const endpointValue = pick(/"widgetApiEndpoint"\s*:\s*"([^"]{1,300})"/).replace(/\\\//g, '/');
  if (!refNum || !endpointValue) return null;
  let page; let endpoint;
  try {
    page = new URL(pageUrl);
    endpoint = new URL(endpointValue, page);
  } catch {
    return null;
  }
  if (endpoint.protocol !== 'https:' || endpoint.hostname.toLowerCase() !== page.hostname.toLowerCase()) return null;
  const locale = (pick(/"locale"\s*:\s*"([a-z]{2}_[a-z]{2})"/i) || 'en_us').toLowerCase();
  const country = (pick(/"country"\s*:\s*"([a-z]{2})"/i) || locale.slice(3)).toLowerCase();
  const prefix = page.pathname.match(/^\/([a-z]{2})\/([a-z]{2})(?:\/|$)/i);
  const sitePath = prefix ? `/${prefix[1].toLowerCase()}/${prefix[2].toLowerCase()}` : `/${country}/${locale.slice(0, 2)}`;
  const total = Number(pick(/"eagerLoadRefineSearch"\s*:\s*\{\s*"status"\s*:\s*\d+\s*,\s*"hits"\s*:\s*\d+\s*,\s*"totalHits"\s*:\s*(\d+)/));
  return {
    refNum,
    endpoint: endpoint.toString(),
    origin: page.origin,
    sitePath,
    searchUrl: `${page.origin}${sitePath}/search-results`,
    locale,
    country,
    pageId: pick(/"pageId"\s*:\s*"([A-Za-z0-9_-]{1,60})"/),
    siteType: (pick(/"siteType"\s*:\s*"([a-z]{1,20})"/i) || 'external').toLowerCase(),
    total: Number.isFinite(total) && total > 0 ? total : null,
  };
}

// The stored search page for a board: its resolved URL, else built from the
// board id ("jobs.rbc.com/ca/en").
export function getPhenomSearchUrl(config = {}, boardId = '') {
  for (const value of [config.resolvedBoardUrl, config.boardUrl, config.careersUrl, config.sourceUrl]) {
    try {
      const parsed = new URL(String(value || ''));
      if (parsed.protocol !== 'https:') continue;
      const prefix = parsed.pathname.match(/^\/([a-z]{2})\/([a-z]{2})(?:\/|$)/i);
      if (prefix) return `${parsed.origin}/${prefix[1].toLowerCase()}/${prefix[2].toLowerCase()}/search-results`;
    } catch {
      // Try the next field.
    }
  }
  const id = String(boardId || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  return /^[a-z0-9.-]+\.[a-z]{2,}(?:\/[a-z]{2}\/[a-z]{2})?$/i.test(id) ? `https://${id}/search-results` : '';
}

// "jobs.rbc.com/ca/en" for https://jobs.rbc.com/ca/en/search-results.
export function getPhenomBoardId(searchUrl) {
  try {
    const parsed = new URL(searchUrl);
    return `${parsed.hostname.toLowerCase()}${parsed.pathname.replace(/\/search-results\/?$/i, '')}`;
  } catch {
    return '';
  }
}

function requestBody(site, lang, country, { from = 0, sortBy = '', size = PHENOM_PAGE_SIZE, facet = '', selected = {} } = {}) {
  return JSON.stringify({
    lang, deviceType: 'desktop', country, pageName: 'search-results', ddoKey: 'refineSearch', sortBy, subsearch: '',
    from, jobs: true, counts: Boolean(facet), all_fields: facet ? [facet] : [], size, clearAll: false, jdsource: 'facets', isSliderEnable: false,
    pageId: site.pageId, siteType: site.siteType, keywords: '', global: true, selected_fields: selected, locationData: {}, refNum: site.refNum,
  });
}

const roleKey = (job) => String(job?.jobId || job?.reqId || job?.jobSeqNo || '');
const MAX_CATEGORY_READS = 40;

// Every role in one locale (firstPageOnly: just the first page and the total).
// postJson(url, body) returns the parsed response. Returns null when the site
// does not serve that locale. Past one page, the default order and the newest
// first are read; if roles are still missing, each job category is read on
// its own (categories are small enough for one page each).
export async function readPhenomLocale(site, lang, country, postJson, { pageSize = PHENOM_PAGE_SIZE, firstPageOnly = false } = {}) {
  const read = async (options) => {
    const payload = await postJson(site.endpoint, requestBody(site, lang, country, { size: pageSize, ...options }));
    const result = payload?.refineSearch;
    const jobs = result?.data?.jobs;
    if (!Array.isArray(jobs)) return null;
    return { jobs, total: Number(result.totalHits) || 0, aggregations: result.data.aggregations };
  };
  const first = await read({});
  if (!first) return null;
  const total = Math.min(first.total, PHENOM_MAX_ROLES);
  const byKey = new Map();
  const add = (jobs) => { for (const job of jobs) if (roleKey(job) && !byKey.has(roleKey(job))) byKey.set(roleKey(job), { ...job, phenomLocale: lang, phenomCountry: country }); };
  const done = () => ({ jobs: [...byKey.values()], total: first.total, complete: byKey.size >= first.total });
  add(first.jobs);
  if (firstPageOnly) return done();
  for (const [index, sortBy] of SORT_ORDERS.entries()) {
    if (byKey.size >= total) break;
    for (let from = index === 0 ? pageSize : 0; from < total; from += pageSize) {
      const page = await read({ from, sortBy });
      if (!page?.jobs.length) break;
      add(page.jobs);
    }
  }
  if (byKey.size < total) {
    const counts = await read({ size: 1, facet: 'category' });
    const categories = Object.entries(counts?.aggregations?.find?.((item) => item?.field === 'category')?.value || {})
      .filter(([name, count]) => name && Number(count) > 0).slice(0, MAX_CATEGORY_READS);
    for (const [name, count] of categories) {
      for (let from = 0; from < Math.min(Number(count), PHENOM_MAX_ROLES); from += pageSize) {
        const page = await read({ from, selected: { category: [name] } });
        if (!page?.jobs.length) break;
        add(page.jobs);
      }
      if (byKey.size >= total) break;
    }
  }
  return done();
}

// All roles on a Phenom site: its own locale, plus the Canadian and US English
// listings. getText(url) returns a page's HTML; postJson posts to the API.
export async function readPhenomBoard(searchUrl, { getText, postJson }) {
  const site = readPhenomSite(await getText(searchUrl), searchUrl);
  if (!site) throw new Error('Phenom: career site settings not found; existing jobs preserved');
  const locales = [[site.locale, site.country], ...EXTRA_LOCALES.filter(([lang]) => lang !== site.locale)];
  const byKey = new Map();
  let complete = true;
  let ownLocaleRead = false;
  for (const [lang, country] of locales) {
    const own = lang === site.locale;
    let result = null;
    try {
      // Some sites ignore the locale (RBC lists the same roles under /us/en):
      // an extra locale whose first page is all known roles is skipped.
      if (!own) {
        const peek = await readPhenomLocale(site, lang, country, postJson, { firstPageOnly: true });
        if (!peek?.total || peek.jobs.every((job) => byKey.has(roleKey(job)))) continue;
      }
      result = await readPhenomLocale(site, lang, country, postJson);
    } catch (error) {
      if (own) throw error;
    }
    if (!result) {
      if (own) complete = false;
      continue;
    }
    if (own) ownLocaleRead = true;
    if (!result.complete) complete = false;
    for (const job of result.jobs) if (!byKey.has(roleKey(job))) byKey.set(roleKey(job), job);
  }
  if (!ownLocaleRead) throw new Error('Phenom: no job listings returned; existing jobs preserved');
  return { jobs: [...byKey.values()], complete, site };
}

// The public page for a role: <origin>/<country>/<lang>/job/<id>.
export function getPhenomJobUrl(raw = {}, searchUrl = '') {
  const id = String(raw.jobId || raw.reqId || '').trim();
  if (!id) return '';
  try {
    const parsed = new URL(searchUrl);
    const country = String(raw.phenomCountry || '').toLowerCase();
    const lang = String(raw.phenomLocale || '').toLowerCase().slice(0, 2);
    const sitePath = /^[a-z]{2}$/.test(country) && /^[a-z]{2}$/.test(lang)
      ? `/${country}/${lang}`
      : parsed.pathname.replace(/\/search-results\/?$/i, '');
    return `${parsed.origin}${sitePath}/job/${encodeURIComponent(id)}`;
  } catch {
    return '';
  }
}

export function readPhenomLocation(raw = {}) {
  const multi = Array.isArray(raw.multi_location) ? raw.multi_location.filter(Boolean) : [];
  return String(raw.location || multi[0] || raw.cityStateCountry || [raw.city, raw.state, raw.country].filter(Boolean).join(', ') || '').trim();
}
