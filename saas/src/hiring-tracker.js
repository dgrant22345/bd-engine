// Canadian hiring tracker: open roles in Canada at a fixed set of large
// Canadian employers, read from each employer's own public job site once a
// week. Snapshots are built in a separate process with an isolated in-memory
// workspace (scripts/hiring-tracker-snapshot.mjs), never from customer data,
// and kept one row per week. "New since last week" compares the role keys of
// two snapshots, so it does not depend on posting dates (Workday reposts).
import { createHash } from 'node:crypto';

const DAY = 86_400_000;

// Employers whose public job sites BD Engine reads completely. Each board was
// checked by hand (November 2026); boards that returned no roles are left out.
export const TRACKER_EMPLOYERS = Object.freeze([
  { name: 'RBC', sector: 'Banking and insurance', atsType: 'phenom', boardId: 'jobs.rbc.com/ca/en', resolvedBoardUrl: 'https://jobs.rbc.com/ca/en/search-results', site: 'https://jobs.rbc.com/ca/en' },
  { name: 'TD Bank', sector: 'Banking and insurance', atsType: 'workday', boardId: 'td/TD_Bank_Careers', apiUrl: 'https://td.wd3.myworkdayjobs.com/wday/cxs/td/TD_Bank_Careers/jobs', resolvedBoardUrl: 'https://td.wd3.myworkdayjobs.com/en-US/TD_Bank_Careers', site: 'https://td.wd3.myworkdayjobs.com/en-US/TD_Bank_Careers' },
  { name: 'BMO', sector: 'Banking and insurance', atsType: 'phenom', boardId: 'jobs.bmo.com/ca/en', resolvedBoardUrl: 'https://jobs.bmo.com/ca/en/search-results', site: 'https://jobs.bmo.com/ca/en' },
  { name: 'CIBC', sector: 'Banking and insurance', atsType: 'workday', boardId: 'cibc/search', apiUrl: 'https://cibc.wd3.myworkdayjobs.com/wday/cxs/cibc/search/jobs', resolvedBoardUrl: 'https://cibc.wd3.myworkdayjobs.com/search', site: 'https://cibc.wd3.myworkdayjobs.com/search' },
  { name: 'Desjardins', sector: 'Banking and insurance', atsType: 'workday', boardId: 'desjardins/Desjardins', apiUrl: 'https://desjardins.wd10.myworkdayjobs.com/wday/cxs/desjardins/Desjardins/jobs', resolvedBoardUrl: 'https://desjardins.wd10.myworkdayjobs.com/en-US/Desjardins', site: 'https://desjardins.wd10.myworkdayjobs.com/en-US/Desjardins' },
  { name: 'Sun Life', sector: 'Banking and insurance', atsType: 'workday', boardId: 'sunlife/Experienced-Jobs', apiUrl: 'https://sunlife.wd3.myworkdayjobs.com/wday/cxs/sunlife/Experienced-Jobs/jobs', resolvedBoardUrl: 'https://sunlife.wd3.myworkdayjobs.com/Experienced-Jobs', site: 'https://sunlife.wd3.myworkdayjobs.com/Experienced-Jobs' },
  { name: 'Bell', sector: 'Telecom', atsType: 'phenom', boardId: 'jobs.bell.ca/ca/en', resolvedBoardUrl: 'https://jobs.bell.ca/ca/en/search-results', site: 'https://jobs.bell.ca/ca/en' },
  { name: 'OpenText', sector: 'Technology', atsType: 'phenom', boardId: 'careers.opentext.com/us/en', resolvedBoardUrl: 'https://careers.opentext.com/us/en/search-results', site: 'https://careers.opentext.com/us/en' },
  { name: 'Cohere', sector: 'Technology', atsType: 'ashby', boardId: 'cohere', resolvedBoardUrl: 'https://jobs.ashbyhq.com/cohere', site: 'https://jobs.ashbyhq.com/cohere' },
  { name: 'Wealthsimple', sector: 'Technology', atsType: 'ashby', boardId: 'wealthsimple', resolvedBoardUrl: 'https://jobs.ashbyhq.com/wealthsimple', site: 'https://jobs.ashbyhq.com/wealthsimple' },
  { name: 'PointClickCare', sector: 'Technology', atsType: 'lever', boardId: 'pointclickcare', resolvedBoardUrl: 'https://jobs.lever.co/pointclickcare', site: 'https://jobs.lever.co/pointclickcare' },
  { name: 'Ada', sector: 'Technology', atsType: 'greenhouse', boardId: 'ada18', resolvedBoardUrl: 'https://job-boards.greenhouse.io/ada18', site: 'https://job-boards.greenhouse.io/ada18' },
  { name: 'Thinkific', sector: 'Technology', atsType: 'ashby', boardId: 'thinkific', resolvedBoardUrl: 'https://jobs.ashbyhq.com/thinkific', site: 'https://jobs.ashbyhq.com/thinkific' },
  { name: 'Canadian Tire', sector: 'Retail and travel', atsType: 'workday', boardId: 'canadiantirecorporation/Enterprise_External_Careers_Site', apiUrl: 'https://canadiantirecorporation.wd3.myworkdayjobs.com/wday/cxs/canadiantirecorporation/Enterprise_External_Careers_Site/jobs', resolvedBoardUrl: 'https://canadiantirecorporation.wd3.myworkdayjobs.com/en-US/Enterprise_External_Careers_Site', site: 'https://canadiantirecorporation.wd3.myworkdayjobs.com/en-US/Enterprise_External_Careers_Site' },
  { name: 'Air Canada', sector: 'Retail and travel', atsType: 'phenom', boardId: 'careers.aircanada.com/ca/en', resolvedBoardUrl: 'https://careers.aircanada.com/ca/en/search-results', site: 'https://careers.aircanada.com/ca/en' },
]);

