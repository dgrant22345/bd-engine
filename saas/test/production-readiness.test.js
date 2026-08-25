import test from 'node:test';
import assert from 'node:assert/strict';

import { assessProductionReadiness, isCommercialCheckoutReady } from '../src/production-readiness.js';

const completeEnvironment = {
  DATABASE_URL: 'postgres://example.invalid/database',
  BD_CLOUD_BASE_URL: 'https://app.example.invalid',
  SESSION_SECRET: 'a'.repeat(48),
  STRIPE_SECRET_KEY: 'sk_live_configured',
  STRIPE_WEBHOOK_SECRET: 'whsec_configured',
  STRIPE_PRICE_JOBSEEKER: 'price_jobseeker',
  STRIPE_PRICE_SALES: 'price_sales',
  RESEND_API_KEY: 're_configured',
  BD_EMAIL_FROM: 'configured@example.invalid',
  BD_SUPPORT_ADMIN_EMAILS: 'support@example.invalid',
  BD_ERROR_WEBHOOK: 'https://example.invalid/hook',
  BD_BACKUP_ENCRYPTION_KEY: `base64:${Buffer.alloc(32, 9).toString('base64')}`,
  BD_ATS_RENDER_SERVICE_URL: 'http://renderer.internal',
  BD_ATS_RENDER_SERVICE_TOKEN: 'r'.repeat(48),
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
  assert.ok(result.errors.some((message) => message.startsWith('BD_BACKUP_ENCRYPTION_KEY:')));
  assert.ok(result.errors.some((message) => message.startsWith('BD_REQUIRE_EMAIL_VERIFICATION:')));
});

test('commercial configuration rejects malformed backup encryption keys', () => {
  const result = assessProductionReadiness({
    ...completeEnvironment,
    BD_BACKUP_ENCRYPTION_KEY: 'not-a-32-byte-key',
  });
  assert.equal(result.ready, false);
  assert.ok(result.errors.some((message) => message.includes('exactly 32 random bytes')));
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

test('commercial configuration rejects placeholders and unsafe service destinations', () => {
  const result = assessProductionReadiness({
    ...completeEnvironment,
    STRIPE_SECRET_KEY: 'sk_test_placeholder',
    STRIPE_PRICE_SALES: 'placeholder',
    BD_EMAIL_FROM: 'not-an-email',
    BD_SUPPORT_ADMIN_EMAILS: 'valid@example.com, invalid',
    BD_ERROR_WEBHOOK: 'http://alerts.example.com/hook',
    BD_CLOUD_BASE_URL: 'https://operator:secret@app.example.com',
  });
  assert.equal(result.ready, false);
  assert.ok(result.errors.some((message) => message.startsWith('STRIPE_SECRET_KEY:')));
  assert.ok(result.errors.some((message) => message.startsWith('STRIPE_PRICE_SALES:')));
  assert.ok(result.errors.some((message) => message.startsWith('BD_EMAIL_FROM:')));
  assert.ok(result.errors.some((message) => message.startsWith('BD_SUPPORT_ADMIN_EMAILS:')));
  assert.ok(result.errors.some((message) => message.startsWith('BD_ERROR_WEBHOOK:')));
  assert.ok(result.errors.some((message) => message.startsWith('BD_CLOUD_BASE_URL:')));
});

test('complete production configuration passes without exposing values', () => {
  const result = assessProductionReadiness(completeEnvironment);
  assert.deepEqual(result, { ready: true, errors: [], warnings: [] });
});

test('production checkout stays closed until every commercial dependency is ready', () => {
  assert.equal(isCommercialCheckoutReady({ NODE_ENV: 'development' }), true);
  assert.equal(isCommercialCheckoutReady({ RAILWAY_ENVIRONMENT: 'production' }), false);
  assert.equal(isCommercialCheckoutReady({
    ...completeEnvironment,
    RAILWAY_ENVIRONMENT: 'production',
  }), true);
});
