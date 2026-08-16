import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SAAS_DIR = join(SCRIPT_DIR, '..');

export const SOURCE_COMMIT = '6f667a20d3e488d9a37a127ae5be90e77e35eec9';
export const SOURCE_SHA256 = 'c6036836e93a9c946fd5ef67bf40d576c57411822ad43de02d8a4e2c4b279a3d';
export const SOURCE_REFRESHED_AT = '2026-07-28';
export const ANALYSIS_GENERATED_AT = '2026-08-16T16:00:00Z';
export const SOURCE_DATASET_PATH = join(SAAS_DIR, 'data', 'state-of-ats-2026-companies.csv');
export const SOURCE_SQL_PATH = join(SAAS_DIR, 'reports', 'staffing-ats-benchmark.sql');
export const ARTIFACT_PATH = join(SAAS_DIR, 'reports', 'staffing-ats-benchmark.artifact.json');
export const PROVIDER_CSV_PATH = join(SAAS_DIR, 'public', 'bd-engine-ats-coverage-benchmark.csv');
export const REPORT_HTML_PATH = join(SAAS_DIR, 'public', 'staffing-ats-benchmark.html');

const ACCESSIBLE_REPORT_THEME = `<style data-bd-engine-accessible-theme="true">
:root{--portable-tertiary:#5d5d5d;--portable-accent:#005ea8}
@media(prefers-color-scheme:dark){:root{--portable-tertiary:#afafaf;--portable-accent:#66b5ff}}
@media print{:root{--portable-tertiary:#5d5d5d;--portable-accent:#005ea8}}
</style>`;

export const IMPORT_READY_PROVIDERS = new Set([
  'Ashby',
  'BambooHR',
  'Greenhouse',
  'Jobvite',
  'Lever',
  'Personio',
  'Recruitee',
  'Rippling',
  'SmartRecruiters',
  'Workable',
  'Workday',
]);

export const TRACKING_ONLY_PROVIDERS = new Set([
  'ADP',
  'iCIMS',
  'Phenom People',
  'SuccessFactors',
  'Taleo',
]);

function splitCsvLine(line) {
  const cells = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      cells.push(value);
      value = '';
    } else {
      value += character;
    }
  }
  cells.push(value);
  return cells;
}

export function parseDataset(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.startsWith('#'));
  if (!lines.length) throw new Error('ATS benchmark source dataset is empty.');
  const headers = splitCsvLine(lines.shift()).map((value) => value.trim());
  const required = ['name', 'slug', 'industry', 'ats_system', 'hiring_volume_tier', 'top_roles', 'source_url', 'verified'];
  if (headers.join('|') !== required.join('|')) {
    throw new Error(`Unexpected ATS benchmark schema: ${headers.join(', ')}`);
  }
  return lines.map((line, rowIndex) => {
    const cells = splitCsvLine(line);
    if (cells.length !== headers.length) throw new Error(`Malformed ATS benchmark row ${rowIndex + 2}.`);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index].trim()]));
  });
}

export function handlingTier(provider) {
  if (IMPORT_READY_PROVIDERS.has(provider)) return 'Automatic import';
  if (TRACKING_ONLY_PROVIDERS.has(provider)) return 'Tracking only';
  return 'Discovery or manual review';
}

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function sortCounts(counts, labelKey) {
  return [...counts.entries()]
    .map(([label, employerCount]) => ({ [labelKey]: label, employerCount }))
    .sort((left, right) => right.employerCount - left.employerCount || String(left[labelKey]).localeCompare(String(right[labelKey])));
}