// The tracker week starts Monday at 6:00 a.m. in Toronto; its key is that
// Monday's date. Before 6:00 on a Monday it is still the previous week.
export function trackerWeek(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short',
  }).formatToParts(now).map((part) => [part.type, part.value]));
  const weekdays = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  let back = weekdays[parts.weekday] ?? 0;
  if (back === 0 && Number(parts.hour) < 6) back = 7;
  const local = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
  return new Date(local - back * DAY).toISOString().slice(0, 10);
}

export function roleKey(configKey, jobId) {
  return createHash('sha256').update(`${configKey}|${jobId}`).digest('hex').slice(0, 12);
}

// The page's figures: this week's snapshot against last week's, employer by
// employer. An employer whose site could not be read this week has no figures.
export function compareSnapshots(current, previous = null) {
  const before = new Map((previous?.employers || []).map((item) => [item.name, item]));
  const employers = (current?.employers || []).map((item) => {
    const prior = before.get(item.name);
    const readable = item.status === 'complete' && Number.isFinite(item.openRoles);
    const comparable = readable && prior?.status === 'complete' && Array.isArray(prior.keys);
    const priorKeys = comparable ? new Set(prior.keys) : null;
    return {
      name: item.name,
      sector: item.sector,
      site: item.site,
      readable,
      openRoles: readable ? item.openRoles : null,
      change: comparable ? item.openRoles - prior.openRoles : null,
      newRoles: comparable ? item.keys.filter((key) => !priorKeys.has(key)).length : null,
    };
  }).sort((a, b) => (b.openRoles ?? -1) - (a.openRoles ?? -1) || a.name.localeCompare(b.name));
  const readable = employers.filter((item) => item.readable);
  const compared = readable.filter((item) => item.change !== null);
  const sectors = [...new Set(employers.map((item) => item.sector))].map((sector) => {
    const members = readable.filter((item) => item.sector === sector);
    return { sector, employers: members.length, openRoles: members.reduce((sum, item) => sum + item.openRoles, 0) };
  }).sort((a, b) => b.openRoles - a.openRoles);
  return {
    week: current?.week || '',
    takenAt: current?.takenAt || '',
    previousWeek: previous?.week || '',
    employers,
    sectors,
    totals: {
      employers: employers.length,
      readable: readable.length,
      openRoles: readable.reduce((sum, item) => sum + item.openRoles, 0),
      compared: compared.length,
      newRoles: compared.length ? compared.reduce((sum, item) => sum + item.newRoles, 0) : null,
      growing: compared.length ? compared.filter((item) => item.change > 0).length : null,
    },
  };
}

