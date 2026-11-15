export function sourceNeedsRetry(config) {
  return config.active !== false && ['failed', 'partial'].includes(config.lastImportStatus);
}

export function markSourceRetry(config, error = null, nowMs = Date.now()) {
  config.importRetryCount = Math.min(10, (Number(config.importRetryCount) || 0) + 1);
  const backoff = Math.min(24 * 3600000, 3600000 * 2 ** (config.importRetryCount - 1));
  const delay = Math.max(backoff, Math.min(7 * 86400000, Number(error?.retryAfterMs) || 0));
  config.nextImportRetryAt = new Date(nowMs + delay).toISOString();
}

export function clearSourceRetry(config) {
  config.importRetryCount = 0;
  config.nextImportRetryAt = '';
}

export function summarizeSourceRetries(configs) {
  const pending = configs.filter(sourceNeedsRetry);
  return { count: pending.length, nextAttemptAt: pending.reduce((earliest, config) => {
    const at = config.nextImportRetryAt || new Date(0).toISOString();
    return !earliest || at < earliest ? at : earliest;
  }, '') };
}

export function importHasCoverageGaps(stats = {}) {
  return Number(stats.errors || 0) > 0 || Number(stats.partialBoards || 0) > 0;
}
