const SHEET_NAMES = {
  CONNECTIONS: 'Connections',
  TARGETS: 'Target_Accounts',
  CONFIG: 'Job_Boards_Config',
  REVIEW_QUEUE: 'Config_Review_Queue',
  IMPORT: 'Hiring_Import',
  LOG: 'Automation_Log',
  SETUP: 'Setup',
};

const CONFIG_HEADERS = [
  'Company',
  'ATS_Type',
  'Board_ID',
  'Domain',
  'Careers_URL',
  'Active',
  'Notes',
  'Source',
  '',
  '',
  '',
  'Last_Checked',
  'Discovery_Status',
  'Discovery_Method',
];

const DAILY_HEADERS = [
  'Company',
  'Jobs Posted',
  'Most Recent Posting',
  'Your Contacts',
  'Senior Contacts',
  'Talent Contacts',
  'Target Score',
  'Daily Score',
  'Network Strength',
  'Pipeline Stage',
  'Days Since Contact',
  'Stale?',
  'Careers Page',
];

const TOP_CONTACT_HEADERS = [
  'Full Name',
  'Company',
  'Title',
  'Priority Score',
  'URL',
  'Connected On',
  'Email Address',
];

const REVIEW_QUEUE_HEADERS = [
  'Priority',
  'Company',
  'Connections',
  'Target Score',
  'Discovery Status',
  'ATS Type',
  'Board ID',
  'Domain',
  'Careers URL',
  'Notes',
  'Recommended Action',
];

const CONNECTION_HEADERS = [
  'Clean Company',
  'Buyer Title',
  'Senior Flag',
  'Talent Flag',
  'Tech Flag',
  'Finance Flag',
  'Company Contacts',
  'Years Connected',
  'Priority Score',
];

const CANADA_KEYWORDS = [
  'canada', 'toronto', 'vancouver', 'montreal', 'calgary', 'ottawa',
  'edmonton', 'mississauga', 'markham', 'waterloo', 'kitchener',
  'burnaby', 'winnipeg', 'halifax', 'brampton', 'vaughan',
  'ontario', 'british columbia', 'alberta', 'quebec',
  ', on', ', bc', ', ab', ', qc'
];

const SUPPRESSED_COMPANIES = [
  'self-employed',
  'self employed',
  'freelance',
  'independent consultant',
  'open to work',
  'seeking opportunities',
  'currently seeking new opportunities',
  'retired'
];

const COMPANY_ALIAS_CATALOG = [
  { displayName: 'RBC', aliases: ['rbc', 'royal bank of canada', 'royal bank', 'rbc insurance', 'rbc capital markets', 'royal bank of canada capital markets'] },
  { displayName: 'BMO', aliases: ['bmo', 'bmo financial group', 'bank of montreal', 'bmo capital markets'] },
  { displayName: 'CIBC', aliases: ['cibc', 'canadian imperial bank of commerce', 'cibc capital markets'] },
  { displayName: 'TD', aliases: ['td', 'td bank', 'td bank group', 'toronto dominion bank', 'td securities'] },
  { displayName: 'Scotiabank', aliases: ['scotiabank', 'bank of nova scotia', 'scotia bank', 'scotia capital'] },
  { displayName: 'Rogers Communications', aliases: ['rogers', 'rogers communications', 'rogers communications inc'] },
  { displayName: 'Microsoft', aliases: ['microsoft', 'microsoft corporation', 'microsoft canada'] },
  { displayName: 'Google', aliases: ['google', 'google llc', 'alphabet', 'alphabet inc'] },
  { displayName: 'Amazon', aliases: ['amazon', 'amazon web services', 'aws', 'amazon.com'] },
];

const ATS_HELPER_DEFAULT_LIMIT = 120;

