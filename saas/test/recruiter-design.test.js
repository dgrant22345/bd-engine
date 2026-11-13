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

test('Bold dark look: lime accent on a near-black ground, self-hosted display type', async () => {
  const [visual, workspace, html] = await Promise.all([asset('visual.css'), asset('workspace.css'), asset('index.html')]);
  const bold = visual.slice(visual.indexOf('/* ── Bold dark'));
  assert.match(bold, /\[data-theme="dark"\] \{[^}]*--bg: #0b0f14;[^}]*--accent: #c6f432;[^}]*--on-accent: #0b0f14;/);
  assert.match(workspace, /@font-face \{ font-family: 'Space Grotesk';[^}]*url\('\/fonts\/space-grotesk-latin-wght-normal\.woff2'\)/);
  assert.match(workspace, /--font-display: "Space Grotesk"/);
  assert.match(html, /<html lang="en" data-theme="dark"/);
  assert.doesNotMatch(`${visual}\n${workspace}`, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
});

test('signed-in bar follows the Bold look from one place', async () => {
  const site = name => readFile(new URL(`../public/${name}`, import.meta.url), 'utf8');
  const [brand, cloud] = await Promise.all([site('brand.css'), site('cloud.css')]);
  // brand.css loads after cloud.css, so any .cloud-shell rule there would put
  // the older navy and teal back over the Bold block.
  assert.doesNotMatch(brand, /\.cloud-shell/);
  const bold = cloud.slice(cloud.indexOf("/* Signed-in chrome follows the workspace's Bold dark look"));
  assert.match(bold, /\.cloud-shell \.cloud-topbar \{ background: #0b0f14;/);
  assert.match(bold, /\.cloud-shell \.brand-icon-xs svg rect \{ fill: #c6f432; \}/);
  assert.match(bold, /\.cloud-shell \.cloud-avatar \{ background: #232f17; color: #d8fa6b;/);
});
