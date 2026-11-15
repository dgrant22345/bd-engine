// Verified November 15, 2026 through each employer's official career links.
// Exact stale identities only: a correction must never overwrite a new source.
const corrections = new Map([
  ['zynga', { oldHost: 'zynga.com', oldPath: /^\/careers\/?$/, atsType: 'greenhouse', boardId: 'zyngacareers', url: 'https://job-boards.greenhouse.io/zyngacareers', evidence: 'https://www.zynga.com/jobs/job-openings/' }],
  ['hays', { oldHost: 'hays.com', oldPath: /^\/jobs\/?$/, atsType: 'ukg_pro', boardId: 'recruiting.ultipro.com/HAY1004HAUS/bebb31cb-327e-46b6-80a7-e0033ffa4653', url: 'https://recruiting.ultipro.com/HAY1004HAUS/JobBoard/bebb31cb-327e-46b6-80a7-e0033ffa4653', evidence: 'https://www.hays.com/en-US/careers' }],
  ['pcs wireless', { oldHost: 'pcsglobal.bamboohr.com', oldPath: /^\/js\/embed\.js$/, atsType: 'ukg_ready', boardId: 'secure7.saashr.com/6219063', url: 'https://secure7.saashr.com/ta/6219063.careers?CareersSearch&lang=en-US', evidence: 'https://pcsww.com/' }],
  ['linkedin', { oldHost: 'linkedin.ca', oldPath: /^\/careers\/?$/, hold: 'manual', url: 'https://careers.linkedin.com/', reason: 'The official careers site links to LinkedIn job search. No supported public feed was verified; use the official careers link for manual review.' }],
  ['easy hiring solutions services', { oldHost: 'easyhiringsolutions.com', oldPath: /^\/?$/, hold: 'identity_review', reason: 'The saved domain now serves unrelated shopping content. Verify the employer’s current domain before importing jobs.' }],
  ['maple leaf foods inc', { oldHost: 'careers.mapleleaffoods.com', oldPath: /^\/?$/, hold: 'unavailable', url: 'https://www.mapleleaffoods.com/careers/job-search/', reason: 'The saved CATS board is retired. Its official replacement currently returns HTTP 404; this does not establish that the employer has no openings.' }],
]);

export function applyCareerSourceCorrection(config, timestamp = new Date().toISOString()) {
  if (config.careerSourceCorrectionVersion === 1) return false;
  if (config.reviewStatus === 'rejected') return false;
  if (config.active === false && !['failed', 'partial'].includes(config.lastImportStatus)) return false;
  const key = String(config.companyName || '').trim().toLowerCase();
  const fix = corrections.get(key);
  if (!fix) return false;
  const oldUrl = config.apiUrl || config.resolvedBoardUrl || config.sourceUrl || config.careersUrl || '';
  let parsed;
  try { parsed = new URL(oldUrl); } catch { return false; }
  if (parsed.hostname.replace(/^www\./, '') !== fix.oldHost || !fix.oldPath.test(parsed.pathname)) return false;
  const previous = { atsType: config.atsType, boardId: config.boardId, url: oldUrl };
  config.careerSourceCorrectionVersion = 1;
  config.previousCareerSource = previous;
  config.sourceCorrectionEvidence = fix.evidence || fix.url || oldUrl;
  config.updatedAt = timestamp;
  config.importRetryCount = 0; config.nextImportRetryAt = '';
  if (fix.hold) {
    config.sourceHold = fix.hold;
    config.sourceHoldReason = fix.reason;
    config.lastImportStatus = 'not run';
    config.lastImportError = '';
    config.active = false;
    config.reviewStatus = fix.hold === 'manual' ? 'approved' : 'pending';
    config.discoveryStatus = fix.hold === 'manual' ? 'manual' : 'needs_review';
    if (fix.hold === 'manual') { config.atsType = 'manual'; config.ats = 'manual'; }
  } else {
    config.atsType = fix.atsType; config.ats = fix.atsType; config.boardId = fix.boardId;
    config.sourceBaselinePending = true; config.lastSourceMigrationAt = timestamp;
    config.discoveryStatus = 'resolved'; config.reviewStatus = 'approved'; config.active = true;
    config.lastImportStatus = 'not run'; config.lastImportError = '';
  }
  if (fix.url) {
    config.apiUrl = ''; config.sourceUrl = fix.url; config.boardUrl = fix.url;
    config.resolvedBoardUrl = fix.url; config.careersUrl = fix.url;
  }
  return true;
}