const KNOWN_BOARD_TEMPLATES = {
  shopify: { atsType: 'other', boardId: '', domain: 'shopify.com', careersUrl: 'https://www.shopify.com/careers', active: false, notes: 'Seeded from repaired workbook: careers site appears custom and previous Greenhouse slug returned 404', source: 'repair_seed', discoveryStatus: 'known_unsupported', discoveryMethod: 'repair_seed' },
  stripe: { atsType: 'greenhouse', boardId: 'stripe', domain: 'stripe.com', careersUrl: 'https://stripe.com/jobs', active: true, notes: 'Seeded from repaired workbook', source: 'https://boards-api.greenhouse.io/v1/boards/stripe/jobs?content=true', discoveryStatus: 'verified', discoveryMethod: 'repair_seed' },
  datadog: { atsType: 'greenhouse', boardId: 'datadog', domain: 'datadoghq.com', careersUrl: 'https://careers.datadoghq.com', active: true, notes: 'Seeded from repaired workbook', source: 'https://boards-api.greenhouse.io/v1/boards/datadog/jobs?content=true', discoveryStatus: 'verified', discoveryMethod: 'repair_seed' },
  snowflake: { atsType: 'other', boardId: '', domain: 'careers.snowflake.com', careersUrl: 'https://careers.snowflake.com', active: false, notes: 'Seeded from repaired workbook: careers site appears custom and public Greenhouse board was not confirmed', source: 'repair_seed', discoveryStatus: 'known_unsupported', discoveryMethod: 'repair_seed' },
  coinbase: { atsType: 'greenhouse', boardId: 'coinbase', domain: 'coinbase.com', careersUrl: 'https://www.coinbase.com/careers', active: true, notes: 'Seeded from repaired workbook', source: 'https://boards-api.greenhouse.io/v1/boards/coinbase/jobs?content=true', discoveryStatus: 'verified', discoveryMethod: 'repair_seed' },
  openai: { atsType: 'ashby', boardId: 'openai', domain: 'openai.com', careersUrl: 'https://openai.com/careers', active: true, notes: 'Seeded from repaired workbook', source: 'https://api.ashbyhq.com/posting-api/job-board/openai', discoveryStatus: 'verified', discoveryMethod: 'repair_seed' },
  notion: { atsType: 'ashby', boardId: 'notion', domain: 'notion.so', careersUrl: 'https://www.notion.so/careers', active: true, notes: 'Seeded from repaired workbook', source: 'https://api.ashbyhq.com/posting-api/job-board/notion', discoveryStatus: 'verified', discoveryMethod: 'repair_seed' },
  discord: { atsType: 'greenhouse', boardId: 'discord', domain: 'discord.com', careersUrl: 'https://discord.com/jobs', active: true, notes: 'Seeded from repaired workbook', source: 'https://boards-api.greenhouse.io/v1/boards/discord/jobs?content=true', discoveryStatus: 'verified', discoveryMethod: 'repair_seed' },
  airtable: { atsType: 'greenhouse', boardId: 'airtable', domain: 'airtable.com', careersUrl: 'https://www.airtable.com/careers', active: true, notes: 'Seeded from repaired workbook', source: 'https://boards-api.greenhouse.io/v1/boards/airtable/jobs?content=true', discoveryStatus: 'verified', discoveryMethod: 'repair_seed' },
  scaleai: { atsType: 'greenhouse', boardId: 'scaleai', domain: 'scale.com', careersUrl: 'https://scale.com/careers', active: true, notes: 'Seeded from repaired workbook', source: 'https://boards-api.greenhouse.io/v1/boards/scaleai/jobs?content=true', discoveryStatus: 'verified', discoveryMethod: 'repair_seed' },
  lightspeed: { atsType: 'greenhouse', boardId: 'lightspeedhq', domain: 'careers.lightspeedhq.com', careersUrl: 'https://careers.lightspeedhq.com', active: true, notes: 'Seeded from repaired workbook', source: 'https://boards-api.greenhouse.io/v1/boards/lightspeedhq/jobs?content=true', discoveryStatus: 'verified', discoveryMethod: 'repair_seed' },
  benchling: { atsType: 'other', boardId: '', domain: 'benchling.com', careersUrl: 'https://www.benchling.com/careers', active: false, notes: 'Seeded from repaired workbook: careers page found but no supported ATS board confirmed', source: 'repair_seed', discoveryStatus: 'needs_review', discoveryMethod: 'repair_seed' },
  plaid: { atsType: 'lever', boardId: 'plaid', domain: 'plaid.com', careersUrl: 'https://plaid.com/careers', active: true, notes: 'Seeded from repaired workbook', source: 'https://api.lever.co/v0/postings/plaid?mode=json', discoveryStatus: 'verified', discoveryMethod: 'repair_seed' },
  brex: { atsType: 'greenhouse', boardId: 'brex', domain: 'brex.com', careersUrl: 'https://www.brex.com/careers', active: true, notes: 'Seeded from repaired workbook', source: 'https://boards-api.greenhouse.io/v1/boards/brex/jobs?content=true', discoveryStatus: 'verified', discoveryMethod: 'repair_seed' },
  flexport: { atsType: 'greenhouse', boardId: 'flexport', domain: 'flexport.com', careersUrl: 'https://www.flexport.com/careers', active: true, notes: 'Seeded from repaired workbook', source: 'https://boards-api.greenhouse.io/v1/boards/flexport/jobs?content=true', discoveryStatus: 'verified', discoveryMethod: 'repair_seed' },
  figma: { atsType: 'greenhouse', boardId: 'figma', domain: 'figma.com', careersUrl: 'https://www.figma.com/careers', active: true, notes: 'Seeded from repaired workbook', source: 'https://boards-api.greenhouse.io/v1/boards/figma/jobs?content=true', discoveryStatus: 'verified', discoveryMethod: 'repair_seed' },
  rippling: { atsType: 'other', boardId: '', domain: 'rippling.com', careersUrl: 'https://www.rippling.com/careers', active: false, notes: 'Seeded from repaired workbook: careers page found but a supported ATS board was not confirmed', source: 'repair_seed', discoveryStatus: 'needs_review', discoveryMethod: 'repair_seed' },
  asana: { atsType: 'greenhouse', boardId: 'asana', domain: 'asana.com', careersUrl: 'https://asana.com/jobs', active: true, notes: 'Seeded from repaired workbook', source: 'https://boards-api.greenhouse.io/v1/boards/asana/jobs?content=true', discoveryStatus: 'verified', discoveryMethod: 'repair_seed' },
  databricks: { atsType: 'greenhouse', boardId: 'databricks', domain: 'databricks.com', careersUrl: 'https://www.databricks.com/company/careers', active: true, notes: 'Seeded from repaired workbook', source: 'https://boards-api.greenhouse.io/v1/boards/databricks/jobs?content=true', discoveryStatus: 'verified', discoveryMethod: 'repair_seed' },
  robinhood: { atsType: 'greenhouse', boardId: 'robinhood', domain: 'careers.robinhood.com', careersUrl: 'https://careers.robinhood.com', active: true, notes: 'Seeded from repaired workbook', source: 'https://boards-api.greenhouse.io/v1/boards/robinhood/jobs?content=true', discoveryStatus: 'verified', discoveryMethod: 'repair_seed' },
  samsara: { atsType: 'greenhouse', boardId: 'samsara', domain: 'samsara.com', careersUrl: 'https://www.samsara.com/company/careers', active: true, notes: 'Seeded from repaired workbook', source: 'https://boards-api.greenhouse.io/v1/boards/samsara/jobs?content=true', discoveryStatus: 'verified', discoveryMethod: 'repair_seed' },
  doordash: { atsType: 'greenhouse', boardId: 'doordashusa', domain: 'careersatdoordash.com', careersUrl: 'https://careersatdoordash.com', active: true, notes: 'Seeded from repaired workbook', source: 'https://boards-api.greenhouse.io/v1/boards/doordashusa/jobs?content=true', discoveryStatus: 'verified', discoveryMethod: 'repair_seed' },
  instacart: { atsType: 'greenhouse', boardId: 'instacart', domain: 'instacart.careers', careersUrl: 'https://instacart.careers', active: true, notes: 'Seeded from repaired workbook', source: 'https://boards-api.greenhouse.io/v1/boards/instacart/jobs?content=true', discoveryStatus: 'verified', discoveryMethod: 'repair_seed' },
  canva: { atsType: 'other', boardId: '', domain: 'canva.com', careersUrl: 'https://www.canva.com/careers', active: false, notes: 'Seeded from repaired workbook: supported ATS board was not confirmed from public careers pages', source: 'repair_seed', discoveryStatus: 'needs_review', discoveryMethod: 'repair_seed' },
  atlassian: { atsType: 'other', boardId: '', domain: 'atlassian.com', careersUrl: 'https://www.atlassian.com/company/careers', active: false, notes: 'Seeded from repaired workbook: careers site appears custom', source: 'repair_seed', discoveryStatus: 'known_unsupported', discoveryMethod: 'repair_seed' },
  gusto: { atsType: 'greenhouse', boardId: 'gusto', domain: 'gusto.com', careersUrl: 'https://gusto.com/careers', active: true, notes: 'Seeded from repaired workbook', source: 'https://boards-api.greenhouse.io/v1/boards/gusto/jobs?content=true', discoveryStatus: 'verified', discoveryMethod: 'repair_seed' },
  segment: { atsType: 'other', boardId: '', domain: 'segment.com', careersUrl: 'https://segment.com/careers', active: false, notes: 'Seeded from repaired workbook: standalone supported ATS board was not confirmed', source: 'repair_seed', discoveryStatus: 'needs_review', discoveryMethod: 'repair_seed' },
  twilio: { atsType: 'greenhouse', boardId: 'twilio', domain: 'twilio.com', careersUrl: 'https://www.twilio.com/company/jobs', active: true, notes: 'Seeded from repaired workbook', source: 'https://boards-api.greenhouse.io/v1/boards/twilio/jobs?content=true', discoveryStatus: 'verified', discoveryMethod: 'repair_seed' },
  square: { atsType: 'other', boardId: '', domain: 'block.xyz', careersUrl: 'https://block.xyz/careers', active: false, notes: 'Seeded from repaired workbook: roles appear under Block careers and no standalone supported ATS board was confirmed', source: 'repair_seed', discoveryStatus: 'known_unsupported', discoveryMethod: 'repair_seed' },
  dropbox: { atsType: 'greenhouse', boardId: 'dropbox', domain: 'dropbox.com', careersUrl: 'https://jobs.dropbox.com', active: true, notes: 'Seeded from repaired workbook', source: 'https://boards-api.greenhouse.io/v1/boards/dropbox/jobs?content=true', discoveryStatus: 'verified', discoveryMethod: 'repair_seed' },
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('BD Engine')
    .addItem('Run Full Engine', 'runBdEngine')
    .addItem('Import Connections CSV (Drive)', 'importConnectionsCsvFromDrive')
    .addSeparator()
    .addItem('Repair Formula Tabs', 'repairFormulaTabs')
    .addItem('Sync Job Boards Config', 'syncJobBoardsConfig')
    .addItem('Run ATS Helper', 'runAtsHelper')
    .addItem('Run Job Feed', 'runJobFeed')
    .addToUi();
}

