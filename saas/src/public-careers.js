import { fetchPaginatedAtsJobs, readAtsReportedTotal } from './ats-pagination.js';

function decode(value) {
  return String(value || '').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ').replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}
function text(value) { return decode(String(value || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim(); }

export function avatureBoardUrl(value) {
  try {
    const url = new URL(value);
    if (!url.hostname.endsWith('.avature.net')) return '';
    url.pathname = url.pathname.replace(/\/(?:SearchJobs|JobDetail|Login|Register)(?:\/.*)?$/i, '').replace(/\/$/, '');
    url.search = ''; url.hash = '';
    return url.toString();
  } catch { return ''; }
}

export function parseAvaturePage(html, pageUrl) {
  const totalMatch = text(html).match(/\b\d+\s*[-–]\s*\d+\s+of\s+([\d,]+)\s+results\b/i);
  const total = totalMatch ? readAtsReportedTotal(totalMatch[1].replace(/,/g, '')) : null;
  const jobs = [];
  for (const article of String(html).matchAll(/<article\b[^>]*class=["'][^"']*\barticle--result\b[^"']*["'][^>]*>([\s\S]*?)<\/article>/gi)) {
    const heading = article[1].match(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i)?.[1] || '';
    const anchor = heading.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    let url;
    try { url = new URL(decode(anchor?.[1]), pageUrl); } catch { continue; }
    const id = url.pathname.match(/\/JobDetail\/[^/]+\/(\d+)\/?$/i)?.[1];
    if (!id || url.origin !== new URL(pageUrl).origin || !text(anchor?.[2])) continue;
    const fields = [];
    for (const row of article[1].matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
      const location = text(row[1]).match(/^(?:City|State\/Province|Country):\s*(.+)$/i)?.[1];
      if (location && !fields.includes(location)) fields.push(location);
    }
    jobs.push({ id, title: text(anchor[2]), location: fields.join(', '), url: url.toString() });
  }
  const current = new URL(pageUrl);
  const offset = Number(current.searchParams.get('jobOffset')) || 0;
  let nextUrl = '';
  for (const match of String(html).matchAll(/\bhref=["']([^"']+)["']/gi)) {
    try {
      const url = new URL(decode(match[1]), pageUrl);
      const nextOffset = Number(url.searchParams.get('jobOffset')) || 0;
      if (url.origin === current.origin && /\/SearchJobs\/?$/i.test(url.pathname) && nextOffset > offset
        && (!nextUrl || nextOffset < Number(new URL(nextUrl).searchParams.get('jobOffset')))) nextUrl = url.toString();
    } catch { /* Ignore non-URL links. */ }
  }
  return { jobs, total, nextUrl };
}

export async function readAvatureBoard(value, { getText, timeBudgetMs = 120000 }) {
  const boardUrl = avatureBoardUrl(value);
  if (!boardUrl) throw new Error('Avature: public board URL missing; existing jobs preserved');
  const deadlineAt = performance.now() + timeBudgetMs;
  const first = parseAvaturePage(await getText(boardUrl, { deadlineAt }), boardUrl);
  if (first.total === null) throw new Error('Avature: results count missing; existing jobs preserved');
  if (!first.nextUrl && first.total > first.jobs.length) return { jobs: first.jobs, reportedTotal: first.total,
    complete: false, pagination: { reasons: ['pagination_not_followed'] } };
  const template = first.nextUrl ? new URL(first.nextUrl) : null;
  const pageSize = Number(template?.searchParams.get('jobRecordsPerPage')) || first.jobs.length || 5;
  let initial = true;
  return fetchPaginatedAtsJobs({ providerName: 'Avature', pageSize, maxPages: 250, concurrency: 2,
    timeBudgetMs: Math.max(1, Math.floor(deadlineAt - performance.now())), recheckFirstPage: true,
    jobKey: job => job.id,
    readPage: async (offset, budget) => {
      if (offset === 0 && initial) { initial = false; return first; }
      const url = offset && template ? new URL(template) : new URL(boardUrl);
      if (offset) url.searchParams.set('jobOffset', offset);
      return parseAvaturePage(await getText(url.toString(), budget), url.toString());
    },
  });
}

export function isJibeCareerPage(html) { return /(?:app|assets)\.jibecdn\.com\//i.test(html); }

export function jibeJobsUrl(careerUrl, page = 1) {
  const url = new URL('/api/jobs', careerUrl);
  url.search = new URLSearchParams({ page: String(page), limit: '10', internal: 'false' }).toString();
  return url.toString();
}

export function parseJibePage(payload, careerUrl) {
  if (!Array.isArray(payload?.jobs)) throw new Error('iCIMS Jibe: invalid results page; existing jobs preserved');
  const total = readAtsReportedTotal(payload.totalCount);
  if (total === null) throw new Error('iCIMS Jibe: results count missing; existing jobs preserved');
  const base = new URL(careerUrl);
  const prefix = base.pathname.replace(/\/jobs(?:\/.*)?\/?$/i, '').replace(/\/$/, '');
  return { total, jobs: payload.jobs.map(row => {
    const data = row?.data;
    if (!data?.title || !/^[\w-]+$/.test(String(data.slug || ''))) return { id: '', title: '' };
    const url = new URL(`${prefix}/jobs/${data.slug}`, base.origin);
    if (data.language) url.searchParams.set('lang', data.language);
    return { id: String(data.slug), title: data.title, url: url.toString(),
      location: typeof data.full_location === 'string' ? data.full_location : [data.city, data.state, data.country].filter(Boolean).join(', '),
      postedAt: data.posted_date || '', employmentType: data.employment_type || '', department: data.department || '' };
  }) };
}

export async function readJibeBoard(careerUrl, { getJson, timeBudgetMs = 120000 }) {
  return fetchPaginatedAtsJobs({ providerName: 'iCIMS Jibe', pageSize: 10, maxPages: 250, concurrency: 2,
    timeBudgetMs, recheckFirstPage: true, jobKey: job => job.id,
    readPage: async (offset, budget) => parseJibePage(await getJson(jibeJobsUrl(careerUrl, offset / 10 + 1), budget), careerUrl),
  });
}
