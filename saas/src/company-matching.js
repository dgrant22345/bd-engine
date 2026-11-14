// Matching a company name from one source (a LinkedIn export, a pasted
// watchlist) to a company already in the workspace. Companies added by domain
// are named from it ("Sunlife", "Lightspeedhq"), while people's exports use
// the real name ("Sun Life", "Lightspeed Commerce"), so exact keys miss.
//
// Matching stays conservative: an exact key first, then the same letters
// without spaces or punctuation, then a domain label that the name extends
// only by generic words ("Lightspeed" + "Commerce"). A name that fits more
// than one company matches none.

const GENERIC_SUFFIX_RE = /(?:hq|inc|corp|app|group|global|careers|jobs|online)$/;
const GENERIC_TAIL_RE = /^(?:commerce|financial|group|inc|incorporated|corporation|corp|technologies|technology|tech|software|labs|health|bank|canada|holdings|limited|ltd|co|company|solutions|systems|services|global|international|hq)+$/;
const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'gov', 'ac']);
const MIN_PREFIX_LENGTH = 5;

export function compactCompanyKey(value) {
  return String(value || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// "corp.canadiantire.ca" -> "canadiantire"; "lightspeedhq.com" -> "lightspeedhq".
export function domainLabel(domain) {
  const host = String(domain || '').trim().toLowerCase().replace(/^https?:\/\//, '').split(/[/?#]/)[0].replace(/^www\./, '');
  const parts = host.split('.').filter(Boolean);
  if (parts.length < 2) return '';
  const label = parts.length >= 3 && SECOND_LEVEL.has(parts.at(-2)) ? parts.at(-3) : parts.at(-2);
  return compactCompanyKey(label);
}

function stripGenericSuffix(label) {
  const stripped = label.replace(GENERIC_SUFFIX_RE, '');
  return stripped.length >= 3 ? stripped : label;
}

function accountLabels(account = {}) {
  const labels = new Set();
  const add = (value) => {
    const compact = compactCompanyKey(value);
    if (!compact) return;
    labels.add(compact);
    labels.add(stripGenericSuffix(compact));
  };
  add(account.displayName);
  add(account.normalizedName);
  for (const alias of Array.isArray(account.aliases) ? account.aliases : []) add(alias);
  const label = domainLabel(account.domain || account.canonicalDomain);
  if (label) { labels.add(label); labels.add(stripGenericSuffix(label)); }
  return labels;
}

function extendsByGenericWords(longer, shorter) {
  return shorter.length >= MIN_PREFIX_LENGTH && longer.startsWith(shorter) && GENERIC_TAIL_RE.test(longer.slice(shorter.length));
}

function labelMatches(compact, label) {
  return compact === label || extendsByGenericWords(compact, label) || extendsByGenericWords(label, compact);
}

// True when a company's display name is just its domain label, so a person's
// export can supply the real name ("Sunlife" from sunlife.com -> "Sun Life").
export function isDomainDerivedName(account = {}) {
  const label = domainLabel(account.domain || account.canonicalDomain);
  return Boolean(label) && compactCompanyKey(account.displayName) === label;
}

// A Map-like index: get(normalizedKey) returns the matching account or
// undefined; set(normalizedKey, account) adds one. Exact keys keep their
// existing meaning, so callers that used a Map behave as before when names agree.
export function createAccountNameIndex(accounts = [], normalizeKey = (value) => String(value || '').trim().toLowerCase()) {
  const exact = new Map();
  const byCompact = new Map();
  const byDomain = new Map();
  // Labels by full value and by their first five letters: a fuzzy match needs
  // one name to start with the other, so only accounts sharing that prefix
  // are compared (imports can hold thousands of companies).
  const byLabel = new Map();
  const byPrefix = new Map();
  const labelsOf = new Map();
  const push = (map, key, account) => {
    const list = map.get(key) || [];
    if (!list.includes(account)) list.push(account);
    map.set(key, list);
  };
  const add = (key, account) => {
    if (!account) return;
    if (key && !exact.has(key)) exact.set(key, account);
    for (const value of [account.displayName, account.normalizedName]) {
      const compact = compactCompanyKey(value);
      if (compact) push(byCompact, compact, account);
    }
    const domain = String(account.domain || account.canonicalDomain || '').trim().toLowerCase().replace(/^www\./, '');
    if (domain && !byDomain.has(domain)) byDomain.set(domain, account);
    const labels = accountLabels(account);
    labelsOf.set(account, labels);
    for (const label of labels) {
      push(byLabel, label, account);
      if (label.length >= MIN_PREFIX_LENGTH) push(byPrefix, label.slice(0, MIN_PREFIX_LENGTH), account);
    }
  };
  for (const account of accounts) add(normalizeKey(account.displayName || account.normalizedName), account);

  return {
    get(key) {
      if (!key) return undefined;
      if (exact.has(key)) return exact.get(key);
      const compact = compactCompanyKey(key);
      if (!compact) return undefined;
      const sameLetters = byCompact.get(compact) || [];
      if (sameLetters.length === 1) return sameLetters[0];
      if (sameLetters.length > 1) return undefined;
      const candidates = new Set([
        ...(byLabel.get(compact) || []),
        ...(compact.length >= MIN_PREFIX_LENGTH ? byPrefix.get(compact.slice(0, MIN_PREFIX_LENGTH)) || [] : []),
      ]);
      const fuzzy = [];
      for (const account of candidates) {
        for (const label of labelsOf.get(account) || []) {
          if (labelMatches(compact, label)) { fuzzy.push(account); break; }
        }
        if (fuzzy.length > 1) return undefined;
      }
      return fuzzy.length === 1 ? fuzzy[0] : undefined;
    },
    getByDomain(domain) {
      const host = String(domain || '').trim().toLowerCase().replace(/^https?:\/\//, '').split(/[/?#]/)[0].replace(/^www\./, '');
      return host ? byDomain.get(host) : undefined;
    },
    has(key) { return this.get(key) !== undefined; },
    set(key, account) { add(key, account); return this; },
    get size() { return labelsOf.size; },
  };
}

const LEGAL_SUFFIX_RE = /[\s,]+(?:inc\.?|incorporated|ltd\.?|limited|llc|l\.l\.c\.|corp\.?|corporation|co\.|plc|ulc|lp)$/i;

// When a company was named from its domain ("Sunlife"), the name people use
// ("Sun Life") is better. Returns that name, or '' to keep the current one.
export function betterCompanyDisplayName(account = {}, candidateName = '') {
  if (!isDomainDerivedName(account)) return '';
  const name = String(candidateName || '').trim().replace(LEGAL_SUFFIX_RE, '').trim();
  if (!name || name === account.displayName || name.length > 80) return '';
  const compact = compactCompanyKey(name);
  return [...accountLabels(account)].some((label) => labelMatches(compact, label)) ? name : '';
}