function runBdEngine() {
  repairFormulaTabs_();
  syncJobBoardsConfig();
  runJobFeed();
  repairFormulaTabs_();
  SpreadsheetApp.flush();
  SpreadsheetApp.getActive().toast('BD Engine refresh complete', 'BD Engine', 5);
  logMessage_('BD Engine full refresh completed');
}

function importConnectionsCsvFromDrive() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(SHEET_NAMES.CONNECTIONS);
  if (!sheet) throw new Error('Missing Connections sheet.');

  const file = getLatestConnectionsCsvFile_();
  if (!file) {
    throw new Error('Could not find a Drive file named Connections.csv or connections.csv.');
  }

  const csv = Utilities.parseCsv(file.getBlob().getDataAsString('UTF-8'));
  if (!csv.length) throw new Error('Connections.csv was empty.');

  const expectedHeader = ['First Name', 'Last Name', 'URL', 'Email Address', 'Company', 'Position', 'Connected On'];
  const header = csv[0].slice(0, expectedHeader.length);
  const headerMatches = expectedHeader.every((value, index) => String(header[index] || '').trim() === value);
  const rows = headerMatches ? csv : [expectedHeader].concat(csv);
  const output = rows.map(row => {
    const cells = row.slice(0, expectedHeader.length);
    while (cells.length < expectedHeader.length) cells.push('');
    return cells;
  });

  sheet.getRange('A:G').clearContent();
  sheet.getRange(1, 1, output.length, expectedHeader.length).setValues(output);
  repairFormulaTabs_();
  SpreadsheetApp.flush();
  logMessage_(`Imported ${Math.max(0, output.length - 1)} connections from Drive file ${file.getName()}`);
  SpreadsheetApp.getActive().toast(`Imported ${Math.max(0, output.length - 1)} connections`, 'BD Engine', 5);
}

function repairFormulaTabs() {
  repairFormulaTabs_();
  SpreadsheetApp.flush();
  SpreadsheetApp.getActive().toast('Formula tabs repaired', 'BD Engine', 5);
  logMessage_('Repaired formula-driven tabs');
}

function syncJobBoardsConfig() {
  const ss = SpreadsheetApp.getActive();
  const targetSheet = ss.getSheetByName(SHEET_NAMES.TARGETS);
  const configSheet = ss.getSheetByName(SHEET_NAMES.CONFIG);
  const setupSheet = ss.getSheetByName(SHEET_NAMES.SETUP);
  if (!targetSheet || !configSheet) {
    throw new Error('Missing Target_Accounts or Job_Boards_Config sheet.');
  }

  const minConnections = setupSheet ? Number(setupSheet.getRange('B9').getValue()) || 3 : 3;
  const targetRows = getSheetObjects_(targetSheet);
  const existingRows = getSheetObjects_(configSheet);
  const targetMetricsByKey = buildTargetMetricsMap_(targetRows);
  const existingByKey = new Map();
  const manualRows = [];
  const finalRows = [];

  existingRows.forEach(row => {
    const company = canonicalCompanyName_(row.Company);
    const key = normalizeKey_(company);
    if (!key) return;
    if (!existingByKey.has(key)) existingByKey.set(key, []);
    existingByKey.get(key).push(row);
    if (isManualConfig_(row)) {
      manualRows.push(row);
    }
  });

  const written = [];
  const seen = new Set();
  written.push(CONFIG_HEADERS);

  targetRows.forEach(row => {
    const company = canonicalCompanyName_(row.Company);
    const key = normalizeKey_(company);
    const connectionCount = Number(row.Connections || row['Your Contacts'] || 0);
    if (!key || connectionCount < minConnections || isSuppressedCompany_(company)) return;
    if (seen.has(key)) return;
    seen.add(key);

    const existing = (existingByKey.get(key) || [])[0] || null;
    const generated = buildGeneratedConfig_(company, existing);
    const merged = mergeConfigRow_(existing, generated);
    finalRows.push(merged);
    written.push(configRowToCells_(merged));
  });

  manualRows.forEach(row => {
    const company = canonicalCompanyName_(row.Company);
    const key = normalizeKey_(company);
    if (!key || seen.has(key)) return;
    const normalized = normalizeConfigRow_(row);
    finalRows.push(normalized);
    written.push(configRowToCells_(normalized));
  });

  configSheet.clearContents();
  configSheet.getRange(1, 1, written.length, CONFIG_HEADERS.length).setValues(written);
  writeConfigReviewQueue_(targetMetricsByKey, finalRows);
  applySheetFormatting_();
  SpreadsheetApp.flush();
  logMessage_(`Synced ${Math.max(0, written.length - 1)} Job_Boards_Config rows and rebuilt review queue`);
}

