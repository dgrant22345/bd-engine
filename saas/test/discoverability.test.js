import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const landingPath = new URL('../public/index.html', import.meta.url);
const checkerPath = new URL('../public/ats-checker.html', import.meta.url);
const guideIndexPath = new URL('../public/guides/index.html', import.meta.url);
const guideArticlePaths = [
  new URL('../public/guides/ats-job-board-coverage.html', import.meta.url),
  new URL('../public/guides/workday-job-search.html', import.meta.url),
  new URL('../public/guides/linkedin-connections-job-search.html', import.meta.url),
];
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
  assert.match(landing, /Know which employers are worth your next move/);
  assert.match(landing, /role, location, and keyword focus/);
  assert.match(landing, /mismatchedJobSeekerDemo/);
  assert.match(landing, />Audit career sites</);
  assert.doesNotMatch(landing, /isJobSeekerLanding\s*\?[^:]+data-demo-start/);
  assert.match(server, /getCloudIndexHtml\(res\.bdScriptNonce, 'jobseeker'\)/);
  assert.match(server, /bd-engine-production\.up\.railway\.app\/job-search/);
});

test('ATS checker is a crawlable no-signup utility with explicit caveats', async () => {
  const checker = await readFile(checkerPath, 'utf8');

  assert.match(checker, /<link rel="canonical" href="https:\/\/bd-engine-production\.up\.railway\.app\/ats-checker">/);
  assert.match(checker, /The check runs in your browser and does not fetch the submitted site/);
  assert.match(checker, /Try sample list/);
  assert.match(checker, /compatibility signal, not a coverage guarantee/);
  assert.match(checker, /<script type="module" src="\/ats-checker\.js"><\/script>/);
  assert.doesNotMatch(checker, /password|credit card/i);
});

test('guide library publishes crawlable first-party articles with tracked product paths', async () => {
  const [guideIndex, server, ...articles] = await Promise.all([
    readFile(guideIndexPath, 'utf8'),
    readFile(serverPath, 'utf8'),
    ...guideArticlePaths.map((path) => readFile(path, 'utf8')),
  ]);

  assert.match(guideIndex, /<link rel="canonical" href="https:\/\/bd-engine-production\.up\.railway\.app\/guides">/);
  assert.match(guideIndex, /\/guides\/ats-job-board-coverage/);
  assert.match(guideIndex, /\/guides\/workday-job-search/);
  assert.match(guideIndex, /\/guides\/linkedin-connections-job-search/);
  assert.match(server, /PUBLIC_GUIDE_FILES/);
  assert.match(server, /getGuideHtml\(guideFile, res\.bdScriptNonce\)/);

  for (const article of articles) {
    assert.match(article, /<meta name="robots" content="index, follow, max-image-preview:large">/);
    assert.match(article, /utm_source=organic_search&amp;utm_medium=guide/);
    const match = article.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/);
    assert.ok(match, 'Article JSON-LD was not found');
    const schema = JSON.parse(match[1]);
    assert.equal(schema['@type'], 'Article');
    assert.equal(schema.author['@type'], 'Organization');
    assert.equal(schema.author.name, 'BD Engine');
    assert.equal(schema.datePublished, '2026-08-24');
  }
});

test('guide claims keep compatibility, retrieval, relevance, and outreach consent distinct', async () => {
  const [coverage, workday, connections] = await Promise.all(
    guideArticlePaths.map((path) => readFile(path, 'utf8'))
  );

  assert.match(coverage, /Recognition is not retrieval/);
  assert.match(coverage, /role freshness, or scraping reliability/);
  assert.match(workday, /tenant identifier and a career-site identifier/);
  assert.match(workday, /Employer posting remains source of truth/);
  assert.match(connections, /Missing email is normal/);
  assert.match(connections, /Send no mass referral requests/);
  assert.match(connections, /linkedin\.com\/help\/linkedin\/answer\/a566336/);
});

test('landing attribution distinguishes campaigns and records acquisition actions', async () => {
  const [landing, server] = await Promise.all([
    readFile(landingPath, 'utf8'),
    readFile(serverPath, 'utf8'),
  ]);

  assert.match(landing, /utm_campaign/);
  assert.match(landing, /utm_content/);
  assert.match(landing, /bd_acquisition/);
  assert.match(landing, /firstTouch/);
  assert.match(landing, /lastNonDirectTouch/);
  assert.match(landing, /trackAcquisitionEvent\('signup_started'\)/);
  assert.match(landing, /trackAcquisitionEvent\('demo_started'\)/);
  assert.match(landing, /acquisition: state\.acquisition/);
  assert.match(server, /PUBLIC_ANALYTICS_EVENT_TYPES = new Set\(/);
  assert.match(server, /'ats_sample_used'/);
  assert.match(server, /'ats_audit_completed'/);
  assert.match(server, /buildAcquisitionDimensions\(acquisition/);
  const checkerScript = await readFile(new URL('../public/ats-checker.js', import.meta.url), 'utf8');
  assert.match(checkerScript, /firstTouch/);
  assert.match(checkerScript, /lastNonDirectTouch/);
  assert.match(checkerScript, /sampleSubmissionPending \? 'ats_sample_used' : 'ats_audit_completed'/);
  assert.match(checkerScript, /sampleSubmissionPending = false/);
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
  assert.match(sitemap, /<loc>https:\/\/bd-engine-production\.up\.railway\.app\/guides<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/bd-engine-production\.up\.railway\.app\/guides\/ats-job-board-coverage<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/bd-engine-production\.up\.railway\.app\/guides\/workday-job-search<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/bd-engine-production\.up\.railway\.app\/guides\/linkedin-connections-job-search<\/loc>/);
  assert.match(server, /getAtsCheckerHtml/);
  assert.match(server, /'\.txt': 'text\/plain; charset=utf-8'/);
  assert.match(server, /'\.xml': 'application\/xml; charset=utf-8'/);
  assert.equal(indexNowKey.trim(), '9252ff32fcf3a7589799d0826f50459b');
});
