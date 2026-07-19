import assert from 'node:assert/strict';
import test from 'node:test';
import { assertDeclaredBodyWithinLimit, configureHttpServer, requestBodyTooLargeError, resolveRequestLimits } from '../src/request-limits.js';

test('request limits use commercial-safe defaults and bounded overrides', () => {
  assert.deepEqual(resolveRequestLimits({}), {
    maxBodyBytes: 20 * 1024 * 1024,
    requestTimeoutMs: 120_000,
    headersTimeoutMs: 15_000,
    keepAliveTimeoutMs: 5_000,
    maxRequestsPerSocket: 1_000,
    maxHeadersCount: 100,
  });

  const limits = resolveRequestLimits({
    BD_MAX_BODY_BYTES: '1048576',
    BD_REQUEST_TIMEOUT_MS: '60000',
    BD_HEADERS_TIMEOUT_MS: '10000',
    BD_KEEP_ALIVE_TIMEOUT_MS: '2500',
    BD_MAX_REQUESTS_PER_SOCKET: '50',
    BD_MAX_HEADERS_COUNT: '40',
  });
  assert.equal(limits.maxBodyBytes, 1_048_576);
  assert.equal(limits.requestTimeoutMs, 60_000);
  assert.equal(limits.headersTimeoutMs, 10_000);
  assert.equal(limits.keepAliveTimeoutMs, 2_500);
  assert.equal(limits.maxRequestsPerSocket, 50);
  assert.equal(limits.maxHeadersCount, 40);

  assert.equal(resolveRequestLimits({ BD_MAX_BODY_BYTES: '0' }).maxBodyBytes, 20 * 1024 * 1024);
  assert.equal(resolveRequestLimits({ BD_REQUEST_TIMEOUT_MS: '999999' }).requestTimeoutMs, 120_000);
  assert.equal(resolveRequestLimits({ BD_REQUEST_TIMEOUT_MS: '5000' }).headersTimeoutMs, 5_000);
});

test('declared request bodies are rejected before they are streamed', () => {
  assert.doesNotThrow(() => assertDeclaredBodyWithinLimit({ headers: {} }, 100));
  assert.doesNotThrow(() => assertDeclaredBodyWithinLimit({ headers: { 'content-length': '100' } }, 100));
  assert.throws(
    () => assertDeclaredBodyWithinLimit({ headers: { 'content-length': '101' } }, 100),
    (error) => error.status === 413 && error.message === 'Request body too large.',
  );
  assert.throws(
    () => assertDeclaredBodyWithinLimit({ headers: { 'content-length': 'unknown' } }, 100),
    (error) => error.status === 400 && error.message === 'Invalid Content-Length header.',
  );
  assert.throws(
    () => assertDeclaredBodyWithinLimit({ headers: { 'content-length': ['10', '20'] } }, 100),
    (error) => error.status === 400 && error.message === 'Invalid Content-Length header.',
  );
});

test('streamed body errors and server limits retain their expected status and values', () => {
  const error = requestBodyTooLargeError();
  assert.equal(error.status, 413);

  const server = {};
  const limits = resolveRequestLimits({});
  configureHttpServer(server, limits);
  assert.equal(server.requestTimeout, 120_000);
  assert.equal(server.headersTimeout, 15_000);
  assert.equal(server.keepAliveTimeout, 5_000);
  assert.equal(server.maxRequestsPerSocket, 1_000);
  assert.equal(server.maxHeadersCount, 100);
});