function runJobFeed() {
  const ss = SpreadsheetApp.getActive();
  const configSheet = ss.getSheetByName(SHEET_NAMES.CONFIG);
  const importSheet = ss.getSheetByName(SHEET_NAMES.IMPORT);
  if (!configSheet || !importSheet) {
    throw new Error('Missing Job_Boards_Config or Hiring_Import sheet.');
  }

  const config = getSheetObjects_(configSheet).filter(row => truthy_(row.Active));
  const header = ['Company', 'ATS', 'Job Title', 'Location', 'Department', 'Employment Type', 'Job URL', 'Updated At', 'Source URL'];
  const out = [];
  const seenJobs = new Set();
  const boardSummaries = [];
  const errors = [];

  config.forEach(row => {
    let jobs = [];
    try {
      jobs = fetchJobsForCompany_(row);
    } catch (err) {
      const message = `Job feed failed for ${row.Company || 'Unknown company'} (${row.ATS_Type || 'unknown ATS'}): ${err.message}`;
      errors.push(message);
      logMessage_(message);
      return;
    }

    let kept = 0;
    jobs.forEach(job => {
      if (!isCanadaLocation_(job.location)) return;
      const jobKey = buildJobDedupKey_(row.Company, job);
      if (seenJobs.has(jobKey)) return;
      seenJobs.add(jobKey);
      kept += 1;
      out.push([
        row.Company || '',
        row.ATS_Type || '',
        job.title || '',
        job.location || '',
        job.department || '',
        job.employmentType || '',
        job.url || '',
        job.updatedAt || new Date(),
        job.sourceUrl || row.Careers_URL || row.Source || ''
      ]);
    });

    boardSummaries.push(`${row.Company || 'Unknown'}: ${kept}/${jobs.length}`);
  });

  out.sort((left, right) => {
    const leftDate = left[7] instanceof Date ? left[7].getTime() : new Date(left[7]).getTime();
    const rightDate = right[7] instanceof Date ? right[7].getTime() : new Date(right[7]).getTime();
    return rightDate - leftDate;
  });

  importSheet.clearContents();
  importSheet.getRange(1, 1, 1, header.length).setValues([header]);
  if (out.length) {
    importSheet.getRange(2, 1, out.length, header.length).setValues(out);
    importSheet.getRange(2, 8, out.length, 1).setNumberFormat('yyyy-mm-dd hh:mm:ss');
  }

  repairFormulaTabs_();
  SpreadsheetApp.flush();
  logMessage_(`Imported ${out.length} Hiring_Import rows from ${config.length} active job boards (${errors.length} errors)`);
  if (boardSummaries.length) {
    logMessage_(`Job feed board summary: ${boardSummaries.slice(0, 15).join(' | ')}${boardSummaries.length > 15 ? ' | ...' : ''}`);
  }
  SpreadsheetApp.getActive().toast(`Imported ${out.length} jobs from ${config.length} boards${errors.length ? ` (${errors.length} errors)` : ''}`, 'BD Engine', 7);
}

function fetchJobsForCompany_(row) {
  const ats = String(row.ATS_Type || '').toLowerCase().trim();
  if (ats === 'greenhouse') return fetchGreenhouseJobs_(row);
  if (ats === 'lever') return fetchLeverJobs_(row);
  if (ats === 'ashby') return fetchAshbyJobs_(row);
  if (ats === 'smartrecruiters') return fetchSmartRecruitersJobs_(row);
  return [];
}

function fetchGreenhouseJobs_(row) {
  if (!row.Board_ID) return [];
  const apiUrl = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(row.Board_ID)}/jobs?content=true`;
  const payload = fetchJson_(apiUrl);
  const jobs = payload.jobs || [];
  return jobs.map(job => ({
    title: job.title || '',
    location: job.location && job.location.name ? job.location.name : '',
    department: (job.departments || []).map(d => d.name).join(', '),
    employmentType: getNestedValue_(job, ['metadata.workplace']) || '',
    url: job.absolute_url || '',
    updatedAt: job.updated_at ? new Date(job.updated_at) : new Date(),
    sourceUrl: apiUrl
  }));
}

function fetchLeverJobs_(row) {
  if (!row.Board_ID) return [];
  const apiUrl = `https://api.lever.co/v0/postings/${encodeURIComponent(row.Board_ID)}?mode=json`;
  const jobs = fetchJson_(apiUrl) || [];
  return jobs.map(job => ({
    title: job.text || '',
    location: job.categories && job.categories.location ? job.categories.location : '',
    department: job.categories && job.categories.team ? job.categories.team : '',
    employmentType: job.categories && job.categories.commitment ? job.categories.commitment : '',
    url: job.hostedUrl || job.applyUrl || '',
    updatedAt: job.createdAt ? new Date(Number(job.createdAt)) : new Date(),
    sourceUrl: apiUrl
  }));
}

function fetchAshbyJobs_(row) {
  if (!row.Board_ID) return [];
  const apiUrl = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(row.Board_ID)}`;
  const payload = fetchJson_(apiUrl);
  const jobs = payload.jobs || [];
  return jobs.map(job => ({
    title: job.title || '',
    location: job.location || '',
    department: job.departmentName || job.department || '',
    employmentType: job.employmentType || '',
    url: job.jobUrl || '',
    updatedAt: job.publishedAt ? new Date(job.publishedAt) : new Date(),
    sourceUrl: apiUrl
  }));
}

function fetchSmartRecruitersJobs_(row) {
  if (!row.Board_ID) return [];
  const apiUrl = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(row.Board_ID)}/postings?limit=100`;
  const payload = fetchJson_(apiUrl);
  const jobs = payload.content || [];
  return jobs.map(job => ({
    title: job.name || '',
    location: [getNestedValue_(job, ['location.city']), getNestedValue_(job, ['location.region']), getNestedValue_(job, ['location.country'])].filter(Boolean).join(', '),
    department: getNestedValue_(job, ['department.label']) || '',
    employmentType: getNestedValue_(job, ['typeOfEmployment.label']) || '',
    url: job.ref || job.applyUrl || '',
    updatedAt: job.releasedDate ? new Date(job.releasedDate) : job.createdOn ? new Date(job.createdOn) : new Date(),
    sourceUrl: apiUrl
  }));
}

