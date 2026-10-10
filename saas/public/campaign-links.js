// Keep a shared walkthrough's campaign tags through its product entry links.
// Account tokens, emails, and other query parameters never leave this page.
const campaignKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'];
const entryPaths = new Set(['/', '/job-search', '/ats-checker']);

function normalizeCampaignToken(value) {
  const raw = String(value || '').trim();
  if (raw.includes('@') || /(?:[a-z]+:\/\/|[\\/?#])/i.test(raw)) return '';
  return raw.toLowerCase()
    .replace(/[^a-z0-9_.-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 32);
}

const incoming = new URLSearchParams(window.location.search);
const tags = campaignKeys
  .map(key => [key, normalizeCampaignToken(incoming.get(key))])
  .filter(([, value]) => value);

if (tags.length) {
  for (const link of document.querySelectorAll('a[data-campaign-link]')) {
    const destination = new URL(link.href, window.location.origin);
    if (destination.origin !== window.location.origin || !entryPaths.has(destination.pathname)) continue;
    for (const key of campaignKeys) destination.searchParams.delete(key);
    for (const [key, value] of tags) destination.searchParams.set(key, value);
    link.href = `${destination.pathname}${destination.search}${destination.hash}`;
  }
}
