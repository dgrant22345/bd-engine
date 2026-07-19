/**
 * CG-011: liveness vs readiness decisions.
 *
 * Liveness only proves the event loop responds — the route answers 200
 * unconditionally. Readiness is the deploy gate: in production a process
 * without durable persistence must fail closed (HTTP 503) instead of silently
 * serving from memory.
 */
export function getReadinessDecision({
  isProduction = false,
  startupComplete = false,
  startupError = '',
  dbEnabled = false,
  dbReady = false,
} = {}) {
  if (startupError) {
    return { ready: false, reason: `startup failed: ${startupError}` };
  }
  if (!startupComplete) {
    return { ready: false, reason: 'startup incomplete' };
  }
  if (isProduction) {
    if (!dbEnabled) {
      return { ready: false, reason: 'DATABASE_URL is not configured; in-memory persistence is not allowed in production' };
    }
    if (!dbReady) {
      return { ready: false, reason: 'database is not connected' };
    }
  }
  return { ready: true };
}

export function shouldLogReadinessFailure(decision = {}) {
  return decision.ready === false && decision.reason !== 'startup incomplete';
}