function buildGeneratedConfig_(companyName, existing) {
  const careersUrl = existing && existing.Careers_URL ? String(existing.Careers_URL) : '';
  let template = getKnownTemplateForCompany_(companyName);
  if (!template && careersUrl) {
    template = inferConfigFromCareersUrl_(careersUrl);
  }
  if (!template) {
    template = {
      atsType: '',
      boardId: '',
      domain: careersUrl ? domainFromUrl_(careersUrl) : '',
      careersUrl: careersUrl,
      active: false,
      notes: 'No ATS inferred automatically yet',
      source: '',
      discoveryStatus: 'unresolved',
      discoveryMethod: 'account_seed'
    };
  }

  return normalizeConfigRow_({
    Company: companyName,
    ATS_Type: template.atsType || '',
    Board_ID: template.boardId || '',
    Domain: template.domain || domainFromUrl_(template.careersUrl || ''),
    Careers_URL: template.careersUrl || careersUrl || '',
    Active: template.active ? 'TRUE' : 'FALSE',
    Notes: template.notes || '',
    Source: template.source || '',
    Last_Checked: formatSheetDate_(new Date()),
    Discovery_Status: template.discoveryStatus || 'needs_review',
    Discovery_Method: template.discoveryMethod || 'generated'
  });
}

function mergeConfigRow_(existing, generated) {
  if (!existing) return generated;
  const current = normalizeConfigRow_(existing);
  if (isManualConfig_(current)) {
    if (!current.Domain && generated.Domain) current.Domain = generated.Domain;
    if (!current.Careers_URL && generated.Careers_URL) current.Careers_URL = generated.Careers_URL;
    if (!current.Last_Checked) current.Last_Checked = generated.Last_Checked;
    if (!current.Discovery_Status) current.Discovery_Status = 'manual';
    if (!current.Discovery_Method) current.Discovery_Method = 'manual';
    return current;
  }
  return generated;
}

function getKnownTemplateForCompany_(companyName) {
  const candidates = getCompanySlugCandidates_(companyName);
  for (let i = 0; i < candidates.length; i += 1) {
    if (KNOWN_BOARD_TEMPLATES[candidates[i]]) {
      return Object.assign({}, KNOWN_BOARD_TEMPLATES[candidates[i]]);
    }
  }
  return null;
}

function inferConfigFromCareersUrl_(url) {
  const lower = String(url || '').toLowerCase().trim();
  if (!lower) return null;
  const domain = domainFromUrl_(lower);
  const result = {
    atsType: '',
    boardId: '',
    domain,
    careersUrl: url,
    source: '',
    notes: 'Copied careers URL from account data',
    discoveryStatus: 'needs_review',
    discoveryMethod: 'careers_url',
    active: false
  };

  if (lower.indexOf('greenhouse') !== -1) {
    const boardId = extractMatch_(lower, /(?:boards|job-boards)\.greenhouse\.io\/([a-z0-9-]+)/i) || extractMatch_(lower, /\/([a-z0-9-]+)\/jobs/i);
    result.atsType = 'greenhouse';
    result.boardId = boardId || '';
    result.source = boardId ? `https://boards-api.greenhouse.io/v1/boards/${boardId}/jobs?content=true` : '';
    result.discoveryStatus = boardId ? 'likely' : 'needs_review';
    result.notes = 'ATS inferred from careers URL';
    result.active = Boolean(boardId);
    return result;
  }

  if (lower.indexOf('lever.co') !== -1) {
    const boardId = extractMatch_(lower, /lever\.co\/([a-z0-9-]+)/i);
    result.atsType = 'lever';
    result.boardId = boardId || '';
    result.source = boardId ? `https://api.lever.co/v0/postings/${boardId}?mode=json` : '';
    result.discoveryStatus = boardId ? 'likely' : 'needs_review';
    result.notes = 'ATS inferred from careers URL';
    result.active = Boolean(boardId);
    return result;
  }

  if (lower.indexOf('ashbyhq.com') !== -1) {
    const boardId = extractMatch_(lower, /jobs\.ashbyhq\.com\/([a-z0-9-]+)/i);
    result.atsType = 'ashby';
    result.boardId = boardId || '';
    result.source = boardId ? `https://api.ashbyhq.com/posting-api/job-board/${boardId}` : '';
    result.discoveryStatus = boardId ? 'likely' : 'needs_review';
    result.notes = 'ATS inferred from careers URL';
    result.active = Boolean(boardId);
    return result;
  }

  if (lower.indexOf('smartrecruiters') !== -1) {
    const boardId = extractMatch_(lower, /\/company\/([a-z0-9-]+)/i);
    result.atsType = 'smartrecruiters';
    result.boardId = boardId || '';
    result.source = boardId ? `https://api.smartrecruiters.com/v1/companies/${boardId}/postings` : '';
    result.discoveryStatus = boardId ? 'likely' : 'needs_review';
    result.notes = 'ATS inferred from careers URL';
    result.active = Boolean(boardId);
    return result;
  }

  return result;
}

function normalizeConfigRow_(row) {
  return {
    Company: canonicalCompanyName_(row.Company || ''),
    ATS_Type: String(row.ATS_Type || ''),
    Board_ID: String(row.Board_ID || ''),
    Domain: String(row.Domain || ''),
    Careers_URL: String(row.Careers_URL || ''),
    Active: truthy_(row.Active) ? 'TRUE' : 'FALSE',
    Notes: String(row.Notes || ''),
    Source: String(row.Source || ''),
    Last_Checked: String(row.Last_Checked || ''),
    Discovery_Status: String(row.Discovery_Status || ''),
    Discovery_Method: String(row.Discovery_Method || '')
  };
}

function configRowToCells_(row) {
  const normalized = normalizeConfigRow_(row);
  return [
    normalized.Company,
    normalized.ATS_Type,
    normalized.Board_ID,
    normalized.Domain,
    normalized.Careers_URL,
    normalized.Active,
    normalized.Notes,
    normalized.Source,
    '',
    '',
    '',
    normalized.Last_Checked || formatSheetDate_(new Date()),
    normalized.Discovery_Status,
    normalized.Discovery_Method
  ];
}

function getSheetObjects_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (!values.length) return [];
  const headers = values.shift();
  return values
    .filter(row => row.some(value => value !== ''))
    .map(row => {
      const obj = {};
      headers.forEach((header, index) => {
        if (!header) return;
        obj[header] = row[index];
      });
      return obj;
    });
}

function getLatestConnectionsCsvFile_() {
  const names = ['Connections.csv', 'connections.csv'];
  let best = null;
  names.forEach(name => {
    const files = DriveApp.getFilesByName(name);
    while (files.hasNext()) {
      const file = files.next();
      if (!best || file.getLastUpdated() > best.getLastUpdated()) {
        best = file;
      }
    }
  });
  return best;
}

