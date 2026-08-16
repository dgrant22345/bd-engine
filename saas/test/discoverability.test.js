import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const landingPath = new URL('../public/index.html', import.meta.url);
const checkerPath = new URL('../public/ats-checker.html', import.meta.url);
const benchmarkPath = new URL('../public/staffing-ats-benchmark.html', import.meta.url);
const playbookPath = new URL('../public/staffing-bd-playbook.html', import.meta.url);
const indexNowKeyPath = new URL('../public/9252ff32fcf3a7589799d0826f50459b.txt', import.meta.url);
const robotsPath = new URL('../public/robots.txt', import.meta.url);
const sitemapPath = new URL('../public/sitemap.xml', import.meta.url);
const serverPath = new URL('../src/server.js', import.meta.url);

test('landing page publishes canonical and social discovery metadata', async () => {
  const landing = await readFile(landingPath, 'utf8');

  assert.match(landing, /<link rel="canonical" href="https:\/\/bd-engine-production\.up\.railway\.app\/">/);
  assert.match(landing, /<meta property="og:title"/);
  assert.match(landing, /<meta property="og:image" content="https:\/\/bd-engine-production\.up\.railway\.app\/bd-engine-logo\.png">/);
  assert.match(landing, /<meta name="twitter:card" content="summary">/);
  assert.match(landing, /<meta name="robots" content="index, follow, max-image-preview:large">/);
});

test('software application structured data is valid JSON with current public offers', async () => {
  const landing = await readFile(landingPath, 'utf8');
  const match = landing.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/);

  assert.ok(match, 'SoftwareApplication JSON-LD was not found');
  const schema = JSON.parse(match[1]);
  assert.equal(schema['@type'], 'SoftwareApplication');
  assert.equal(schema.url, 'https://bd-engine-production.up.railway.app/');
  assert.deepEqual(
    schema.offers.map(({ name, price, priceCurrency }) => ({ name, price, priceCurrency })),
    [
      { name: 'Job Seeker', price: '5', priceCurrency: 'USD' },
      { name: 'Sales Professional', price: '10', priceCurrency: 'USD' },
    ]
  );
});

test('job-seeker campaign route renders dedicated copy and avoids the staffing demo', async () => {
  const [landing, server] = await Promise.all([
    readFile(landingPath, 'utf8'),
    readFile(serverPath, 'utf8'),
  ]);

  assert.match(landing, /state\.signupPersona === 'jobseeker'/);
  assert.match(landing, /window\.location\.pathname === '\/job-search'/);
  assert.match(landing, /A focused job search/);
  assert.match(landing, /role, location, and keyword focus/);
  assert.match(landing, /mismatchedJobSeekerDemo/);
  assert.match(landing, /data-jobseeker-details/);
  assert.doesNotMatch(landing, /isJobSeekerLanding\s*\?[^:]+data-demo-start/);
  assert.match(server, /getCloudIndexHtml\(res\.bdScriptNonce, 'jobseeker'\)/);
  assert.match(server, /bd-engine-production\.up\.railway\.app\/job-search/);
});

test('ATS checker is a crawlable no-signup utility with explicit caveats', async () => {
  const checker = await readFile(checkerPath, 'utf8');

  assert.match(checker, /<link rel="canonical" href="https:\/\/bd-engine-production\.up\.railway\.app\/ats-checker">/);
  assert.match(checker, /The check runs in your browser and does not fetch the submitted site/);
  assert.match(checker, /compatibility signal, not a coverage guarantee/);
  assert.match(checker, /Shared links and PNG cards include aggregate counts only/);
  assert.match(checker, /staffing-ats-benchmark/);
  assert.match(checker, /staffing-bd-playbook/);
  assert.match(checker, /<script type="module" src="\/ats-checker\.js"><\/script>/);
  assert.doesNotMatch(checker, /password|credit card/i);
});

test('staffing ATS benchmark publishes a source-backed report and crawlable route metadata', async () => {
  const [benchmark, server] = await Promise.all([
    readFile(benchmarkPath, 'utf8'),
    readFile(serverPath, 'utf8'),
  ]);

  assert.match(benchmark, /BD Engine public ATS coverage benchmark/);
  assert.match(benchmark, /Executive Summary/);
  assert.match(benchmark, /Automatic import/);
  assert.match(benchmark, />401</);
  assert.match(benchmark, /not a claim that BD Engine independently re-verified every employer/);
  assert.match(benchmark, /bd-engine-ats-coverage-benchmark\.csv/);
  assert.match(server, /getStaffingAtsBenchmarkHtml/);
  assert.match(server, /rel="canonical" href="https:\/\/bd-engine-production\.up\.railway\.app\/staffing-ats-benchmark"/);
  assert.match(server, /"isBasedOn": "https:\/\/github\.com\/Kayvan-Zahiri\/state-of-ats-2026"/);
});