function assertDatasetQuality(rows, sourceText) {
  if (rows.length !== 738) throw new Error(`Expected 738 source rows, received ${rows.length}.`);
  const verifiedCount = rows.filter((row) => row.verified === 'true').length;
  if (verifiedCount !== 704) throw new Error(`Expected 704 verified rows, received ${verifiedCount}.`);
  const hashes = new Set();
  const allowedTiers = new Set(['mega', 'high', 'mid']);
  for (const [index, row] of rows.entries()) {
    for (const field of ['name', 'slug', 'industry', 'ats_system', 'source_url', 'verified']) {
      if (!row[field]) throw new Error(`Missing ${field} in source row ${index + 2}.`);
    }
    const key = row.slug.toLowerCase();
    if (hashes.has(key)) throw new Error(`Duplicate employer slug: ${row.slug}`);
    hashes.add(key);
    if (!['true', 'false'].includes(row.verified)) throw new Error(`Invalid verified flag for ${row.name}.`);
    if (!allowedTiers.has(row.hiring_volume_tier)) throw new Error(`Invalid hiring volume tier for ${row.name}.`);
    const sourceUrl = new URL(row.source_url);
    if (sourceUrl.protocol !== 'https:') throw new Error(`Non-HTTPS source URL for ${row.name}.`);
  }
  const digest = createHash('sha256').update(sourceText).digest('hex');
  if (digest !== SOURCE_SHA256) throw new Error(`Source dataset checksum changed: ${digest}.`);
}

export function buildBenchmarkAnalysis(rows, sourceText = '') {
  if (sourceText) assertDatasetQuality(rows, sourceText);
  const verified = rows.filter((row) => row.verified === 'true');
  const providerCounts = new Map();
  const industryCounts = new Map();

  for (const row of verified) {
    providerCounts.set(row.ats_system, (providerCounts.get(row.ats_system) || 0) + 1);
    const industry = industryCounts.get(row.industry) || {
      industry: row.industry,
      employerCount: 0,
      importReadyCount: 0,
      trackingOnlyCount: 0,
      reviewCount: 0,
    };
    industry.employerCount += 1;
    const tier = handlingTier(row.ats_system);
    if (tier === 'Automatic import') industry.importReadyCount += 1;
    else if (tier === 'Tracking only') industry.trackingOnlyCount += 1;
    else industry.reviewCount += 1;
    industryCounts.set(row.industry, industry);
  }

  const providers = sortCounts(providerCounts, 'provider').map((row) => ({
    ...row,
    share: row.employerCount / verified.length,
    sharePercent: round((row.employerCount / verified.length) * 100),
    handlingTier: handlingTier(row.provider),
  }));

  const importReadyCount = providers
    .filter((row) => row.handlingTier === 'Automatic import')
    .reduce((total, row) => total + row.employerCount, 0);
  const trackingOnlyCount = providers
    .filter((row) => row.handlingTier === 'Tracking only')
    .reduce((total, row) => total + row.employerCount, 0);
  const reviewCount = verified.length - importReadyCount - trackingOnlyCount;

  const handlingTiers = [
    { tier: 'Automatic import', employerCount: importReadyCount, share: importReadyCount / verified.length },
    { tier: 'Tracking only', employerCount: trackingOnlyCount, share: trackingOnlyCount / verified.length },
    { tier: 'Discovery or manual review', employerCount: reviewCount, share: reviewCount / verified.length },
  ];

  const industries = [...industryCounts.values()]
    .map((row) => ({
      ...row,
      importReadyShare: row.importReadyCount / row.employerCount,
      trackingOnlyShare: row.trackingOnlyCount / row.employerCount,
      reviewShare: row.reviewCount / row.employerCount,
    }))
    .sort((left, right) => right.employerCount - left.employerCount || left.industry.localeCompare(right.industry));

  return {
    totalRows: rows.length,
    verifiedCount: verified.length,
    excludedUnverifiedCount: rows.length - verified.length,
    distinctProviderCount: providers.length,
    distinctIndustryCount: industries.length,
    importReadyCount,
    trackingOnlyCount,
    reviewCount,
    importReadyShare: importReadyCount / verified.length,
    trackingOnlyShare: trackingOnlyCount / verified.length,
    reviewShare: reviewCount / verified.length,
    identifiedOrTrackedShare: (importReadyCount + trackingOnlyCount) / verified.length,
    providers,
    handlingTiers,
    industries,
  };
}