function getCompanySlugCandidates_(companyName) {
  const name = canonicalCompanyName_(companyName);
  if (!name) return [];
  const cleaned = normalizeKey_(name.replace(/\(.*?\)/g, ' ').replace(/\b(the|incorporated|inc|corp|corporation|company|co|limited|ltd|llc|llp|plc|group|holdings|technologies|technology|solutions|systems|services|financial group)\b/gi, ' '));
  const tokens = cleaned ? cleaned.split(/\s+/).filter(Boolean) : [];
  const out = [];
  if (tokens.length) {
    out.push(tokens.join(''));
    out.push(tokens[0]);
    if (tokens.length >= 2) out.push(tokens.slice(0, 2).join(''));
  }
  const normalized = normalizeKey_(name);
  if (normalized) out.push(normalized.replace(/\s+/g, ''));
  return Array.from(new Set(out.filter(Boolean)));
}

function canonicalCompanyName_(value) {
  return resolveCompanyIdentity_(value).displayName;
}

function normalizeKey_(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isSuppressedCompany_(companyName) {
  const normalized = normalizeKey_(companyName);
  if (!normalized) return true;
  if (SUPPRESSED_COMPANIES.indexOf(normalized) !== -1) return true;
  return /self[- ]employed|freelance|open to work|seeking .*opportunit/.test(normalized);
}

function isManualConfig_(row) {
  const source = String(row.Source || '').toLowerCase();
  const method = String(row.Discovery_Method || '').toLowerCase();
  return source === 'manual' || method === 'manual';
}

function resolveCompanyIdentity_(value) {
  const raw = String(value || '').trim();
  const normalized = normalizeKey_(raw);
  if (!normalized) {
    return { key: '', displayName: '', matched: false };
  }

  for (let i = 0; i < COMPANY_ALIAS_CATALOG.length; i += 1) {
    const entry = COMPANY_ALIAS_CATALOG[i];
    for (let j = 0; j < entry.aliases.length; j += 1) {
      const aliasKey = normalizeKey_(entry.aliases[j]);
      if (!aliasKey) continue;
      if (normalized === aliasKey || normalized.indexOf(`${aliasKey} `) === 0) {
        return { key: normalizeKey_(entry.displayName), displayName: entry.displayName, matched: true };
      }
    }
  }

  return { key: normalized, displayName: raw, matched: false };
}

function buildTargetMetricsMap_(rows) {
  const metrics = new Map();
  rows.forEach(row => {
    const company = canonicalCompanyName_(row.Company || '');
    const key = normalizeKey_(company);
    if (!key || isSuppressedCompany_(company)) return;
    const current = metrics.get(key) || { company, connections: 0, targetScore: 0 };
    const connections = Number(row.Connections || row['Your Contacts'] || 0);
    const targetScore = Number(row['Target Score'] || 0);
    if (connections > current.connections) current.connections = connections;
    if (targetScore > current.targetScore) current.targetScore = targetScore;
    current.company = company;
    metrics.set(key, current);
  });
  return metrics;
}

function getReviewRank_(row, metrics) {
  const status = String(row.Discovery_Status || '').toLowerCase();
  const atsType = String(row.ATS_Type || '').toLowerCase();
  const hasSupportedAts = ['greenhouse', 'lever', 'ashby', 'smartrecruiters'].indexOf(atsType) !== -1;
  const hasBoardId = Boolean(String(row.Board_ID || '').trim());
  const hasCareersUrl = Boolean(String(row.Careers_URL || '').trim());
  const active = truthy_(row.Active);
  const targetScore = metrics ? Number(metrics.targetScore || 0) : 0;

  if (status === 'verified' && active && hasSupportedAts && hasBoardId) return 99;
  if (hasSupportedAts && !hasBoardId) return targetScore >= 150 ? 1 : 2;
  if (status === 'needs_review' || status === 'likely') return targetScore >= 150 ? 1 : 2;
  if (status === 'unresolved') return hasCareersUrl ? 2 : 5;
  if (status === 'known_unsupported') return targetScore >= 150 ? 3 : 4;
  if (status === 'manual') return 4;
  return hasCareersUrl ? 3 : 5;
}

function getReviewPriorityLabel_(row, metrics) {
  const rank = getReviewRank_(row, metrics);
  if (rank >= 99) return '';
  if (rank <= 2) return 'High';
  if (rank <= 4) return 'Medium';
  return 'Low';
}

function getReviewAction_(row) {
  const status = String(row.Discovery_Status || '').toLowerCase();
  const atsType = String(row.ATS_Type || '').toLowerCase();
  const hasBoardId = Boolean(String(row.Board_ID || '').trim());
  const hasCareersUrl = Boolean(String(row.Careers_URL || '').trim());

  if (status === 'known_unsupported') {
    return 'Known ATS detected; keep inactive until a fetcher exists';
  }
  if (status === 'manual') {
    return 'Manual row; keep or refine only if needed';
  }
  if (atsType && !hasBoardId) {
    return `Confirm the ${atsType} board ID and activate it`;
  }
  if (hasCareersUrl) {
    return 'Open the careers page and confirm the ATS';
  }
  return 'Find the careers page first';
}

function writeConfigReviewQueue_(targetMetricsByKey, rows) {
  const ss = SpreadsheetApp.getActive();
  const reviewSheet = ss.getSheetByName(SHEET_NAMES.REVIEW_QUEUE) || ss.insertSheet(SHEET_NAMES.REVIEW_QUEUE);
  const reviewItems = rows
    .map(row => normalizeConfigRow_(row))
    .filter(row => {
      const key = normalizeKey_(row.Company);
      if (!key || isSuppressedCompany_(row.Company)) return false;
      if (!targetMetricsByKey.has(key)) return false;
      return Boolean(getReviewPriorityLabel_(row, targetMetricsByKey.get(key)));
    })
    .map(row => {
      const metrics = targetMetricsByKey.get(normalizeKey_(row.Company)) || { connections: 0, targetScore: 0 };
      return {
        rank: getReviewRank_(row, metrics),
        priority: getReviewPriorityLabel_(row, metrics),
        company: canonicalCompanyName_(row.Company),
        connections: Number(metrics.connections || 0),
        targetScore: Number(metrics.targetScore || 0),
        discoveryStatus: String(row.Discovery_Status || ''),
        atsType: String(row.ATS_Type || ''),
        boardId: String(row.Board_ID || ''),
        domain: String(row.Domain || ''),
        careersUrl: String(row.Careers_URL || ''),
        notes: String(row.Notes || ''),
        action: getReviewAction_(row)
      };
    })
    .sort((left, right) => {
      if (left.rank !== right.rank) return left.rank - right.rank;
      if (left.targetScore !== right.targetScore) return right.targetScore - left.targetScore;
      if (left.connections !== right.connections) return right.connections - left.connections;
      return left.company.localeCompare(right.company);
    })
    .slice(0, 500);

  const values = [REVIEW_QUEUE_HEADERS].concat(reviewItems.map(item => ([
    item.priority,
    item.company,
    item.connections,
    item.targetScore,
    item.discoveryStatus,
    item.atsType,
    item.boardId,
    item.domain,
    item.careersUrl,
    item.notes,
    item.action
  ])));

  reviewSheet.clearContents();
  reviewSheet.getRange(1, 1, values.length, REVIEW_QUEUE_HEADERS.length).setValues(values);
  reviewSheet.setFrozenRows(1);
}

function truthy_(value) {
  if (value === true) return true;
  return ['1', 'true', 'yes', 'y', 'active'].indexOf(String(value || '').toLowerCase().trim()) !== -1;
}

function buildJobDedupKey_(companyName, job) {
  return [
    normalizeKey_(canonicalCompanyName_(companyName)),
    normalizeKey_(job.title || ''),
    normalizeKey_(job.location || ''),
    normalizeKey_(job.url || '')
  ].join('|');
}

function domainFromUrl_(value) {
  const match = String(value || '').match(/^https?:\/\/([^/]+)/i);
  if (!match) return '';
  return match[1].replace(/^www\./i, '').toLowerCase();
}

function fetchJson_(url) {
  const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
  const code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error(`HTTP ${code} from ${url}`);
  }
  return JSON.parse(response.getContentText() || '{}');
}

