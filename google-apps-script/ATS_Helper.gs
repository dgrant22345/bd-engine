function runAtsHelper() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(SHEET_NAMES.CONFIG);
  const targetSheet = ss.getSheetByName(SHEET_NAMES.TARGETS);
  const setupSheet = ss.getSheetByName(SHEET_NAMES.SETUP);
  if (!sheet) throw new Error('Missing Job_Boards_Config sheet.');

  const rows = getSheetObjects_(sheet).map(row => normalizeConfigRow_(row));
  const targetMetricsByKey = targetSheet ? buildTargetMetricsMap_(getSheetObjects_(targetSheet)) : new Map();
  const limit = getAtsHelperLimit_(setupSheet);
  const candidates = getAtsHelperCandidates_(rows, targetMetricsByKey, limit);
  const candidateKeys = new Set(candidates.map(row => normalizeKey_(row.Company)));
  const output = [CONFIG_HEADERS];
  const finalRows = [];
  let checked = 0;
  let upgraded = 0;

  rows.forEach(row => {
    const normalized = normalizeConfigRow_(row);
    const supportedBoard = isSupportedBoardRow_(normalized);
    const reviewedStatus = String(normalized.Discovery_Status || '').toLowerCase();
    const rowKey = normalizeKey_(normalized.Company);
    const skipDetection = isManualConfig_(normalized) || supportedBoard || reviewedStatus === 'verified' || !candidateKeys.has(rowKey);

    if (skipDetection) {
      finalRows.push(normalized);
      output.push(configRowToCells_(normalized));
      return;
    }

    checked += 1;
    const careersUrl = normalized.Careers_URL;
    let detected = null;

    if (careersUrl) {
      try {
        const response = UrlFetchApp.fetch(careersUrl, { muteHttpExceptions: true, followRedirects: true });
        const finalUrl = response.getFinalUrl ? response.getFinalUrl() : careersUrl;
        const html = response.getContentText() || '';
        detected = detectAtsFromSignals_(finalUrl + '\n' + html, careersUrl, normalized.Board_ID);
      } catch (err) {
        normalized.Notes = `ATS helper error: ${err.message}`;
      }
    }

    if (detected) {
      detected = verifyDetectedConfig_(detected, normalized.Careers_URL || normalized.Source || '');
    }

    const merged = detected ? applyDetectedConfig_(normalized, detected) : normalized;
    merged.Last_Checked = formatSheetDate_(new Date());
    if (String(merged.Discovery_Status || '').toLowerCase() === 'verified' && merged.Active === 'TRUE') {
      upgraded += 1;
    }
    finalRows.push(merged);
    output.push(configRowToCells_(merged));
  });

  sheet.clearContents();
  sheet.getRange(1, 1, output.length, CONFIG_HEADERS.length).setValues(output);
  writeConfigReviewQueue_(targetMetricsByKey, finalRows);
  applySheetFormatting_();
  SpreadsheetApp.flush();
  logMessage_(`ATS helper checked ${checked} high-priority config rows and verified ${upgraded}`);
  SpreadsheetApp.getActive().toast(`ATS helper checked ${checked} rows and verified ${upgraded}`, 'BD Engine', 7);
}

function detectAtsFromSignals_(text, careersUrl, existingBoardId) {
  const value = String(text || '').toLowerCase();
  const domain = domainFromUrl_(careersUrl);

  let boardId = extractMatch_(value, /(?:boards|job-boards)\.greenhouse\.io\/([a-z0-9-]+)/i);
  if (!boardId) boardId = extractMatch_(value, /boards-api\.greenhouse\.io\/v1\/boards\/([a-z0-9-]+)/i);
  if (boardId) {
    return {
      atsType: 'greenhouse',
      boardId,
      active: true,
      source: `https://boards-api.greenhouse.io/v1/boards/${boardId}/jobs?content=true`,
      notes: `Detected Greenhouse board (${boardId})`,
      discoveryStatus: 'verified',
      discoveryMethod: 'ats_helper'
    };
  }

  boardId = extractMatch_(value, /lever\.co\/([a-z0-9-]+)/i);
  if (boardId) {
    return {
      atsType: 'lever',
      boardId,
      active: true,
      source: `https://api.lever.co/v0/postings/${boardId}?mode=json`,
      notes: `Detected Lever board (${boardId})`,
      discoveryStatus: 'verified',
      discoveryMethod: 'ats_helper'
    };
  }

  boardId = extractMatch_(value, /jobs\.ashbyhq\.com\/([a-z0-9-]+)/i);
  if (boardId) {
    return {
      atsType: 'ashby',
      boardId,
      active: true,
      source: `https://api.ashbyhq.com/posting-api/job-board/${boardId}`,
      notes: `Detected Ashby board (${boardId})`,
      discoveryStatus: 'verified',
      discoveryMethod: 'ats_helper'
    };
  }

  boardId = extractMatch_(value, /smartrecruiters\.com\/company\/([a-z0-9-]+)/i) ||
    extractMatch_(value, /api\.smartrecruiters\.com\/v1\/companies\/([a-z0-9-]+)/i);
  if (boardId) {
    return {
      atsType: 'smartrecruiters',
      boardId,
      active: true,
      source: `https://api.smartrecruiters.com/v1/companies/${boardId}/postings`,
      notes: `Detected SmartRecruiters board (${boardId})`,
      discoveryStatus: 'verified',
      discoveryMethod: 'ats_helper'
    };
  }

  if (/myworkdayjobs\.com|workdayjobs\.com|\/wday\/cxs\//i.test(value)) {
    return {
      atsType: 'workday',
      boardId: existingBoardId || '',
      active: false,
      source: careersUrl || '',
      notes: 'Recognized Workday career site',
      discoveryStatus: 'known_unsupported',
      discoveryMethod: 'ats_helper'
    };
  }

  if (/successfactors|jobs\.sap\.com|career[s]?\.?successfactors/i.test(value)) {
    return {
      atsType: 'successfactors',
      boardId: '',
      active: false,
      source: careersUrl || '',
      notes: 'Recognized SuccessFactors career site',
      discoveryStatus: 'known_unsupported',
      discoveryMethod: 'ats_helper'
    };
  }

  if (/taleo|oraclecloud\.com\/.+candidateexperience/i.test(value)) {
    return {
      atsType: 'taleo',
      boardId: '',
      active: false,
      source: careersUrl || '',
      notes: 'Recognized Taleo career site',
      discoveryStatus: 'known_unsupported',
      discoveryMethod: 'ats_helper'
    };
  }

  if (/icims\.com|icims\.jobs/i.test(value)) {
    return {
      atsType: 'icims',
      boardId: '',
      active: false,
      source: careersUrl || '',
      notes: 'Recognized iCIMS career site',
      discoveryStatus: 'known_unsupported',
      discoveryMethod: 'ats_helper'
    };
  }

  if (/jobvite/i.test(value)) {
    return {
      atsType: 'jobvite',
      boardId: '',
      active: false,
      source: careersUrl || '',
      notes: 'Recognized Jobvite career site',
      discoveryStatus: 'known_unsupported',
      discoveryMethod: 'ats_helper'
    };
  }

  return {
    atsType: '',
    boardId: existingBoardId || '',
    active: false,
    source: careersUrl || '',
    notes: domain ? `Checked careers site on ${domain}; no supported ATS signal found` : 'No supported ATS signal found',
    discoveryStatus: existingBoardId ? 'needs_review' : 'unresolved',
    discoveryMethod: 'ats_helper'
  };
}

