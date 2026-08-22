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

export const ONBOARDING_INTENT_STORAGE_KEY = 'bd_onboarding_intent';

export function buildAuditOnboardingIntent(audit, persona = 'bd') {
  const normalizedPersona = persona === 'jobseeker' ? 'jobseeker' : 'bd';
  const results = Array.isArray(audit?.results) ? audit.results : [];
  const careerUrls = results
    .filter((result) => result?.status === 'recognized' || result?.status === 'review')
    .map((result) => String(result.submittedUrl || '').trim())
    .filter(Boolean)
    .slice(0, 50);

  return {
    version: 1,
    source: 'ats-checker',
    persona: normalizedPersona,
    intent: 'monitor-audited-career-sites',
    planIntent: normalizedPersona === 'jobseeker' ? 'jobseeker' : 'trial',
    careerUrls,
    audit: {
      totalCount: Number(audit?.totalCount || 0),
      validCount: Number(audit?.validCount || 0),
      recognizedCount: Number(audit?.recognizedCount || 0),
      reviewCount: Number(audit?.reviewCount || 0),
    },
    updatedAt: new Date().toISOString(),
  };
}

export function buildWorkflowSignupHref(persona = 'bd') {
  const normalizedPersona = persona === 'jobseeker' ? 'jobseeker' : 'bd';
  const params = new URLSearchParams({
    signup: '1',
    persona: normalizedPersona,
    intent: 'monitor-audited-career-sites',
    plan: normalizedPersona === 'jobseeker' ? 'jobseeker' : 'trial',
    utm_source: 'ats-checker',
    utm_medium: 'tool',
    utm_campaign: 'coverage_audit_result',
  });
  return `${normalizedPersona === 'jobseeker' ? '/job-search' : '/'}?${params.toString()}`;
}

function persistAuditOnboardingIntent(audit, persona = 'bd') {
  const intent = buildAuditOnboardingIntent(audit, persona);
  try {
    sessionStorage.setItem(ONBOARDING_INTENT_STORAGE_KEY, JSON.stringify(intent));
    localStorage.removeItem(ONBOARDING_INTENT_STORAGE_KEY);
  } catch {}
  return intent;
}

export function classifyCareerUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return { status: 'invalid', submittedUrl: raw, title: 'Enter a public URL', tone: 'error' };

  let parsed;
  try {
    parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { status: 'invalid', submittedUrl: raw, title: 'That URL could not be read', tone: 'error' };
  }

  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || !isPublicHostname(parsed.hostname)) {
    return { status: 'invalid', submittedUrl: raw, title: 'Use a public career-site URL', tone: 'error' };
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
  for (const [provider, domains] of PROVIDERS) {
    if (domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) {
      return {
        status: 'recognized',
        provider,
        hostname,
        submittedUrl: raw,
        title: `${provider} provider detected`,
        tone: 'success',
      };
    }
  }

  return {
    status: 'review',
    hostname,
    submittedUrl: raw,
    title: 'Discovery and review are still needed',
    tone: 'review',
  };
}