function getNestedValue_(obj, paths) {
  for (let i = 0; i < paths.length; i += 1) {
    const parts = paths[i].split('.');
    let current = obj;
    let ok = true;
    for (let j = 0; j < parts.length; j += 1) {
      if (!current || !Object.prototype.hasOwnProperty.call(current, parts[j])) {
        ok = false;
        break;
      }
      current = current[parts[j]];
    }
    if (ok && current !== null && current !== undefined && current !== '') {
      return current;
    }
  }
  return '';
}

function isCanadaLocation_(location) {
  const value = String(location || '').toLowerCase();
  if (!value) return false;
  return CANADA_KEYWORDS.some(keyword => value.indexOf(keyword) !== -1);
}

function extractMatch_(value, regex) {
  const match = String(value || '').match(regex);
  return match ? match[1] : '';
}

function formatSheetDate_(date) {
  return Utilities.formatDate(date instanceof Date ? date : new Date(date), Session.getScriptTimeZone(), 'dd/MM/yyyy');
}

function logMessage_(message) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(SHEET_NAMES.LOG) || ss.insertSheet(SHEET_NAMES.LOG);
  sheet.appendRow([new Date(), message]);
}

function repairFormulaTabs_() {
  const ss = SpreadsheetApp.getActive();
  const connections = ss.getSheetByName(SHEET_NAMES.CONNECTIONS);
  const targets = ss.getSheetByName(SHEET_NAMES.TARGETS);
  const daily = ss.getSheetByName('Daily_Hot_List');
  const today = ss.getSheetByName('Today_View');
  const topContacts = ss.getSheetByName('Top_Contacts');
  const log = ss.getSheetByName(SHEET_NAMES.LOG) || ss.insertSheet(SHEET_NAMES.LOG);
  if (!connections || !targets || !daily || !today || !topContacts) {
    throw new Error('Missing one or more formula-driven tabs.');
  }

  const connectionFormulas = [[
    buildCleanCompanyFormula_(),
    '=ARRAYFORMULA(IF(F2:F="","",IF(REGEXMATCH(LOWER(F2:F),"vp|vice president|head|director|chief|ceo|cfo|coo|cto|cio|founder|owner|partner|principal|managing director|general manager|gm|manager|lead|talent|recruit|acquisition|human resources|people|hr|hiring"),1,0)))',
    '=ARRAYFORMULA(IF(F2:F="","",IF(REGEXMATCH(LOWER(F2:F),"vp|vice president|head|director|chief|ceo|cfo|coo|cto|cio|founder|owner|partner|principal|managing director|general manager|gm"),1,0)))',
    '=ARRAYFORMULA(IF(F2:F="","",IF(REGEXMATCH(LOWER(F2:F),"talent|recruit|acquisition|human resources|people|hr"),1,0)))',
    '=ARRAYFORMULA(IF(F2:F="","",IF(REGEXMATCH(LOWER(F2:F),"engineer|engineering|developer|software|data|analytics|technology|it|product|architect|security|cloud|devops|ai|machine learning"),1,0)))',
    '=ARRAYFORMULA(IF(F2:F="","",IF(REGEXMATCH(LOWER(F2:F),"finance|financial|accounting|fp&a|controller|treasury|audit|risk|compliance|analyst|investment|capital markets"),1,0)))',
    '=ARRAYFORMULA(IF(H2:H="","",COUNTIF(H2:H,H2:H)))',
    '=ARRAYFORMULA(IF(G2:G="","",IFERROR(ROUND((TODAY()-DATEVALUE(G2:G))/365.25,1),"")))',
    '=ARRAYFORMULA(IF(H2:H="","",IFERROR(N(I2:I)*20+N(J2:J)*20+N(K2:K)*25+N(L2:L)*10+N(M2:M)*6+IF(N(N2:N)>=50,20,IF(N(N2:N)>=20,15,IF(N(N2:N)>=10,10,IF(N(N2:N)>=5,5,0)))),"")))'
  ]];

  const targetFormula = '=QUERY({Connections!H2:H,Connections!J2:J,Connections!K2:K,Connections!I2:I},"select Col1, count(Col1), sum(Col2), sum(Col3), sum(Col4), count(Col1)*2+sum(Col2)*10+sum(Col3)*8+sum(Col4)*15 where Col1 is not null and not Col1 matches \'(?i)self-employed|self employed|freelance|freelancer|independent consultant|confidential|open to work|seeking.*opportunit.*|retired|#.*\' group by Col1 order by count(Col1)*2+sum(Col2)*10+sum(Col3)*8+sum(Col4)*15 desc label Col1 \'Company\', count(Col1) \'Connections\', sum(Col2) \'Senior Contacts\', sum(Col3) \'Talent Contacts\', sum(Col4) \'Buyer Titles\', count(Col1)*2+sum(Col2)*10+sum(Col3)*8+sum(Col4)*15 \'Target Score\'",0)';
  const dailyCompanyFormula = '=QUERY({Hiring_Import!A2:A,Hiring_Import!C2:C,Hiring_Import!H2:H},"select Col1, count(Col2), max(Col3) where Col1 is not null group by Col1 label Col1 \'Company\', count(Col2) \'Jobs Posted\', max(Col3) \'Most Recent Posting\'",0)';
  const dailyFormulas = [[
    '=ARRAYFORMULA(IF(A2:A="","",COUNTIF(Connections!H2:H,A2:A)))',
    '=ARRAYFORMULA(IF(A2:A="","",COUNTIFS(Connections!H2:H,A2:A,Connections!J2:J,1)))',
    '=ARRAYFORMULA(IF(A2:A="","",COUNTIFS(Connections!H2:H,A2:A,Connections!K2:K,1)))',
    '=ARRAYFORMULA(IF(A2:A="","",IFERROR(VLOOKUP(A2:A,Target_Accounts!A:F,6,FALSE),0)))',
    '=ARRAYFORMULA(IF(A2:A="","",B2:B*5 + D2:D*2 + E2:E*3 + F2:F*4))',
    '=ARRAYFORMULA(IF(A2:A="","",IF((D2:D>=50)+(E2:E>=5),"Hot",IF((D2:D>=10)+(E2:E>=1),"Warm","Cold"))))',
    '=MAP(A2:A,LAMBDA(company,IF(company="","",IFERROR(LOOKUP(2,1/(History!B$2:B=company),History!F$2:F),""))))',
    '=MAP(A2:A,LAMBDA(company,IF(company="","",IFERROR(TODAY()-INT(LOOKUP(2,1/(History!B$2:B=company),History!A$2:A)),""))))',
    '=ARRAYFORMULA(IF(K2:K="","",IF(K2:K>=14,"STALE","")))',
    '=MAP(A2:A,LAMBDA(company,IF(company="","",IFERROR(VLOOKUP(company,{Job_Boards_Config!A$2:A,Job_Boards_Config!E$2:E},2,FALSE),""))))'
  ]];
  const todayFormula = '=IFERROR(ARRAY_CONSTRAIN(SORT(FILTER(Daily_Hot_List!A2:M,Daily_Hot_List!A2:A<>"",Daily_Hot_List!B2:B>=Setup!B10,Daily_Hot_List!D2:D>=Setup!B9),8,FALSE),Setup!B12,13),{"","","","","","","","","","","","",""})';
  const topContactsFormula = '=IFERROR(SORT(QUERY({Connections!A2:A&" "&Connections!B2:B,Connections!H2:H,Connections!F2:F,Connections!P2:P,Connections!C2:C,Connections!G2:G,Connections!D2:D},"select Col1, Col2, Col3, Col4, Col5, Col6, Col7 where Col2 is not null and Col4 >= "&Setup!B11&" and Col2 matches \'"&TEXTJOIN("|",TRUE,ARRAYFORMULA(REGEXREPLACE(FILTER(Today_View!A2:A,Today_View!A2:A<>""),"([.^$*+?(){}\\[\\]\\\\|])","\\\\$1")))&"\'",0),4,FALSE),{"","","","","","",""})';

  connections.getRange('H1:P1').setValues([CONNECTION_HEADERS]);
  connections.getRange('H2:P').clearContent();
  connections.getRange('H2:P2').setFormulas(connectionFormulas);

  targets.clearContents();
  targets.getRange('A1').setFormula(targetFormula);

  daily.clearContents();
  daily.getRange('A1').setFormula(dailyCompanyFormula);
  daily.getRange('D1:M1').setValues([DAILY_HEADERS.slice(3)]);
  daily.getRange('D2:M2').setFormulas(dailyFormulas);

  today.clearContents();
  today.getRange('A1:M1').setValues([DAILY_HEADERS]);
  today.getRange('A2').setFormula(todayFormula);

  topContacts.clearContents();
  topContacts.getRange('A1:G1').setValues([TOP_CONTACT_HEADERS]);
  topContacts.getRange('A2').setFormula(topContactsFormula);

  if (!log.getRange('A1').getValue()) {
    log.getRange('A1:B1').setValues([['Timestamp', 'Message']]);
  }

  applySheetFormatting_();
}