// One row per week in PostgreSQL; in memory without a database. A run claims
// its week first so two servers do not build the same snapshot.
export function createHiringTrackerStore({ query, enabled = () => false, now = () => new Date() } = {}) {
  const memory = new Map();
  const STALE_RUN_MS = 30 * 60 * 1000;
  return {
    async latest(limit = 2) {
      if (!enabled()) {
        return [...memory.values()].filter((row) => row.status === 'complete').sort((a, b) => b.week.localeCompare(a.week)).slice(0, limit);
      }
      const result = await query("SELECT body FROM hiring_tracker_snapshots WHERE body->>'status'='complete' ORDER BY week DESC LIMIT $1", [limit]);
      return result.rows.map((row) => row.body);
    },
    async claim(week) {
      const takenAt = now().toISOString();
      if (!enabled()) {
        const row = memory.get(week);
        if (row && (row.status === 'complete' || Date.parse(takenAt) - Date.parse(row.takenAt) < STALE_RUN_MS)) return false;
        memory.set(week, { week, status: 'running', takenAt });
        return true;
      }
      const staleBefore = new Date(Date.parse(takenAt) - STALE_RUN_MS).toISOString();
      const body = JSON.stringify({ week, status: 'running', takenAt });
      const result = await query(`INSERT INTO hiring_tracker_snapshots (week, taken_at, body) VALUES ($1, $2, $3::jsonb)
        ON CONFLICT (week) DO UPDATE SET taken_at=EXCLUDED.taken_at, body=EXCLUDED.body
        WHERE hiring_tracker_snapshots.body->>'status'<>'complete' AND hiring_tracker_snapshots.taken_at<$4
        RETURNING week`, [week, takenAt, body, staleBefore]);
      return result.rows.length > 0;
    },
    async save(snapshot) {
      const body = { ...snapshot, status: 'complete' };
      if (!enabled()) { memory.set(snapshot.week, body); return body; }
      await query(`INSERT INTO hiring_tracker_snapshots (week, taken_at, body) VALUES ($1, $2, $3::jsonb)
        ON CONFLICT (week) DO UPDATE SET taken_at=EXCLUDED.taken_at, body=EXCLUDED.body`, [snapshot.week, snapshot.takenAt, JSON.stringify(body)]);
      return body;
    },
    // A failed run gives the week back so a later scan can retry it.
    async release(week) {
      if (!enabled()) { if (memory.get(week)?.status === 'running') memory.delete(week); return; }
      await query("DELETE FROM hiring_tracker_snapshots WHERE week=$1 AND body->>'status'='running'", [week]);
    },
  };
}

