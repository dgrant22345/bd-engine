import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const landingPath = new URL('../public/index.html', import.meta.url);
const checkerPath = new URL('../public/ats-checker.js', import.meta.url);
const appPath = new URL('../../app/app.js', import.meta.url);

test('anonymous onboarding handoffs are tab-scoped before authentication', async () => {
  const [landing, checker] = await Promise.all([
    readFile(landingPath, 'utf8'),
    readFile(checkerPath, 'utf8'),
  ]);

  assert.match(checker, /sessionStorage\.setItem\(ONBOARDING_INTENT_STORAGE_KEY/);
  assert.match(checker, /localStorage\.removeItem\(ONBOARDING_INTENT_STORAGE_KEY/);
  assert.match(landing, /writeAnonymousOnboardingIntent/);
  assert.match(landing, /sessionStorage\.setItem\(ONBOARDING_INTENT_STORAGE_KEY/);
  assert.match(landing, /localStorage\.removeItem\(ONBOARDING_INTENT_STORAGE_KEY/);
});

test('authenticated onboarding intent is migrated to the active user and tenant scope', async () => {
  const [landing, app] = await Promise.all([
    readFile(landingPath, 'utf8'),
    readFile(appPath, 'utf8'),
  ]);

  assert.match(landing, /ONBOARDING_INTENT_SCOPED_PREFIX/);
  assert.match(landing, /getAuthenticatedOnboardingIntentScope/);
  assert.match(landing, /activateAuthenticatedOnboardingIntent\(\)/);
  assert.match(landing, /intentScope=\$\{encodeURIComponent\(onboardingIntentScope\)\}/);
  assert.match(app, /get\('intentScope'\)/);
  assert.match(app, /ONBOARDING_INTENT_ANONYMOUS_KEY.*onboardingIntentScope/s);
});

test('public auth copy matches implemented legal and password behavior', async () => {
  const landing = await readFile(landingPath, 'utf8');

  assert.match(landing, /Material changes to these Terms will be published with an updated version and effective date\./);
  assert.doesNotMatch(landing, /acceptance before they apply to future use/);
  assert.match(landing, /Use at least 10 characters\./);
  assert.doesNotMatch(landing, /Use at least 6 characters\./);
});