function applySheetFormatting_() {
  const ss = SpreadsheetApp.getActive();
  const hiring = ss.getSheetByName(SHEET_NAMES.IMPORT);
  const history = ss.getSheetByName('History');
  const daily = ss.getSheetByName('Daily_Hot_List');
  const today = ss.getSheetByName('Today_View');
  const topContacts = ss.getSheetByName('Top_Contacts');
  const log = ss.getSheetByName(SHEET_NAMES.LOG);
  const review = ss.getSheetByName(SHEET_NAMES.REVIEW_QUEUE);

  if (hiring) hiring.getRange('H:H').setNumberFormat('yyyy-mm-dd hh:mm:ss');
  if (history) history.getRange('A:A').setNumberFormat('yyyy-mm-dd hh:mm:ss');
  if (daily) daily.getRange('C:C').setNumberFormat('yyyy-mm-dd hh:mm:ss');
  if (today) today.getRange('C:C').setNumberFormat('yyyy-mm-dd hh:mm:ss');
  if (topContacts) topContacts.getRange('F:F').setNumberFormat('dd/mm/yyyy');
  if (log) log.getRange('A:A').setNumberFormat('yyyy-mm-dd hh:mm:ss');
  if (review) {
    review.getRange('C:D').setNumberFormat('0');
    review.setFrozenRows(1);
  }
}

function buildCleanCompanyFormula_() {
  const branches = COMPANY_ALIAS_CATALOG.map(entry => {
    const pattern = buildAliasRegex_(entry.aliases);
    const safeName = entry.displayName.replace(/"/g, '""');
    return `IF(REGEXMATCH(LOWER(TRIM(company)),"${pattern}"),"${safeName}",`;
  }).join('');
  return `=ARRAYFORMULA(IF(E2:E="","",MAP(E2:E,LAMBDA(company,${branches}TRIM(company)${')'.repeat(COMPANY_ALIAS_CATALOG.length)}))))`;
}

function buildAliasRegex_(aliases) {
  const patterns = aliases.map(alias => regexEscapeForSheets_(normalizeKey_(alias)).replace(/\s+/g, '[^a-z0-9]+'));
  return `^(?:${patterns.join('|')})(?:\\b|$)`;
}

function regexEscapeForSheets_(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
