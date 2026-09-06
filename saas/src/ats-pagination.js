// A complete ATS snapshot is allowed to close unseen jobs. Pagination must
// therefore prove coverage, not just finish its requests without an HTTP error.
export function readAtsReportedTotal(...values) {
  const value = values.find((item) => item !== undefined && item !== null);
  if (value === undefined) return null;
  const total = typeof value === 'number' || (typeof value === 'string' && value.trim()) ? Number(value) : NaN;
  if (!Number.isSafeInteger(total) || total < 0) throw new Error('ATS returned an invalid total; existing jobs preserved');
  return total;
}

export const ATS_COVERAGE_REASONS = Object.freeze({
  page_limit: 'The board exceeded this refresh’s page limit.',
  time_budget: 'The board exceeded this refresh’s time budget.',
  total_changed: 'The source’s job count changed during the refresh.',
  source_changed: 'The source’s results changed during the refresh.',
  duplicate_jobs: 'The source repeated jobs across its results pages.',
  invalid_rows: 'Some source rows had no usable job identity.',
  missing_jobs: 'The source returned fewer unique jobs than it reported.',
  inconsistent_page: 'The source returned an inconsistent results page.',
});

export async function fetchPaginatedAtsJobs({
  providerName, pageSize, maxPages, concurrency, readPage, jobKey,
  timeBudgetMs = 120000, clock = () => performance.now(), recheckFirstPage = false,
}) {
  for (const value of [pageSize, maxPages, concurrency, timeBudgetMs]) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error('Invalid ATS pagination budget');
  }
  const startedAt = clock();
  const deadlineAt = startedAt + timeBudgetMs;
  const jobs = [];
  const seen = new Set();
  const reasons = new Set();
  let pagesFetched = 0;
  let duplicateRows = 0;
  let verificationRequests = 0;
  let lastPageLength = 0;
  const firstPage = await readPage(0, { deadlineAt });
  const reportedTotal = readAtsReportedTotal(firstPage?.total);

  const appendPage = (page, offset) => {
    if (!Array.isArray(page?.jobs)) throw new Error(`${providerName}: invalid results page; existing jobs preserved`);
    const pageTotal = readAtsReportedTotal(page.total);
    if (pageTotal !== null && pageTotal !== reportedTotal) reasons.add('total_changed');
    if (page.jobs.length > pageSize) reasons.add('inconsistent_page');
    if (reportedTotal !== null && page.jobs.length !== Math.min(pageSize, Math.max(0, reportedTotal - offset))) {
      reasons.add('inconsistent_page');
    }
    pagesFetched++;
    lastPageLength = page.jobs.length;
    for (const item of page.jobs) {
      const identity = jobKey(item);
      const key = typeof identity === 'string' || typeof identity === 'number' ? String(identity).trim() : '';
      if (!key) {
        reasons.add('invalid_rows');
        jobs.push(item); // Keep invalid rows visible to the import validator.
      } else if (seen.has(key)) {
        duplicateRows++;
        reasons.add('duplicate_jobs');
      } else {
        seen.add(key);
        jobs.push(item);
      }
    }
  };
  appendPage(firstPage, 0);

  const pagesNeeded = reportedTotal === null ? maxPages : Math.max(1, Math.ceil(reportedTotal / pageSize));
  const pageLimit = Math.min(maxPages, pagesNeeded);
  let nextPage = 1;
  while (nextPage < pageLimit) {
    // Without a total, read sequentially: speculative requests beyond a short
    // terminal page can return 404 and incorrectly fail a healthy board.
    if (reportedTotal === null && lastPageLength < pageSize) break;
    if (reasons.has('duplicate_jobs') || reasons.has('total_changed')) break;
    if (clock() >= deadlineAt) { reasons.add('time_budget'); break; }
    const batchSize = reportedTotal === null ? 1 : Math.min(concurrency, pageLimit - nextPage);
    const offsets = Array.from({ length: batchSize }, (_, index) => (nextPage + index) * pageSize);
    const pages = await Promise.allSettled(offsets.map((offset) => readPage(offset, { deadlineAt })));
    const failed = pages.find((page) => page.status === 'rejected');
    if (failed) {
      // A missing *later* page must never be mistaken for a removed board.
      throw new Error(`${providerName} could not load every results page. Retry the refresh; existing jobs were preserved.`, { cause: failed.reason });
    }
    pages.forEach((page, index) => appendPage(page.value, offsets[index]));
    nextPage += batchSize;
  }

  if (reportedTotal === null) {
    if (lastPageLength >= pageSize && pagesFetched >= maxPages) reasons.add('page_limit');
  } else if (seen.size !== reportedTotal) {
    reasons.add(pagesNeeded > maxPages && pagesFetched >= maxPages ? 'page_limit' : 'missing_jobs');
  }
  // Workday only supplies its count on the first page. Recheck that page before
  // allowing closures; a count or head-identity change invalidates the snapshot.
  if (recheckFirstPage && reasons.size === 0 && pagesFetched > 1) {
    if (clock() >= deadlineAt) reasons.add('time_budget');
    else {
      let verification;
      try {
        verificationRequests++;
        verification = await readPage(0, { deadlineAt });
      } catch (cause) {
        throw new Error(`${providerName} could not verify its results. Retry the refresh; existing jobs were preserved.`, { cause });
      }
      if (readAtsReportedTotal(verification?.total) !== reportedTotal) reasons.add('total_changed');
      if (!Array.isArray(verification?.jobs)
        || JSON.stringify(verification.jobs.map(jobKey)) !== JSON.stringify(firstPage.jobs.map(jobKey))) reasons.add('source_changed');
    }
  }
  return {
    jobs,
    reportedTotal,
    complete: reasons.size === 0,
    pagination: {
      pagesFetched, pageLimit: maxPages, verificationRequests, uniqueJobs: seen.size, duplicateRows,
      reasons: [...reasons], elapsedMs: Math.max(0, Math.round(clock() - startedAt)),
    },
  };
}
