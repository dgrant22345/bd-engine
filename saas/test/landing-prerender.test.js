import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  canPrerenderLanding,
  extractLandingTemplate,
  insertPrerenderedLanding,
  landingPersonaForRequest,
  renderLandingHtml,
} from '../src/landing-prerender.js';

const indexHtml = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const params = (query) => new URLSearchParams(query);

test('the landing template in index.html renders on the server for both personas', () => {
  const staffing = renderLandingHtml(indexHtml, 'bd');
  assert.match(staffing, /<h1 class="hero-title" id="landing-title">/);
  assert.match(staffing, /Know which target accounts are/);
  assert.match(staffing, /id="pricing"/);
  assert.match(staffing, /id="faq"/);
  assert.match(staffing, /href="\/job-search" class="persona-option "/);

  const jobSeeker = renderLandingHtml(indexHtml, 'jobseeker');
  assert.match(jobSeeker, /Know which employers are/);
  assert.match(jobSeeker, /href="\/job-search" class="persona-option is-active" aria-current="page"/);

  for (const html of [staffing, jobSeeker]) {
    // Every interpolation resolved, and nothing executable was emitted.
    assert.doesNotMatch(html, /\$\{|undefined|\[object Object\]|NaN/);
    assert.doesNotMatch(html, /<script/i);
    assert.match(html, new RegExp(`&copy; ${new Date().getFullYear()} BD Engine`));
    assert.ok(html.length > 10000, 'expected the full landing page');
  }
});

test('the server-evaluated template region stays free of browser-only APIs', () => {
  const template = extractLandingTemplate(indexHtml);
  assert.doesNotMatch(template, /\b(document|window|localStorage|sessionStorage|navigator|fetch)\b/);
  assert.match(template, /root\.innerHTML = `/);
  assert.throws(() => extractLandingTemplate('<html></html>'), /markers were not found/);
});

test('pre-rendering is limited to signed-out requests that open on the landing page', () => {
  const base = { method: 'GET', hasSession: false };
  assert.equal(canPrerenderLanding({ ...base, searchParams: params('') }), true);
  assert.equal(canPrerenderLanding({ ...base, searchParams: params('utm_source=linkedin&utm_campaign=launch&ref=abc123') }), true);
  assert.equal(canPrerenderLanding({ ...base, method: 'HEAD', searchParams: params('') }), true);
  assert.equal(canPrerenderLanding({ ...base, searchParams: params('persona=jobseeker') }), true);

  // A session, or any parameter that can select another first view, opts out.
  assert.equal(canPrerenderLanding({ ...base, hasSession: true, searchParams: params('') }), false);
  assert.equal(canPrerenderLanding({ ...base, method: 'POST', searchParams: params('') }), false);
  for (const query of ['login=1', 'signup=1', 'legal=terms', 'reset=token', 'verify=token', 'intent=pro', 'anything=else']) {
    assert.equal(canPrerenderLanding({ ...base, searchParams: params(query) }), false, query);
  }
});

test('the pre-rendered persona matches the one the browser selects', () => {
  assert.equal(landingPersonaForRequest('/', params('')), 'bd');
  assert.equal(landingPersonaForRequest('/index.html', params('utm_source=x')), 'bd');
  assert.equal(landingPersonaForRequest('/job-search', params('')), 'jobseeker');
  assert.equal(landingPersonaForRequest('/job-search/', params('')), 'jobseeker');
  assert.equal(landingPersonaForRequest('/', params('persona=jobseeker')), 'jobseeker');
  // Mirrors getInitialSignupPersona() in the page script.
  assert.match(indexHtml, /pathname === '\/job-search'/);
  assert.match(indexHtml, /get\('persona'\) === 'jobseeker'/);
});

test('the rendered landing page is placed inside the shell root and flagged for the browser', () => {
  const shell = '<body><div id="cloud-root"></div><script>boot()</script></body>';
  const combined = insertPrerenderedLanding(shell, '<div class="landing">Price: $10 $& $1</div>');
  assert.equal(combined, '<body><div id="cloud-root" data-prerendered="landing"><div class="landing">Price: $10 $& $1</div></div><script>boot()</script></body>');
  assert.throws(() => insertPrerenderedLanding('<body></body>', '<p></p>'), /root element was not found/);
  // The page script keeps the server-rendered page instead of showing the loader.
  assert.match(indexHtml, /root\.dataset\.prerendered === 'landing'/);
  assert.match(indexHtml, /if \(serverRenderedLanding\) state\.view = 'landing';/);
});