const SOURCE_ID = 'resumeai_state_of_ats_2026';
const SOURCE_URL = `https://github.com/Kayvan-Zahiri/state-of-ats-2026/blob/${SOURCE_COMMIT}/data/companies.csv`;

function metricCard(id, description, field, label, format = 'number') {
  return {
    id,
    description,
    dataset: 'summary',
    sourceId: SOURCE_ID,
    metrics: [{ label, field, format }],
  };
}

export function buildReportArtifact(analysis) {
  const topProviders = analysis.providers.slice(0, 12);
  const largestIndustries = analysis.industries.slice(0, 12);
  const manifestSource = {
    id: SOURCE_ID,
    label: 'ResumeAI — State of ATS 2026 dataset',
    path: 'saas/reports/staffing-ats-benchmark.sql',
    href: SOURCE_URL,
  };
  const source = {
    ...manifestSource,
    query: {
      engine: 'duckdb',
      language: 'sql',
      id: 'bd-engine-public-ats-coverage-2026',
      url: SOURCE_URL,
      executed_at: ANALYSIS_GENERATED_AT,
      description: 'Filters the pinned State of ATS 2026 CSV to verified employers, maps each provider to a BD Engine handling tier, and aggregates the summary, provider, and industry views.',
      sql: readFileSync(SOURCE_SQL_PATH, 'utf8'),
      tables_used: ['saas/data/state-of-ats-2026-companies.csv'],
      filters: {
        verified: 'true',
        source_commit: SOURCE_COMMIT,
      },
      metric_definitions: {
        automatic_import_share: 'Verified employers assigned to an automatic-import provider divided by all 704 verified employers.',
        tracking_only_share: 'Verified employers assigned to a tracking-only provider divided by all 704 verified employers.',
        discovery_review_share: 'Verified employers assigned to all remaining providers divided by all 704 verified employers.',
      },
    },
  };

  return {
    surface: 'report',
    manifest: {
      version: 1,
      surface: 'report',
      title: 'BD Engine public ATS coverage benchmark',
      description: 'What a verified large-employer ATS sample implies for staffing business development coverage.',
      generatedAt: ANALYSIS_GENERATED_AT,
      cards: [
        metricCard('verified_employers', 'Employers whose ATS was marked verified against a live careers-portal apply host.', 'verifiedEmployerCount', 'Verified employers'),
        metricCard('automatic_import_share', 'Share assigned to providers with an automatic public-role import adapter in BD Engine.', 'importReadyShare', 'Automatic import share', 'percent'),
        metricCard('tracking_only_share', 'Share assigned to providers BD Engine identifies for workflow tracking but does not automatically import.', 'trackingOnlyShare', 'Tracking-only share', 'percent'),
        metricCard('review_share', 'Share assigned to providers that still require discovery, another source, or manual review.', 'reviewShare', 'Discovery/review share', 'percent'),
      ],
      charts: [
        {
          id: 'handling_tiers',
          title: 'Employers by BD Engine handling tier',
          subtitle: 'Verified large-employer cohort; 704 employers; provider assignments refreshed July 28, 2026.',
          type: 'bar',
          dataset: 'handlingTiers',
          sourceId: SOURCE_ID,
          valueFormat: 'number',
          encodings: {
            x: { field: 'tier', type: 'nominal', label: 'Handling tier' },
            y: { field: 'employerCount', type: 'quantitative', label: 'Employers' },
            tooltip: [{ field: 'share', type: 'quantitative', label: 'Share', format: 'percent' }],
          },
          settings: { orientation: 'horizontal', sort: 'descending', showValues: true },
          palette: { kind: 'single-root', name: 'blue' },
          surface: { viewMode: 'both' },
        },
        {
          id: 'provider_distribution',
          title: 'Largest ATS providers in the verified sample',
          subtitle: 'Top 12 of 36 observed systems; employer count is the comparison measure.',
          type: 'bar',
          dataset: 'topProviders',
          sourceId: SOURCE_ID,
          valueFormat: 'number',
          encodings: {
            x: { field: 'provider', type: 'nominal', label: 'ATS provider' },
            y: { field: 'employerCount', type: 'quantitative', label: 'Employers' },
            tooltip: [
              { field: 'share', type: 'quantitative', label: 'Verified-sample share', format: 'percent' },
              { field: 'handlingTier', type: 'nominal', label: 'BD Engine handling' },
            ],
          },
          settings: { orientation: 'horizontal', sort: 'descending', showValues: true },
          palette: { kind: 'single-root', name: 'gold' },
          surface: { viewMode: 'both' },
        },
        {
          id: 'industry_coverage',
          title: 'Automatic-import share across the largest industries',
          subtitle: 'The 12 industries with the most verified employers; rates use each industry as its own denominator.',
          type: 'bar',
          dataset: 'largestIndustries',
          sourceId: SOURCE_ID,
          valueFormat: 'percent',
          encodings: {
            x: { field: 'industry', type: 'nominal', label: 'Industry' },
            y: { field: 'importReadyShare', type: 'quantitative', label: 'Automatic-import share' },
            tooltip: [
              { field: 'employerCount', type: 'quantitative', label: 'Verified employers', format: 'number' },
              { field: 'importReadyCount', type: 'quantitative', label: 'Automatic import', format: 'number' },
              { field: 'trackingOnlyCount', type: 'quantitative', label: 'Tracking only', format: 'number' },
              { field: 'reviewCount', type: 'quantitative', label: 'Discovery/review', format: 'number' },
            ],
          },
          settings: { orientation: 'horizontal', sort: 'descending', showValues: true },
          palette: { kind: 'single-root', name: 'orange' },
          surface: { viewMode: 'both' },
        },
      ],
      tables: [
        {
          id: 'provider_detail',
          title: 'Provider-by-provider coverage detail',
          subtitle: 'All 36 systems observed among the 704 verified employers.',
          dataset: 'providers',
          sourceId: SOURCE_ID,
          defaultSort: { field: 'employerCount', direction: 'desc' },
          columns: [
            { field: 'provider', label: 'ATS provider', type: 'text' },
            { field: 'employerCount', label: 'Employers', type: 'number' },
            { field: 'share', label: 'Share', format: 'percent' },
            { field: 'handlingTier', label: 'BD Engine handling', type: 'text' },
          ],
        },
      ],
      sources: [manifestSource],
      blocks: [
        { id: 'title', type: 'markdown', body: '# BD Engine public ATS coverage benchmark' },
        {
          id: 'executive_summary',
          type: 'markdown',
          sourceId: SOURCE_ID,
          body: `## Executive Summary\n\n- **Automatic import covers 57.0% of this verified large-employer sample.** BD Engine has public-role import adapters for providers assigned to ${analysis.importReadyCount} of ${analysis.verifiedCount} employers.\n- **A further 18.5% can be identified and tracked without being treated as automatically importable.** That puts visible import-or-tracking coverage at 75.4%, while ${analysis.reviewCount} employers still require discovery, another source, or manual review.\n- **The market is fragmented enough that one headline coverage promise is misleading.** The verified sample contains ${analysis.distinctProviderCount} ATS systems, and industry mix materially changes the import-ready rate.\n- **For staffing teams, the operating decision is target-list specific.** Audit the actual companies on the desk, keep unresolved sources visible, and rank outreach only after role relevance and relationship context are added.`,
        },
        { id: 'metrics', type: 'metric-strip', cardIds: ['verified_employers', 'automatic_import_share', 'tracking_only_share', 'review_share'] },
        {
          id: 'handling_heading',
          type: 'markdown',
          sourceId: SOURCE_ID,
          body: '## Most large employers are importable or identifiable—but not interchangeable\n\nThe useful distinction is not “covered” versus “not covered.” It is whether BD Engine can automatically normalize public roles, identify the source for tracking, or must leave the account in a visible discovery/review queue.',
        },
        { id: 'handling_chart', type: 'chart', chartId: 'handling_tiers' },
        {
          id: 'handling_interpretation',
          type: 'markdown',
          sourceId: SOURCE_ID,
          body: `Automatic import applies to ${analysis.importReadyCount} employers. Tracking-only applies to ${analysis.trackingOnlyCount}. The remaining ${analysis.reviewCount} should not disappear from a dashboard or be counted as confirmed role coverage; they need a different source strategy or manual review.`,
        },
        {
          id: 'provider_heading',
          type: 'markdown',
          sourceId: SOURCE_ID,
          body: '## Workday creates breadth; the long tail creates operational risk\n\nWorkday alone accounts for 37.9% of verified employers, while the sample still spans 36 named or proprietary systems. Supporting a few common hosts can create meaningful reach, but it cannot justify a universal market-coverage claim.',
        },
        { id: 'provider_chart', type: 'chart', chartId: 'provider_distribution' },
        {
          id: 'provider_interpretation',
          type: 'markdown',
          sourceId: SOURCE_ID,
          body: 'For business development, fragmentation changes the cost of monitoring a target universe. A desk concentrated in Workday and Greenhouse accounts can automate more of the evidence-gathering step; a desk concentrated in SuccessFactors, Oracle, proprietary portals, or smaller systems needs more review capacity.',
        },
        {
          id: 'industry_heading',
          type: 'markdown',
          sourceId: SOURCE_ID,
          body: '## Target industry changes the expected coverage rate\n\nThe same product capability produces different practical coverage depending on the desk. Among the largest industry cohorts in this dataset, automatic-import share ranges from 10% in Transportation to 66% in Technology.',
        },
        { id: 'industry_chart', type: 'chart', chartId: 'industry_coverage' },
        {
          id: 'industry_interpretation',
          type: 'markdown',
          sourceId: SOURCE_ID,
          body: 'This spread is why BD Engine reports a denominator and keeps unresolved sources visible. A staffing leader should measure coverage against the actual target universe—not borrow a platform-wide average from a different industry mix.',
        },
        {
          id: 'provider_table_heading',
          type: 'markdown',
          body: '## Exact provider detail\n\nUse the table for audit-level counts, or download the derived provider CSV for your own analysis.',
        },
        { id: 'provider_table', type: 'table', tableId: 'provider_detail' },
        {
          id: 'next_steps',
          type: 'markdown',
          body: `## Turn the benchmark into a desk-level decision\n\n1. [Audit 25–50 target career sites](https://bd-engine-production.up.railway.app/ats-checker?utm_source=ats-benchmark&utm_medium=report&utm_campaign=benchmark_to_audit) and keep the valid-URL denominator.\n2. Separate automatic-import hosts, known tracking-only systems, and sources still needing review.\n3. Add role relevance, current hiring evidence, and warm relationship paths before prioritizing outreach.\n4. [Start a 14-day no-card staffing workflow](https://bd-engine-production.up.railway.app/?signup=1&persona=bd&utm_source=ats-benchmark&utm_medium=report&utm_campaign=benchmark_to_trial) only when the audit exposes a real operating problem.\n5. [Download the provider-level CSV](https://bd-engine-production.up.railway.app/bd-engine-ats-coverage-benchmark.csv) for planning or internal discussion.`,
        },
        {
          id: 'further_questions',
          type: 'markdown',
          body: '## Questions this benchmark cannot answer for your desk\n\n- Which employers belong in your defined target universe?\n- Which current openings are relevant to the desk rather than merely available?\n- Which unresolved portals can be replaced by another trustworthy public source?\n- Where does an existing relationship make the hiring signal actionable?\n- Does the workflow produce better client conversations, not just more monitored jobs?',
        },
        {
          id: 'caveats',
          type: 'markdown',
          sourceId: SOURCE_ID,
          body: `## Caveats and assumptions\n\nThis is a BD Engine analysis of the MIT-licensed [ResumeAI State of ATS 2026 dataset](${SOURCE_URL}), not a claim that BD Engine independently re-verified every employer. The calculation uses only the ${analysis.verifiedCount} rows marked verified in the pinned July 28 source snapshot and excludes ${analysis.excludedUnverifiedCount} unconfirmed rows. The source CSV is structurally complete and its header reports 704 verified rows from 738 total, but its repository README contains stale contradictory prose and the published rows link to ResumeAI company pages rather than preserving each raw employer apply URL. Provider assignment is point-in-time and can change. A compatible provider indicates an available ingestion path; it does not guarantee complete, relevant, or fresh jobs for a specific target list. BD Engine handling tiers reflect product capabilities as of August 16, 2026.`,
        },
        {
          id: 'final_cta',
          type: 'markdown',
          body: '## Measure your denominator\n\n[Run the free browser-based ATS coverage audit](https://bd-engine-production.up.railway.app/ats-checker?utm_source=ats-benchmark&utm_medium=report&utm_campaign=benchmark_final_cta). Your URLs stay in the browser; the shared result contains aggregate counts only.',
        },
      ],
    },
    snapshot: {
      version: 1,
      generatedAt: ANALYSIS_GENERATED_AT,
      status: 'ready',
      datasets: {
        summary: [{
          verifiedEmployerCount: analysis.verifiedCount,
          importReadyShare: analysis.importReadyShare,
          trackingOnlyShare: analysis.trackingOnlyShare,
          reviewShare: analysis.reviewShare,
        }],
        handlingTiers: analysis.handlingTiers,
        topProviders,
        largestIndustries,
        providers: analysis.providers,
      },
      accessIssues: [],
    },
    sources: [source],
  };
}