test('staffing BD playbook publishes focused article and FAQ discovery metadata', async () => {
  const [playbook, server] = await Promise.all([
    readFile(playbookPath, 'utf8'),
    readFile(serverPath, 'utf8'),
  ]);

  assert.match(playbook, /<link rel="canonical" href="https:\/\/bd-engine-production\.up\.railway\.app\/staffing-bd-playbook">/);
  assert.match(playbook, /A hiring-signal playbook for staffing business development/);
  assert.match(playbook, /"@type": "Article"/);
  assert.match(playbook, /"@type": "FAQPage"/);
  assert.match(playbook, /BD Engine does not auto-send outreach/);
  assert.match(server, /getStaffingBdPlaybookHtml/);
});

test('landing page exposes the free audit and explains the pre-outreach workflow', async () => {
  const landing = await readFile(landingPath, 'utf8');

  assert.match(landing, /Free ATS audit/);
  assert.match(landing, /From a target list to the next client conversation/);
  assert.match(landing, /BD Engine does not auto-send outreach/);
  assert.match(landing, /staffing-bd-playbook/);
  assert.match(landing, /staffing-ats-benchmark/);
});

test('landing attribution distinguishes campaigns and records acquisition actions', async () => {
  const [landing, server] = await Promise.all([
    readFile(landingPath, 'utf8'),
    readFile(serverPath, 'utf8'),
  ]);

  assert.match(landing, /utm_campaign/);
  assert.match(landing, /bd_acquisition/);
  assert.match(landing, /trackAcquisitionEvent\('signup_started'\)/);
  assert.match(landing, /trackAcquisitionEvent\('demo_started'\)/);
  assert.match(landing, /acquisition: state\.acquisition/);
  assert.match(server, /PUBLIC_ANALYTICS_EVENT_TYPES = new Set\(\['pageview', 'tool_used', 'example_loaded', 'share_created', 'demo_started', 'signup_started'\]\)/);
  assert.match(server, /buildAcquisitionSource\(acquisition\)/);
  assert.match(await readFile(new URL('../public/ats-checker.js', import.meta.url), 'utf8'), /trackCheckerEvent\('tool_used'\)/);
  assert.match(await readFile(new URL('../public/ats-checker.js', import.meta.url), 'utf8'), /trackCheckerEvent\('share_created'\)/);
  assert.match(await readFile(new URL('../public/ats-checker.js', import.meta.url), 'utf8'), /signup=1&persona=bd/);
  assert.match(landing, /getInitialAuditSummary/);
  assert.match(landing, /getRequestedUnauthenticatedView/);
});

test('crawler files point to the canonical public origin and have explicit MIME types', async () => {
  const [robots, sitemap, server, indexNowKey] = await Promise.all([
    readFile(robotsPath, 'utf8'),
    readFile(sitemapPath, 'utf8'),
    readFile(serverPath, 'utf8'),
    readFile(indexNowKeyPath, 'utf8'),
  ]);

  assert.match(robots, /Sitemap: https:\/\/bd-engine-production\.up\.railway\.app\/sitemap\.xml/);
  assert.match(robots, /Disallow: \/api\//);
  assert.match(sitemap, /<loc>https:\/\/bd-engine-production\.up\.railway\.app\/<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/bd-engine-production\.up\.railway\.app\/job-search<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/bd-engine-production\.up\.railway\.app\/ats-checker<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/bd-engine-production\.up\.railway\.app\/staffing-bd-playbook<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/bd-engine-production\.up\.railway\.app\/staffing-ats-benchmark<\/loc>/);
  assert.match(server, /getAtsCheckerHtml/);
  assert.match(server, /'\.csv': 'text\/csv; charset=utf-8'/);
  assert.match(server, /'\.txt': 'text\/plain; charset=utf-8'/);
  assert.match(server, /'\.xml': 'application\/xml; charset=utf-8'/);
  assert.equal(indexNowKey.trim(), '9252ff32fcf3a7589799d0826f50459b');
});