export function buildCoverageAudit(value, maxEntries = 50) {
  const limit = Math.min(50, Math.max(1, Number.parseInt(maxEntries, 10) || 50));
  const lines = String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const seen = new Set();
  const unique = [];
  let duplicateCount = 0;

  for (const line of lines) {
    const key = line.toLowerCase().replace(/\/$/, '');
    if (seen.has(key)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(key);
    unique.push(line);
  }

  const results = unique.slice(0, limit).map(classifyCareerUrl);
  const recognizedCount = results.filter((result) => result.status === 'recognized').length;
  const reviewCount = results.filter((result) => result.status === 'review').length;
  const invalidCount = results.filter((result) => result.status === 'invalid').length;
  const validCount = recognizedCount + reviewCount;

  return {
    results,
    totalCount: results.length,
    validCount,
    recognizedCount,
    reviewCount,
    invalidCount,
    recognitionRate: validCount ? Math.round((recognizedCount / validCount) * 100) : 0,
    duplicateCount,
    truncatedCount: Math.max(0, unique.length - limit),
  };
}

function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function buildCoverageCsv(audit) {
  const rows = [['Submitted URL', 'Host', 'Result', 'Provider']];
  for (const result of audit?.results || []) {
    rows.push([
      result.submittedUrl,
      result.hostname || '',
      result.status === 'recognized' ? 'Recognized' : result.status === 'review' ? 'Needs discovery' : 'Invalid',
      result.provider || '',
    ]);
  }
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
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

function countLabel(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function appendMetric(container, label, value) {
  const wrapper = document.createElement('div');
  const term = document.createElement('dt');
  const description = document.createElement('dd');
  term.textContent = label;
  description.textContent = value;
  wrapper.append(term, description);
  container.append(wrapper);
}

function resultLabel(result) {
  if (result.status === 'recognized') return 'Recognized';
  if (result.status === 'review') return 'Needs discovery';
  return 'Invalid';
}

function renderAuditRows(audit) {
  const tableWrap = document.getElementById('audit-table-wrap');
  const rows = document.getElementById('audit-rows');
  if (!tableWrap || !rows) return;
  rows.replaceChildren();
  tableWrap.hidden = audit.totalCount === 0;

  for (const result of audit.results) {
    const row = document.createElement('tr');
    row.setAttribute('role', 'row');
    const urlCell = document.createElement('td');
    urlCell.setAttribute('role', 'cell');
    urlCell.dataset.label = 'Career URL';
    const submitted = document.createElement('span');
    submitted.className = 'submitted-url';
    submitted.textContent = result.submittedUrl;
    urlCell.append(submitted);
    if (result.hostname) {
      const hostname = document.createElement('span');
      hostname.className = 'hostname';
      hostname.textContent = result.hostname;
      urlCell.append(hostname);
    }

    const statusCell = document.createElement('td');
    statusCell.setAttribute('role', 'cell');
    statusCell.dataset.label = 'Result';
    const status = document.createElement('span');
    status.className = `audit-status audit-status-${result.status}`;
    status.textContent = resultLabel(result);
    statusCell.append(status);

    const providerCell = document.createElement('td');
    providerCell.setAttribute('role', 'cell');
    providerCell.dataset.label = 'Provider';
    providerCell.textContent = result.provider || (result.status === 'review' ? 'Unknown host' : 'Not applicable');
    row.append(urlCell, statusCell, providerCell);
    rows.append(row);
  }
}

function downloadCoverageCsv(audit) {
  const blob = new Blob([buildCoverageCsv(audit)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'bd-engine-ats-coverage-audit.csv';
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function renderResult(audit) {
  const container = document.getElementById('checker-result');
  const status = document.getElementById('result-status');
  const title = document.getElementById('result-title');
  const message = document.getElementById('result-message');
  const summary = document.getElementById('coverage-summary');
  const note = document.getElementById('audit-note');
  const actions = document.getElementById('result-actions');
  if (!container || !status || !title || !message || !summary || !note || !actions) return;

  container.hidden = false;
  const singleResult = audit.results.length === 1 ? audit.results[0] : null;
  const hasValidUrls = audit.validCount > 0;
  container.dataset.tone = !audit.totalCount || !hasValidUrls
    ? 'error'
    : audit.recognizedCount === audit.validCount
      ? 'success'
      : 'review';
  status.textContent = !audit.totalCount
    ? 'Add a target list'
    : !hasValidUrls
      ? 'Check the entries'
      : audit.recognizedCount === audit.validCount
        ? 'All valid hosts recognized'
        : audit.recognizedCount
          ? 'Mixed host coverage'
          : 'Discovery required';
  title.textContent = !audit.totalCount
    ? 'Enter at least one public URL'
    : singleResult?.status === 'recognized'
      ? singleResult.title
      : singleResult?.status === 'review'
        ? singleResult.title
        : !hasValidUrls
          ? 'No valid public URLs to audit'
          : `${audit.recognizedCount} of ${audit.validCount} valid public URLs match a recognized ATS host`;
  message.textContent = !audit.totalCount
    ? 'Enter one public company careers page or hosted job-board URL per line. Nothing is fetched or submitted by this checker.'
    : !hasValidUrls
      ? 'Use public HTTP or HTTPS career-site URLs. Login links, private systems, and unreadable entries are excluded from the denominator.'
      : `Host recognition is ${audit.recognitionRate}%: ${audit.recognizedCount} recognized out of ${audit.validCount} valid public URLs. ${countLabel(audit.reviewCount, 'URL')} ${audit.reviewCount === 1 ? 'needs' : 'need'} discovery, and ${countLabel(audit.invalidCount, 'entry', 'entries')} ${audit.invalidCount === 1 ? 'was' : 'were'} invalid. Recognition identifies the host, not the number or freshness of relevant roles.`;

  summary.replaceChildren();
  appendMetric(summary, 'Audited', String(audit.totalCount));
  appendMetric(summary, 'Valid public URLs', String(audit.validCount));
  appendMetric(summary, 'Recognized ATS', String(audit.recognizedCount));
  appendMetric(summary, 'Host recognition', `${audit.recognitionRate}%`);

  const notes = [];
  if (audit.duplicateCount) notes.push(`${countLabel(audit.duplicateCount, 'duplicate')} removed`);
  if (audit.truncatedCount) notes.push(`${countLabel(audit.truncatedCount, 'entry', 'entries')} beyond the 50-URL limit not audited`);
  note.textContent = notes.length ? `${notes.join('. ')}.` : '';
  note.hidden = notes.length === 0;
  renderAuditRows(audit);
  actions.replaceChildren();

  if (hasValidUrls) {
    // Keep the URL list out of the query string so a 50-site audit cannot create
    // an oversized navigation URL. The destination overlays persona/plan from
    // the link onto this same-origin, versioned handoff payload.
    persistAuditOnboardingIntent(audit);
    const exportButton = document.createElement('button');
    exportButton.type = 'button';
    exportButton.className = 'export-action';
    exportButton.textContent = 'Download CSV';
    exportButton.addEventListener('click', () => downloadCoverageCsv(audit));
    const staffingLink = document.createElement('a');
    staffingLink.href = buildWorkflowSignupHref('bd');
    staffingLink.className = 'primary-workflow';
    staffingLink.textContent = 'Monitor these companies';
    staffingLink.addEventListener('click', () => persistAuditOnboardingIntent(audit, 'bd'));
    const jobSearchLink = document.createElement('a');
    jobSearchLink.href = buildWorkflowSignupHref('jobseeker');
    jobSearchLink.textContent = 'Find relevant roles';
    jobSearchLink.addEventListener('click', () => persistAuditOnboardingIntent(audit, 'jobseeker'));
    actions.append(exportButton, staffingLink, jobSearchLink);
  }

  requestAnimationFrame(() => container.focus({ preventScroll: true }));
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
  const checkerForm = document.getElementById('ats-checker-form');
  let sampleSubmissionPending = false;
  checkerForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = document.getElementById('career-urls');
    renderResult(buildCoverageAudit(input?.value));
    trackCheckerEvent(sampleSubmissionPending ? 'ats_sample_used' : 'ats_audit_completed');
    sampleSubmissionPending = false;
  });
  document.getElementById('example-audit')?.addEventListener('click', () => {
    const input = document.getElementById('career-urls');
    if (!input || !checkerForm) return;
    input.value = [
      'https://boards.greenhouse.io/example',
      'https://jobs.lever.co/example',
      'https://example.com/careers',
    ].join('\n');
    sampleSubmissionPending = true;
    checkerForm.requestSubmit();
  });
  trackCheckerEvent();
}
