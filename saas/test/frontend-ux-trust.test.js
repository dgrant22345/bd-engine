import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const landingPath = new URL('../public/index.html', import.meta.url);
const cloudStylesPath = new URL('../public/cloud.css', import.meta.url);
const atsStylesPath = new URL('../public/ats-checker.css', import.meta.url);
const appPath = new URL('../../app/app.js', import.meta.url);

test('partial commercial-result failures prevent duplicate activity resubmission', async () => {
  const app = await readFile(appPath, 'utf8');
  assert.match(app, /Activity saved, but its commercial result was not recorded\./);
  assert.match(app, /Do not submit it again\./);
  assert.match(app, /Open Support from the account menu/);
  assert.doesNotMatch(app, /Review the entry and try again\./);
});

test('signup presents legal consent with accessible document structure', async () => {
  const [landing, cloudStyles] = await Promise.all([
    readFile(landingPath, 'utf8'),
    readFile(cloudStylesPath, 'utf8'),
  ]);
  assert.match(landing, /<main class="auth-page" aria-labelledby="signup-title">/);
  assert.match(landing, /<h1 id="signup-title" tabindex="-1">Create your account<\/h1>/);
  assert.match(landing, /<div class="auth-consent">[\s\S]*?<label for="signup-legal-consent">/);
  assert.match(landing, /<p class="auth-consent__links" id="signup-legal-links"><a [^>]*>Open Terms<\/a>/);
  assert.doesNotMatch(landing, /<label class="auth-consent"[\s\S]*?<a /);
  assert.match(cloudStyles, /\.auth-header h1,[\s\S]*?font-size:\s*24px/);
  assert.match(cloudStyles, /\.auth-consent\s*\{[\s\S]*?font-size:\s*0\.875rem/);
});

test('public handoff, referral, pricing, and focus copy remain honest and actionable', async () => {
  const [landing, atsStyles] = await Promise.all([
    readFile(landingPath, 'utf8'),
    readFile(atsStylesPath, 'utf8'),
  ]);
  assert.match(landing, /intent\.source === 'ats-checker'/);
  assert.match(landing, /\['setup-deferred', 'setup-skipped'\]\.includes\(intent\.source\)/);
  assert.match(landing, /saved \$\{targetLabel\} found/);
  assert.match(landing, /Referral code \$\{escapeHtml\(state\.referralCode\)\} detected\./);
  assert.match(landing, /It will be validated when you create the workspace\./);
  assert.doesNotMatch(landing, /Referral from \$\{escapeHtml\(state\.referralCode\)\} recorded\./);
  assert.match(landing, /if \(kind === 'terms'\)[\s\S]*?returnToPricing\(\)/);
  assert.match(landing, /nextUrl\.hash = 'pricing'/);
  assert.match(landing, /pricingTitle\?\.focus/);
  assert.match(atsStyles, /\.checker-result:focus-visible\s*\{\s*outline:\s*3px solid var\(--accent\)/);
  assert.doesNotMatch(atsStyles, /outline:\s*3px solid rgba\(90, 86, 214, 0\.34\)/);
});
