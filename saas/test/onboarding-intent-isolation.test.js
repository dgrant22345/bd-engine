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
  assert.match(landing, /hasExplicitOnboardingHandoff/);
  assert.match(landing, /\['ats-checker', 'pricing'\]\.includes\(intent\.source\)/);
  assert.doesNotMatch(landing, /stored\s*=\s*readStoredOnboardingIntent\(localStorage, ONBOARDING_INTENT_STORAGE_KEY\)/);
});

test('authenticated onboarding intent uses an opaque user and tenant scope', async () => {
  const [landing, app] = await Promise.all([
    readFile(landingPath, 'utf8'),
    readFile(appPath, 'utf8'),
  ]);

  assert.match(landing, /ONBOARDING_INTENT_SCOPED_PREFIX = `\$\{ONBOARDING_INTENT_STORAGE_KEY\}:v2:`/);
  assert.match(landing, /subtle\.digest\('SHA-256'/);
  assert.match(landing, /getAuthenticatedOnboardingIntentScope/);
  assert.match(landing, /await activateAuthenticatedOnboardingIntent\(\)/);
  assert.match(landing, /intentScope=\$\{encodeURIComponent\(onboardingIntentScope\)\}/);
  assert.match(app, /get\('intentScope'\)/);
  assert.match(app, /ONBOARDING_INTENT_SCOPED_PREFIX.*onboardingIntentScope/s);
  assert.match(app, /\^\[a-zA-Z0-9_-\]\{20,86\}\$/);
  assert.match(app, /hasOnboardingIntentScope\s*\?\s*''/s);
});

test('scoped intent lifecycle sweeps invalid data and preserves privacy boundaries', async () => {
  const landing = await readFile(landingPath, 'utf8');

  assert.match(landing, /function sweepStoredOnboardingIntents\(\)/);
  assert.match(landing, /age >= -ONBOARDING_INTENT_CLOCK_SKEW_MS/);
  assert.match(landing, /sweepStoredOnboardingIntents\(\);[\s\S]*state\.user = null/);
  assert.match(landing, /await clearAuthenticatedOnboardingIntentsForUser\(state\.user, state\.tenants\)/);
  assert.match(landing, /frame\.src = onboardingIntentScope[\s\S]*intentScope=\$\{encodeURIComponent\(onboardingIntentScope\)\}#\/admin\/billing/);
  assert.match(landing, /function getSanitizedSupportPageUrl\(frame\)/);
  assert.match(landing, /page\.search = ''/);
  assert.match(landing, /pageUrl = getSanitizedSupportPageUrl\(frame\)/);
});

test('public auth copy matches implemented legal and password behavior', async () => {
  const landing = await readFile(landingPath, 'utf8');

  assert.match(landing, /Material changes to these Terms will be published with an updated version and effective date\./);
  assert.doesNotMatch(landing, /acceptance before they apply to future use/);
  assert.match(landing, /Use at least 10 characters\./);
  assert.doesNotMatch(landing, /Use at least 6 characters\./);
});
