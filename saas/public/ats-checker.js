const PROVIDERS = [
  ['Greenhouse', ['greenhouse.io']],
  ['Lever', ['lever.co']],
  ['Ashby', ['ashbyhq.com']],
  ['SmartRecruiters', ['smartrecruiters.com']],
  ['Workday', ['myworkdayjobs.com']],
  ['BambooHR', ['bamboohr.com']],
  ['Workable', ['workable.com']],
  ['Jobvite', ['jobvite.com']],
  ['Recruitee', ['recruitee.com']],
  ['Personio', ['jobs.personio.de']],
  ['Rippling', ['ats.rippling.com']],
];

export function classifyCareerUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return { status: 'invalid', title: 'Enter a public URL', tone: 'error' };

  let parsed;
  try {
    parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { status: 'invalid', title: 'That URL could not be read', tone: 'error' };
  }

  if (!['http:', 'https:'].includes(parsed.protocol) || !isPublicHostname(parsed.hostname)) {
    return { status: 'invalid', title: 'Use a public career-site URL', tone: 'error' };
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
  for (const [provider, domains] of PROVIDERS) {
    if (domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) {
      return {
        status: 'recognized',
        provider,
        hostname,
        title: `${provider} provider detected`,
        tone: 'success',
      };
    }
  }

  return {
    status: 'review',
    hostname,
    title: 'Discovery and review are still needed',
    tone: 'review',
  };
}

function isPublicHostname(hostname) {
  const normalized = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!normalized || normalized === 'localhost' || normalized.endsWith('.local')) return false;
  if (/^(127\.|10\.|192\.168\.|169\.254\.)/.test(normalized)) return false;
  const private172 = normalized.match(/^172\.(\d{1,3})\./);
  if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) return false;
  if (normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd')) return false;
  return normalized.includes('.');
}

function renderResult(result) {
  const container = document.getElementById('checker-result');
  const status = document.getElementById('result-status');
  const title = document.getElementById('result-title');
  const message = document.getElementById('result-message');
  const actions = document.getElementById('result-actions');
  if (!container || !status || !title || !message || !actions) return;

  container.hidden = false;
  container.dataset.tone = result.tone;
  status.textContent = result.status === 'recognized'
    ? 'Recognized provider'
    : result.status === 'review'
      ? 'Needs discovery'
      : 'Check the URL';
  title.textContent = result.title;
  message.textContent = result.status === 'recognized'
    ? 'This host matches a provider BD Engine supports. The board must still be public and accessible, and role completeness can vary by employer configuration.'
    : result.status === 'review'
      ? 'This appears to be an ordinary company or careers URL. BD Engine may be able to discover a compatible public board from it, but this browser-only check cannot confirm coverage.'
      : 'Enter a public company careers page or hosted job-board URL. Nothing is fetched or submitted by this checker.';
  actions.replaceChildren();

  if (result.status !== 'invalid') {
    const staffingLink = document.createElement('a');
    staffingLink.href = '/?utm_source=ats-checker&utm_medium=tool&utm_campaign=checker_result';
    staffingLink.textContent = 'Open staffing workflow';
    const jobSearchLink = document.createElement('a');
    jobSearchLink.href = '/job-search?utm_source=ats-checker&utm_medium=tool&utm_campaign=checker_result';
    jobSearchLink.textContent = 'Open job-search workflow';
    actions.append(staffingLink, jobSearchLink);
  }
}

function getVisitorId() {
  const key = 'bd_visitor_id';
  let visitorId = '';
  try { visitorId = localStorage.getItem(key); } catch {}
  if (!visitorId) {
    visitorId = crypto.randomUUID ? crypto.randomUUID() : `visitor-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    try { localStorage.setItem(key, visitorId); } catch {}
  }
  return visitorId;
}

function campaignSource() {
  const params = new URLSearchParams(window.location.search);
  const sanitize = (value) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '-').slice(0, 32);
  const source = sanitize(params.get('utm_source')) || 'direct';
  const campaign = sanitize(params.get('utm_campaign'));
  return (campaign ? `${source}.${campaign}` : source).slice(0, 48);
}

function trackCheckerEvent(eventType = 'pageview') {
  const body = JSON.stringify({
    visitorId: getVisitorId(),
    eventType,
    path: '/ats-checker',
    referrer: document.referrer || '',
    source: campaignSource(),
  });
  if (navigator.sendBeacon) {
    navigator.sendBeacon('/api/analytics/visit', new Blob([body], { type: 'application/json' }));
    return;
  }
  fetch('/api/analytics/visit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body,
    keepalive: true,
  }).catch(() => {});
}

if (typeof document !== 'undefined') {
  document.getElementById('ats-checker-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = document.getElementById('career-url');
    renderResult(classifyCareerUrl(input?.value));
    trackCheckerEvent('tool_used');
  });
  trackCheckerEvent();
}
