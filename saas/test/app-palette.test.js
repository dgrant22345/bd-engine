import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const palettePath = new URL('../../app/palette.css', import.meta.url);
const stylesPath = new URL('../../app/styles.css', import.meta.url);
const appPath = new URL('../../app/app.js', import.meta.url);
const cloudStylesPath = new URL('../public/cloud.css', import.meta.url);
const atsStylesPath = new URL('../public/ats-checker.css', import.meta.url);

test('embedded app uses the accessible sapphire and cool-slate palette in both modes', async () => {
  const palette = await readFile(palettePath, 'utf8');

  assert.match(palette, /--bg:\s*#f8fafc/);
  assert.match(palette, /--ink:\s*#0f172a/);
  assert.match(palette, /--muted:\s*#475569/);
  assert.match(palette, /--accent:\s*#1d4ed8/);
  assert.match(palette, /--accent-fill:\s*#2563eb/);
  assert.match(palette, /--accent-soft:\s*#eff6ff/);

  const darkPalette = palette.slice(palette.indexOf('[data-theme="dark"]'));
  assert.match(darkPalette, /--bg:\s*#0b1120/);
  assert.match(darkPalette, /--surface:\s*#111827/);
  assert.match(darkPalette, /--text:\s*#f8fafc/);
  assert.match(darkPalette, /--muted:\s*#b8c4d6/);
  assert.match(darkPalette, /--accent:\s*#60a5fa/);
  assert.match(darkPalette, /--accent-fill:\s*#2563eb/);
  assert.match(darkPalette, /--on-accent:\s*#ffffff/);
});

test('palette refresh preserves semantic statuses and Light Dark System behavior', async () => {
  const [palette, styles, app] = await Promise.all([
    readFile(palettePath, 'utf8'),
    readFile(stylesPath, 'utf8'),
    readFile(appPath, 'utf8'),
  ]);

  assert.match(palette, /--success:\s*#187255/);
  assert.match(palette, /--warning:\s*#81520c/);
  assert.match(palette, /--danger:\s*#9c3240/);
  assert.match(app, /const order = \['light', 'dark', 'system'\]/);
  assert.match(app, /prefers-color-scheme:\s*dark/);
  assert.match(app, /effective === 'dark' \? '#0b1120' : '#f8fafc'/);
  assert.doesNotMatch(
    `${palette}\n${styles}`,
    /#(?:5a56d6|4844bd|9893ff|aaa6ff|0b746b|0f766e|58c7ba|1f63d8)/i,
  );
});

test('workspace, public, auth, and ATS surfaces share the sapphire/slate contract', async () => {
  const [palette, cloudStyles, atsStyles] = await Promise.all([
    readFile(palettePath, 'utf8'),
    readFile(cloudStylesPath, 'utf8'),
    readFile(atsStylesPath, 'utf8'),
  ]);
  const cloudPalette = cloudStyles.slice(cloudStyles.indexOf('/* Workspace chrome palette'));
  const atsPalette = atsStyles.slice(atsStyles.indexOf('/* Public utility refresh'));

  assert.match(palette, /--accent-fill:\s*#2563eb/);
  assert.match(cloudPalette, /--bg-base:\s*#0b1120/);
  assert.match(cloudPalette, /--accent:\s*#2563eb/);
  assert.match(cloudPalette, /--accent-hover:\s*#1d4ed8/);
  assert.match(cloudPalette, /--control-border:\s*#64748b/);
  assert.match(cloudPalette, /--landing-bg:\s*#f8fafc/);
  assert.match(cloudPalette, /--landing-ink:\s*#0f172a/);
  assert.match(cloudPalette, /--landing-accent:\s*#2563eb/);
  assert.match(cloudPalette, /--landing-border-strong:\s*#64748b/);
  assert.match(cloudPalette, /\.auth-page,[\s\S]*?--bg-base:\s*#f8fafc/);
  assert.match(atsPalette, /--accent:\s*#2563eb/);
  assert.match(atsPalette, /--control-border:\s*#64748b/);
  assert.doesNotMatch(
    `${palette}\n${cloudStyles}\n${atsStyles}`,
    /#(?:5a56d6|4844bd|9893ff|aaa6ff|6366f1|0b746b|0f766e|58c7ba|1f63d8)/i,
  );
});
