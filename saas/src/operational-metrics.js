export function summarizeOperationalJobs(jobs = [], { nowMs = Date.now(), staleAfterMs = 15 * 60 * 1000 } = {}) {
  const rows = Array.isArray(jobs) ? jobs : [];
  const active = rows.filter((job) => ['queued', 'running'].includes(job.status));
  const timestamp = (job) => {
    const value = job.startedAt || job.queuedAt || job.updatedAt || job.createdAt;
    return value ? Date.parse(value) : Number.NaN;
  };
  const activeAges = active.map((job) => nowMs - timestamp(job));
  const ages = activeAges.filter((age) => Number.isFinite(age) && age >= 0);
  const invalidActiveTimestamps = activeAges.length - ages.length;
  const recentCutoff = nowMs - 24 * 60 * 60 * 1000;
  const recent = rows.filter((job) => {
    const at = Date.parse(job.finishedAt || job.updatedAt || job.createdAt || 0);
    return Number.isFinite(at) && at >= recentCutoff;
  });
  const ingestion = recent.filter((job) => ['live-job-import', 'ats-discovery', 'revenue-pipeline', 'launch-workflow'].includes(job.type));
  const successfulIngestion = ingestion.filter((job) => job.status === 'completed').length;
  const failedIngestion = ingestion.filter((job) => job.status === 'failed').length;
  const decidedIngestion = successfulIngestion + failedIngestion;
  const ingestionSuccessRate24h = decidedIngestion
    ? Math.round((successfulIngestion / decidedIngestion) * 1000) / 10
    : null;
  const oldestActiveAgeMs = ages.length ? Math.max(...ages) : 0;
  return {
    activeJobs: active.length,
    queuedJobs: active.filter((job) => job.status === 'queued').length,
    runningJobs: active.filter((job) => job.status === 'running').length,
    oldestActiveAgeMs,
    staleAfterMs,
    staleJobs: ages.filter((age) => age > staleAfterMs).length,
    invalidActiveTimestamps,
    recentFailedJobs: recent.filter((job) => job.status === 'failed').length,
    ingestionRuns24h: ingestion.length,
    ingestionFailedRuns24h: failedIngestion,
    ingestionSuccessRate24h,
    healthy: invalidActiveTimestamps === 0
      && oldestActiveAgeMs <= staleAfterMs
      && (ingestionSuccessRate24h === null || ingestionSuccessRate24h >= 95),
  };
}