function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function buildProviderCsv(analysis) {
  const rows = [['ATS provider', 'Verified employers', 'Share of verified sample', 'BD Engine handling tier']];
  for (const provider of analysis.providers) {
    rows.push([provider.provider, provider.employerCount, `${provider.sharePercent.toFixed(1)}%`, provider.handlingTier]);
  }
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}

export function applyAccessibleReportTheme(html) {
  const document = String(html || '');
  if (document.includes('data-bd-engine-accessible-theme="true"')) return document;
  if (!document.includes('</head>')) throw new Error('ATS benchmark report is missing its closing head element.');
  return document.replace('</head>', `${ACCESSIBLE_REPORT_THEME}\n</head>`);
}

export function buildStaffingAtsBenchmark() {
  const sourceText = readFileSync(SOURCE_DATASET_PATH, 'utf8');
  const rows = parseDataset(sourceText);
  const analysis = buildBenchmarkAnalysis(rows, sourceText);
  const artifact = buildReportArtifact(analysis);
  writeFileSync(ARTIFACT_PATH, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  writeFileSync(PROVIDER_CSV_PATH, `${buildProviderCsv(analysis)}\r\n`, 'utf8');
  if (existsSync(REPORT_HTML_PATH)) {
    const reportHtml = readFileSync(REPORT_HTML_PATH, 'utf8');
    writeFileSync(REPORT_HTML_PATH, applyAccessibleReportTheme(reportHtml), 'utf8');
  }
  return analysis;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const analysis = buildStaffingAtsBenchmark();
  console.log(`Staffing ATS benchmark: ${analysis.verifiedCount}/${analysis.totalRows} verified rows; ${analysis.importReadyCount} automatic import; ${analysis.trackingOnlyCount} tracking only; ${analysis.reviewCount} discovery/review.`);
}