function applyDetectedConfig_(row, detected) {
  const merged = normalizeConfigRow_(row);
  if (detected.atsType) merged.ATS_Type = detected.atsType;
  if (detected.boardId) merged.Board_ID = detected.boardId;
  if (!merged.Domain && merged.Careers_URL) merged.Domain = domainFromUrl_(merged.Careers_URL);
  merged.Active = detected.active ? 'TRUE' : 'FALSE';
  merged.Notes = detected.notes || merged.Notes;
  merged.Source = detected.source || merged.Source;
  merged.Discovery_Status = detected.discoveryStatus || merged.Discovery_Status;
  merged.Discovery_Method = detected.discoveryMethod || merged.Discovery_Method;
  return merged;
}

function isSupportedBoardRow_(row) {
  const ats = String(row.ATS_Type || '').toLowerCase();
  return ['greenhouse', 'lever', 'ashby', 'smartrecruiters'].indexOf(ats) !== -1 && Boolean(String(row.Board_ID || '').trim());
}

function getAtsHelperLimit_(setupSheet) {
  if (!setupSheet) return ATS_HELPER_DEFAULT_LIMIT;
  const values = setupSheet.getRange(1, 1, Math.min(setupSheet.getLastRow(), 25), 2).getDisplayValues();
  let value = 0;
  values.forEach(row => {
    if (String(row[0] || '').trim().toLowerCase() === 'ats helper limit') {
      value = Number(row[1]) || 0;
    }
  });
  if (!value || value < 1) return ATS_HELPER_DEFAULT_LIMIT;
  return Math.min(value, 250);
}

function getAtsHelperCandidates_(rows, targetMetricsByKey, limit) {
  return rows
    .filter(row => {
      const key = normalizeKey_(row.Company);
      if (!key || !targetMetricsByKey.has(key)) return false;
      if (isManualConfig_(row) || isSupportedBoardRow_(row)) return false;
      const status = String(row.Discovery_Status || '').toLowerCase();
      if (status === 'verified') return false;
      return Boolean(String(row.Careers_URL || '').trim());
    })
    .map(row => {
      const metrics = targetMetricsByKey.get(normalizeKey_(row.Company)) || { connections: 0, targetScore: 0 };
      return {
        row,
        rank: getReviewRank_(row, metrics),
        targetScore: Number(metrics.targetScore || 0),
        connections: Number(metrics.connections || 0)
      };
    })
    .sort((left, right) => {
      if (left.rank !== right.rank) return left.rank - right.rank;
      if (left.targetScore !== right.targetScore) return right.targetScore - left.targetScore;
      if (left.connections !== right.connections) return right.connections - left.connections;
      return String(left.row.Company || '').localeCompare(String(right.row.Company || ''));
    })
    .slice(0, limit)
    .map(item => item.row);
}

function verifyDetectedConfig_(detected, fallbackSource) {
  if (!detected || !detected.active || !detected.boardId) return detected;

  const source = String(detected.source || fallbackSource || '').trim();
  if (!source) return detected;

  try {
    const response = UrlFetchApp.fetch(source, { muteHttpExceptions: true, followRedirects: true });
    const status = response.getResponseCode();
    if (status >= 200 && status < 300) {
      return detected;
    }
    return {
      atsType: detected.atsType,
      boardId: detected.boardId,
      active: false,
      source,
      notes: `Detected ${detected.atsType} signals but the board endpoint returned HTTP ${status}`,
      discoveryStatus: 'needs_review',
      discoveryMethod: 'ats_helper'
    };
  } catch (err) {
    return {
      atsType: detected.atsType,
      boardId: detected.boardId,
      active: false,
      source,
      notes: `Detected ${detected.atsType} signals but endpoint verification failed: ${err.message}`,
      discoveryStatus: 'needs_review',
      discoveryMethod: 'ats_helper'
    };
  }
}
