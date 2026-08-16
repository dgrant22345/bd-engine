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

const PENDING_AUDIT_SUMMARY_KEY = 'bd_pending_audit_summary';
const PUBLIC_CHECKER_URL = 'https://bd-engine-production.up.railway.app/ats-checker';
const EXAMPLE_CAREER_URLS = [
  'https://boards.greenhouse.io/example',
  'https://jobs.lever.co/example',
  'https://jobs.ashbyhq.com/example',
  'https://example.wd5.myworkdayjobs.com/jobs',
  'https://careers.smartrecruiters.com/example',
  'https://example.com/careers',
];

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

export function buildShareSummary(audit) {
  const validCount = Number(audit?.validCount || 0);
  const recognizedCount = Number(audit?.recognizedCount || 0);
  const reviewCount = Number(audit?.reviewCount || 0);
  const recognitionRate = Number(audit?.recognitionRate || 0);
  if (!validCount) {
    return 'ATS coverage audit: no valid public career-site URLs were available to score.';
  }
  const reviewLabel = reviewCount === 1 ? '1 URL still needs' : `${reviewCount} URLs still need`;
  return `ATS coverage audit: ${recognizedCount} of ${validCount} valid public URLs (${recognitionRate}%) use a recognized ATS host. ${reviewLabel} discovery. Host recognition is a compatibility signal, not a guarantee of complete or fresh job coverage.`;
}

function integerInRange(value, minimum, maximum) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

export function buildShareUrl(audit, baseUrl = PUBLIC_CHECKER_URL) {
  const validCount = integerInRange(Number(audit?.validCount), 1, 50);
  if (validCount === null) return '';
  const recognizedCount = integerInRange(Number(audit?.recognizedCount), 0, validCount);
  if (recognizedCount === null) return '';
  const url = new URL(baseUrl, PUBLIC_CHECKER_URL);
  url.pathname = '/ats-checker';
  url.hash = '';
  url.search = '';
  url.searchParams.set('shared', '1');
  url.searchParams.set('valid', String(validCount));
  url.searchParams.set('recognized', String(recognizedCount));
  url.searchParams.set('utm_source', 'shared-audit');
  url.searchParams.set('utm_medium', 'referral');
  url.searchParams.set('utm_campaign', 'coverage_result');
  return url.toString();
}

export function parseSharedAudit(search) {
  const params = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  if (params.get('shared') !== '1') return null;
  const validCount = integerInRange(Number(params.get('valid')), 1, 50);
  if (validCount === null) return null;
  const recognizedCount = integerInRange(Number(params.get('recognized')), 0, validCount);
  if (recognizedCount === null) return null;
  const reviewCount = validCount - recognizedCount;
  return {
    shared: true,
    results: [],
    totalCount: validCount,
    validCount,
    recognizedCount,
    reviewCount,
    invalidCount: 0,
    recognitionRate: Math.round((recognizedCount / validCount) * 100),
    duplicateCount: 0,
    truncatedCount: 0,
  };
}

function storePendingAuditSummary(audit) {
  if (typeof sessionStorage === 'undefined') return;
  try {
    if (!audit?.validCount) {
      sessionStorage.removeItem(PENDING_AUDIT_SUMMARY_KEY);
      return;
    }
    sessionStorage.setItem(PENDING_AUDIT_SUMMARY_KEY, JSON.stringify({
      validCount: Number(audit.validCount || 0),
      recognizedCount: Number(audit.recognizedCount || 0),
      reviewCount: Number(audit.reviewCount || 0),
      recognitionRate: Number(audit.recognitionRate || 0),
      createdAt: Date.now(),
    }));
  } catch {
    // The audit remains usable when browser storage is disabled.
  }
}