// ── The public page ─────────────────────────────────────────────────────────

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const number = (value) => Number(value).toLocaleString('en-CA');
const signed = (value) => (value > 0 ? `+${number(value)}` : value < 0 ? `−${number(Math.abs(value))}` : 'No change');
const longDate = (value) => new Date(`${value}T12:00:00Z`).toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const takenTime = (value) => new Date(value).toLocaleString('en-CA', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto', timeZoneName: 'short' });

export function renderHiringTrackerPage(view, { origin = '' } = {}) {
  const canonical = `${origin}/canada-hiring`;
  const employerCount = TRACKER_EMPLOYERS.length;
  const title = 'Canadian Hiring Tracker | Open Roles at Large Canadian Employers, Weekly';
  const description = `Open roles in Canada at ${employerCount} large Canadian employers, read every Monday from each employer's own job site, with the change since the week before.`;
  const totals = view?.totals;
  const hasData = Boolean(view?.week && totals?.readable);
  const cta = '/?utm_source=hiring_tracker&utm_medium=referral&utm_campaign=canada_hiring';
  const rows = hasData ? view.employers.map((item) => `
          <tr>
            <th scope="row">${escapeHtml(item.name)}</th>
            <td>${escapeHtml(item.sector)}</td>
            <td class="num">${item.readable ? number(item.openRoles) : '<span class="muted">Not read this week</span>'}</td>
            <td class="num${item.change > 0 ? ' up' : item.change < 0 ? ' down' : ''}">${item.change === null ? '<span class="muted">—</span>' : signed(item.change)}</td>
            <td class="num">${item.newRoles === null ? '<span class="muted">—</span>' : number(item.newRoles)}</td>
            <td><a href="${escapeHtml(item.site)}" rel="noopener" target="_blank">Job site<span class="visually-hidden"> for ${escapeHtml(item.name)} (opens in a new tab)</span></a></td>
          </tr>`).join('') : '';
  const sectorRows = hasData ? view.sectors.map((item) => `<tr><th scope="row">${escapeHtml(item.sector)}</th><td class="num">${number(item.employers)}</td><td class="num">${number(item.openRoles)}</td></tr>`).join('') : '';
  const stats = hasData ? `
      <dl class="tracker-stats">
        <div><dt>Open roles in Canada</dt><dd>${number(totals.openRoles)}</dd><dd class="tracker-stats__note">at ${number(totals.readable)} employer${totals.readable === 1 ? '' : 's'}</dd></div>
        <div><dt>New since last week</dt><dd>${totals.newRoles === null ? '—' : number(totals.newRoles)}</dd><dd class="tracker-stats__note">${totals.newRoles === null ? 'Shown from the second weekly snapshot' : `roles not listed on ${escapeHtml(longDate(view.previousWeek))}`}</dd></div>
        <div><dt>Employers with more openings</dt><dd>${totals.growing === null ? '—' : number(totals.growing)}</dd><dd class="tracker-stats__note">${totals.growing === null ? 'Shown from the second weekly snapshot' : `of ${number(totals.compared)} compared with last week`}</dd></div>
      </dl>` : '';
  const body = hasData ? `
      ${stats}
      <section class="tracker-section" aria-labelledby="employers-title">
        <h2 id="employers-title">Employers this week</h2>
        <div class="tracker-table-wrap" role="region" aria-labelledby="employers-title" tabindex="0">
          <table class="tracker-table">
            <caption class="visually-hidden">Open roles in Canada by employer, week of ${escapeHtml(longDate(view.week))}</caption>
            <thead><tr><th scope="col">Employer</th><th scope="col">Sector</th><th scope="col" class="num">Open roles in Canada</th><th scope="col" class="num">Change since last week</th><th scope="col" class="num">New since last week</th><th scope="col">Source</th></tr></thead>
            <tbody>${rows}
            </tbody>
          </table>
        </div>
      </section>
      <section class="tracker-section" aria-labelledby="sectors-title">
        <h2 id="sectors-title">By sector</h2>
        <div class="tracker-table-wrap" role="region" aria-labelledby="sectors-title" tabindex="0">
          <table class="tracker-table tracker-table--compact">
            <thead><tr><th scope="col">Sector</th><th scope="col" class="num">Employers</th><th scope="col" class="num">Open roles in Canada</th></tr></thead>
            <tbody>${sectorRows}</tbody>
          </table>
        </div>
      </section>` : `
      <p class="tracker-pending" role="status">The first weekly snapshot is being prepared. Check back on Monday morning.</p>`;
  const updated = hasData ? `Week of ${escapeHtml(longDate(view.week))}. Read ${escapeHtml(takenTime(view.takenAt))}.` : 'Updated every Monday morning.';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="robots" content="index, follow, max-image-preview:large">
  <link rel="canonical" href="${escapeHtml(canonical)}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="BD Engine Cloud">
  <meta property="og:title" content="Canadian Hiring Tracker: open roles at ${employerCount} large employers, weekly">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${escapeHtml(canonical)}">
  <meta property="og:image" content="${escapeHtml(origin)}/media/campaign/today-social.png">
  <meta property="og:image:alt" content="BD Engine sample workspace">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="theme-color" content="#f3f6fa">
  <title>${escapeHtml(title)}</title>
  <link rel="icon" href="/favicon.ico" sizes="48x48">
  <link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <link rel="preload" href="/fonts/inter-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/guides.css">
  <link rel="stylesheet" href="/brand.css">
  <link rel="stylesheet" href="/hiring-tracker.css">
  <script type="module" src="/campaign-links.js"></script>
</head>
<body class="public-premium">
  <a class="skip-link" href="#tracker-main">Skip to the tracker</a>
  <header class="site-header">
    <a class="brand" href="/" aria-label="BD Engine home" data-campaign-link>
      <img src="/brand-mark.svg" alt="" width="34" height="34">
      <span>BD Engine</span>
    </a>
    <nav class="site-nav" aria-label="Primary navigation">
      <a href="/guides" data-campaign-link>Guides</a>
      <a href="/ats-checker" data-campaign-link>ATS audit</a>
      <a class="header-cta" href="${cta}" data-campaign-link>Explore BD Engine</a>
    </nav>
  </header>
  <main id="tracker-main" class="tracker">
    <section class="guide-hero" aria-labelledby="tracker-title">
      <p class="eyebrow">Canadian hiring tracker</p>
      <h1 id="tracker-title">Who is hiring in Canada this week</h1>
      <p class="lede">Open roles in Canada at ${employerCount} large Canadian employers, read from each employer's own job site every Monday morning, with the change since the week before.</p>
      <p class="tracker-updated">${updated}</p>
    </section>
    ${body}
    <section class="tracker-section tracker-method" aria-labelledby="method-title">
      <h2 id="method-title">How this is counted</h2>
      <ul>
        <li><strong>Source.</strong> Each employer's own public job site, read by BD Engine every Monday from 6 a.m. Eastern. No job boards, aggregators or customer data are used.</li>
        <li><strong>Open roles in Canada.</strong> Roles listed that morning with a location in Canada, including remote roles that name no other country. A role listed in several cities counts once.</li>
        <li><strong>New since last week.</strong> Roles listed this week that were not listed the week before. A reposted role with the same posting number is not counted again.</li>
        <li><strong>Change since last week.</strong> This week's open roles minus last week's. Openings that close and new openings can offset each other.</li>
        <li><strong>Coverage.</strong> ${employerCount} employers whose job sites can be read in full. They are not a sample of the Canadian labour market. An employer whose site cannot be read in full on a given Monday is shown without figures that week.</li>
      </ul>
    </section>
    <section class="guide-cta" aria-labelledby="tracker-cta">
      <h2 id="tracker-cta">Track the companies you work with</h2>
      <p>BD Engine reads the job sites of the companies you choose, ranks the people you already know there, and shows who to call today.</p>
      <a class="button-link" href="${cta}" data-campaign-link>Explore BD Engine</a>
    </section>
  </main>
  <footer class="site-footer">
    <span>BD Engine Cloud</span>
    <nav class="footer-links" aria-label="Footer navigation">
      <a href="/" data-campaign-link>Staffing workflow</a>
      <a href="/guides" data-campaign-link>Guides</a>
      <a href="/ats-checker" data-campaign-link>Free ATS audit</a>
    </nav>
  </footer>
</body>
</html>`;
}
