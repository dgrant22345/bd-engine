import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const landingPath = new URL('../public/index.html', import.meta.url);
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
  const landing = await readFile(landingPath, 'utf8');

  assert.match(landing, /state\.signupPersona === 'jobseeker'/);
  assert.match(landing, /A focused job search/);
  assert.match(landing, /role, location, and keyword focus/);
  assert.match(landing, /mismatchedJobSeekerDemo/);
  assert.match(landing, /data-jobseeker-details/);
  assert.doesNotMatch(landing, /isJobSeekerLanding\s*\?[^:]+data-demo-start/);
});

test('crawler files point to the canonical public origin and have explicit MIME types', async () => {
  const [robots, sitemap, server] = await Promise.all([
    readFile(robotsPath, 'utf8'),
    readFile(sitemapPath, 'utf8'),
    readFile(serverPath, 'utf8'),
  ]);

  assert.match(robots, /Sitemap: https:\/\/bd-engine-production\.up\.railway\.app\/sitemap\.xml/);
  assert.match(robots, /Disallow: \/api\//);
  assert.match(sitemap, /<loc>https:\/\/bd-engine-production\.up\.railway\.app\/<\/loc>/);
  assert.match(server, /'\.txt': 'text\/plain; charset=utf-8'/);
  assert.match(server, /'\.xml': 'application\/xml; charset=utf-8'/);
});
