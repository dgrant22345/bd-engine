import test from 'node:test';
import assert from 'node:assert/strict';

import { assessProductionReadiness } from '../src/production-readiness.js';

const completeEnvironment = {
  DATABASE_URL: 'postgres://example.invalid/database',
  SESSION_SECRET: 'a'.repeat(48),
  STRIPE_SECRET_KEY: 'configured',
  STRIPE_WEBHOOK_SECRET: 'configured',
  STRIPE_PRICE_JOBSEEKER: 'configured',
  STRIPE_PRICE_SALES: 'configured',
  RESEND_API_KEY: 'configured',
  BD_EMAIL_FROM: 'configured@example.invalid',
  BD_SUPPORT_ADMIN_EMAILS: 'support@example.invalid',
  BD_ERROR_WEBHOOK: 'https://example.invalid/hook',
  BD_ATS_RENDER_SERVICE_URL: 'http://renderer.internal',
  BD_ATS_RENDER_SERVICE_TOKEN: 'configured',
  BD_RELATIONAL_WRITE_NEW_TENANTS: 'true',
  BD_RELATIONAL_DEEP_CHECK_TENANTS: 'tenant-canary',
  BD_REQUIRE_EMAIL_VERIFICATION: 'true',
};

test('commercial configuration identifies missing customer-critical services', () => {
  const result = assessProductionReadiness({ SESSION_SECRET: 'short' });
  assert.equal(result.ready, false);
  assert.ok(result.errors.some((message) => message.startsWith('DATABASE_URL:')));
  assert.ok(result.errors.some((message) => message.includes('at least 32 characters')));
  assert.ok(result.errors.some((message) => message.startsWith('STRIPE_WEBHOOK_SECRET:')));
  assert.ok(result.errors.some((message) => message.startsWith('BD_REQUIRE_EMAIL_VERIFICATION:')));
});

test('commercial configuration rejects paired renderer and unsafe debug mistakes', () => {
  const result = assessProductionReadiness({
    ...completeEnvironment,
    BD_ATS_RENDER_SERVICE_TOKEN: '',
    BD_EXPOSE_RESET_TOKEN: 'true',
  });
  assert.equal(result.ready, false);
  assert.ok(result.errors.some((message) => message.startsWith('BD_ATS_RENDER_SERVICE_URL/')));
  assert.ok(result.errors.some((message) => message.startsWith('BD_EXPOSE_RESET_TOKEN:')));
});

test('complete production configuration passes without exposing values', () => {
  const result = assessProductionReadiness(completeEnvironment);
  assert.deepEqual(result, { ready: true, errors: [], warnings: [] });
});
