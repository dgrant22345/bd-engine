import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Script } from 'node:vm';

const asset = name => readFile(new URL(`../../app/${name}`, import.meta.url), 'utf8');

test('recruiter workspace assets parse and share the shell cache version', async () => {
  const [people, html, worker] = await Promise.all([asset('people-workspace.js'), asset('index.html'), asset('sw.js')]);
  assert.doesNotThrow(() => new Script(people));
  const version = worker.match(/ASSET_VERSION = '([^']+)'/)[1];
  for (const file of ['app.js', 'local-api.js', 'saved-work.js', 'people-workspace.js', 'styles.css', 'palette.css', 'workspace.css']) {
    assert.ok(html.includes(`/${file}?v=${version}`), `${file} needs a matching cache version`);
    assert.ok(worker.includes(`/${file}?v=`), `${file} must be in the offline shell`);
  }
  assert.ok(html.indexOf('/people-workspace.js?') < html.indexOf('/app.js?'));
});

test('people review keeps unsupported assessment and outreach claims out of defaults', async () => {
  const people = await asset('people-workspace.js');
  assert.match(people, /No candidate fit assessment has been made/);
  assert.match(people, /Saving and copying do not send anything/);
  assert.match(people, /Replace the placeholders/);
  assert.match(people, /I already sent this message outside the app/);
  assert.doesNotMatch(people, /pre-vetted|Verified & Available|\/api\/bootstrap/);
});

test('workspace copy stays plain: no decorative emoji and no combat metaphors', async () => {
  // Arrows, check marks, crosses and geometric shapes are functional and allowed.
  const decorative = /(?![←-⇿■-◿✓-✖©®™])\p{Extended_Pictographic}/gu;
  for (const file of ['app.js', 'index.html', 'people-workspace.js', 'workflow-tools.js', 'saved-work.js']) {
    const source = await asset(file);
    assert.deepEqual([...new Set(source.match(decorative) || [])], [], `${file} contains decorative emoji`);
    // Emoji written as numeric character references (search glass, high-voltage sign).
    assert.doesNotMatch(source, /&#(?:9889|1[0-9]{5}|x1F[0-9A-Fa-f]{3});/, `${file} contains an emoji character reference`);
    assert.doesNotMatch(source, /Battle Board|Battle Plan|Battle Card|Strike Zone|Cross-Hunt|Cold Surge|\bDossier\b|1-Click|White-glove|High-Conviction|Viral share/, `${file} contains hype wording`);
  }
  const [app, html] = await Promise.all([asset('app.js'), asset('index.html')]);
  assert.match(app, /Account priority matrix/);
  assert.match(app, /Q1: Warm and hiring/);
  assert.match(html, /<strong>Daily plan<\/strong>/);
});

test('Refined teal look: light by default, white sidebar, flat teal accent, self-hosted Inter', async () => {
  const [visual, workspace, html] = await Promise.all([asset('visual.css'), asset('workspace.css'), asset('index.html')]);
  const teal = visual.slice(visual.indexOf('/* ── Refined teal'));
  assert.ok(teal.length > 100, 'Refined teal block present, last in visual.css');
  assert.match(teal, /:root:not\(\[data-theme="dark"\]\) \{[^}]*--bg: #f3f6f7;[^}]*--sidebar-bg: #fff;[^}]*--radius: 8px;/);
  assert.match(workspace, /:root, \[data-theme="light"\] \{[^}]*--accent: #0f6b65;[^}]*--on-accent: #fff;/);
  assert.match(workspace, /\[data-theme="dark"\] \{[^}]*--bg: #10191f;[^}]*--accent: #80d4c5;/);
  assert.match(workspace, /@font-face \{ font-family: 'Inter';[^}]*url\('\/fonts\/inter-latin-wght-normal\.woff2'\)/);
  assert.match(html, /<html lang="en" data-theme="light"/);
  // The Bold dark look is gone everywhere in the workspace.
  assert.doesNotMatch(`${visual}\n${workspace}`, /#c6f432|#0b0f14|Space Grotesk|fonts\.googleapis\.com|fonts\.gstatic\.com/i);
});

test('signed-in bar follows the Refined teal look from one place', async () => {
  const site = name => readFile(new URL(`../public/${name}`, import.meta.url), 'utf8');
  const [brand, cloud] = await Promise.all([site('brand.css'), site('cloud.css')]);
  // brand.css loads after cloud.css, so any .cloud-shell rule there would
  // override the shell rules below.
  assert.doesNotMatch(brand, /\.cloud-shell/);
  const teal = cloud.slice(cloud.indexOf('/* Refined teal (November 2026)'));
  assert.match(teal, /\.cloud-shell \.brand-icon-xs svg rect \{ fill: #0f6b65; \}/);
  assert.match(teal, /\.cloud-shell \.cloud-avatar \{ background: #234449; color: #b8f4e9;/);
  assert.doesNotMatch(cloud, /#c6f432|#d8fa6b|#232f17/i);
});

test('public pages keep the light navy-and-teal palette and a flat teal mark', async () => {
  const site = name => readFile(new URL(`../public/${name}`, import.meta.url), 'utf8');
  const [brand, mark, landing, ats, notFound, guides] = await Promise.all([
    site('brand.css'), site('brand-mark.svg'), site('index.html'), site('ats-checker.html'), site('404.html'), site('guides/index.html'),
  ]);
  assert.doesNotMatch(brand, /Bold dark|--bold-|#c6f432|Space Grotesk/i);
  assert.match(brand, /\.public-premium \{ color-scheme: light;[^}]*--accent: #0f6b65;/);
  assert.match(mark, /<rect width="48" height="48" rx="10" fill="#0f6b65"\/>/);
  for (const html of [landing, ats, notFound, guides]) assert.match(html, /<meta name="theme-color" content="#f(?:8fafc|3f6fa)">/);
});