async function copyAuditSummary(audit) {
  const summary = buildShareSummary(audit);
  if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable.');
  await navigator.clipboard.writeText(summary);
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
  tableWrap.hidden = audit.results.length === 0;

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

async function downloadCoverageCard(audit) {
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 630;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable.');

  const validCount = Number(audit.validCount || 0);
  const recognizedCount = Number(audit.recognizedCount || 0);
  const reviewCount = Number(audit.reviewCount || 0);
  const rate = Number(audit.recognitionRate || 0);
  context.fillStyle = '#080d18';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#111a2b';
  context.fillRect(72, 72, 1056, 486);
  context.fillStyle = '#83b4ff';
  context.font = '700 28px system-ui, sans-serif';
  context.fillText('BD ENGINE · ATS COVERAGE AUDIT', 124, 142);
  context.fillStyle = '#ffffff';
  context.font = '800 150px system-ui, sans-serif';
  context.fillText(`${rate}%`, 116, 320);
  context.font = '700 40px system-ui, sans-serif';
  context.fillText(`${recognizedCount} of ${validCount} public ATS hosts recognized`, 124, 390);
  context.fillStyle = '#fbbf24';
  context.font = '650 28px system-ui, sans-serif';
  context.fillText(`${reviewCount} ${reviewCount === 1 ? 'source needs' : 'sources need'} discovery`, 124, 445);
  context.fillStyle = '#a9b4c8';
  context.font = '500 22px system-ui, sans-serif';
  context.fillText('Host recognition is a compatibility signal—not a guarantee of complete or fresh coverage.', 124, 495);
  context.fillText('bd-engine-production.up.railway.app/ats-checker', 124, 535);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('The result card could not be created.');
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'bd-engine-ats-coverage-result.png';
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
  status.textContent = audit.shared
    ? 'Shared aggregate result'
    : !audit.totalCount
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
  message.textContent = audit.shared
    ? `This privacy-safe link contains aggregate counts only: ${audit.recognizedCount} of ${audit.validCount} valid public URLs use a recognized ATS host, while ${countLabel(audit.reviewCount, 'URL')} ${audit.reviewCount === 1 ? 'still needs' : 'still need'} discovery. The original URLs are not included.`
    : !audit.totalCount
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
  if (audit.shared) notes.push('Shared results can be edited in the URL and should be treated as a summary, not independent verification');
  if (audit.duplicateCount) notes.push(`${countLabel(audit.duplicateCount, 'duplicate')} removed`);
  if (audit.truncatedCount) notes.push(`${countLabel(audit.truncatedCount, 'entry', 'entries')} beyond the 50-URL limit not audited`);
  note.textContent = notes.length ? `${notes.join('. ')}.` : '';
  note.hidden = notes.length === 0;
  renderAuditRows(audit);
  actions.replaceChildren();
  storePendingAuditSummary(audit.shared ? null : audit);

  if (hasValidUrls) {
    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.className = 'copy-action';
    copyButton.textContent = 'Copy summary';
    copyButton.addEventListener('click', async () => {
      try {
        await copyAuditSummary(audit);
        copyButton.textContent = 'Summary copied';
        trackCheckerEvent('share_created');
      } catch {
        copyButton.textContent = 'Copy unavailable';
      }
    });
    const shareButton = document.createElement('button');
    shareButton.type = 'button';
    shareButton.className = 'share-action';
    shareButton.textContent = 'Copy share link';
    shareButton.addEventListener('click', async () => {
      const shareUrl = buildShareUrl(audit, window.location.href);
      try {
        if (!shareUrl || !navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable.');
        await navigator.clipboard.writeText(shareUrl);
        shareButton.textContent = 'Share link copied';
        trackCheckerEvent('share_created');
      } catch {
        shareButton.textContent = 'Copy unavailable';
      }
    });
    const cardButton = document.createElement('button');
    cardButton.type = 'button';
    cardButton.className = 'card-action';
    cardButton.textContent = 'Download PNG card';
    cardButton.addEventListener('click', async () => {
      try {
        await downloadCoverageCard(audit);
        cardButton.textContent = 'PNG downloaded';
        trackCheckerEvent('share_created');
      } catch {
        cardButton.textContent = 'PNG unavailable';
      }
    });
    const staffingLink = document.createElement('a');
    staffingLink.href = '/?signup=1&persona=bd&utm_source=ats-checker&utm_medium=tool&utm_campaign=coverage_audit_result';
    staffingLink.className = 'primary-workflow';
    staffingLink.textContent = 'Build a workflow from this audit';
    const jobSearchLink = document.createElement('a');
    jobSearchLink.href = '/job-search?signup=1&utm_source=ats-checker&utm_medium=tool&utm_campaign=coverage_audit_result';
    jobSearchLink.textContent = 'Use it for a job search';
    actions.append(copyButton, shareButton, cardButton);
    if (!audit.shared && audit.results.length) {
      const exportButton = document.createElement('button');
      exportButton.type = 'button';
      exportButton.className = 'export-action';
      exportButton.textContent = 'Download CSV';
      exportButton.addEventListener('click', () => downloadCoverageCsv(audit));
      actions.append(exportButton);
    }
    if (audit.shared) {
      const ownAuditLink = document.createElement('a');
      ownAuditLink.href = '/ats-checker?utm_source=shared-audit&utm_medium=referral&utm_campaign=coverage_result';
      ownAuditLink.textContent = 'Audit my own target list';
      actions.append(ownAuditLink);
    }
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
    const input = document.getElementById('career-urls');
    renderResult(buildCoverageAudit(input?.value));
    trackCheckerEvent('tool_used');
  });
  document.getElementById('load-example')?.addEventListener('click', () => {
    const input = document.getElementById('career-urls');
    if (!input) return;
    input.value = EXAMPLE_CAREER_URLS.join('\n');
    renderResult(buildCoverageAudit(input.value));
    trackCheckerEvent('example_loaded');
  });
  const sharedAudit = parseSharedAudit(window.location.search);
  if (sharedAudit) renderResult(sharedAudit);
  trackCheckerEvent();
}
