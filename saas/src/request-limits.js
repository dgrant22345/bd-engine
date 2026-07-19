const MIB = 1024 * 1024;

export function resolveRequestLimits(env = process.env) {
  const requestTimeoutMs = boundedPositiveInteger(env.BD_REQUEST_TIMEOUT_MS, 120_000, 5_000, 300_000);
  return Object.freeze({
    maxBodyBytes: boundedPositiveInteger(env.BD_MAX_BODY_BYTES, 20 * MIB, 1024, 100 * MIB),
    requestTimeoutMs,
    headersTimeoutMs: boundedPositiveInteger(
      env.BD_HEADERS_TIMEOUT_MS,
      Math.min(15_000, requestTimeoutMs),
      5_000,
      requestTimeoutMs,
    ),
    keepAliveTimeoutMs: boundedPositiveInteger(env.BD_KEEP_ALIVE_TIMEOUT_MS, 5_000, 1_000, 30_000),
    maxRequestsPerSocket: boundedPositiveInteger(env.BD_MAX_REQUESTS_PER_SOCKET, 1_000, 1, 10_000),
    maxHeadersCount: boundedPositiveInteger(env.BD_MAX_HEADERS_COUNT, 100, 20, 1_000),
  });
}

export function configureHttpServer(server, limits) {
  server.requestTimeout = limits.requestTimeoutMs;
  server.headersTimeout = limits.headersTimeoutMs;
  server.keepAliveTimeout = limits.keepAliveTimeoutMs;
  server.maxRequestsPerSocket = limits.maxRequestsPerSocket;
  server.maxHeadersCount = limits.maxHeadersCount;
}

export function assertDeclaredBodyWithinLimit(req, maxBodyBytes) {
  const raw = req?.headers?.['content-length'];
  if (raw === undefined) return;

  if (Array.isArray(raw) && raw.length !== 1) {
    throw requestError(400, 'Invalid Content-Length header.');
  }
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!/^\d+$/.test(String(value || ''))) {
    throw requestError(400, 'Invalid Content-Length header.');
  }

  const declaredBytes = Number(value);
  if (!Number.isSafeInteger(declaredBytes)) {
    throw requestError(400, 'Invalid Content-Length header.');
  }
  if (declaredBytes > maxBodyBytes) {
    throw requestError(413, 'Request body too large.');
  }
}

export function requestBodyTooLargeError() {
  return requestError(413, 'Request body too large.');
}

function boundedPositiveInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) return fallback;
  return parsed;
}

function requestError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
