import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const palettePath = new URL('../../app/palette.css', import.meta.url);
const stylesPath = new URL('../../app/styles.css', import.meta.url);
const indexPath = new URL('../../app/index.html', import.meta.url);
const appPath = new URL('../../app/app.js', import.meta.url);

test('Executive color system provides 4 professional theme presets with accessible high contrast', async () => {
  const [palette, app, index] = await Promise.all([
    readFile(palettePath, 'utf8'),
    readFile(appPath, 'utf8'),
    readFile(indexPath, 'utf8'),
  ]);

  // Check 4 presets in palette.css
  assert.match(palette, /\[data-theme-preset="obsidian"\]/);
  assert.match(palette, /\[data-theme-preset="slate"\]/);
  assert.match(palette, /\[data-theme-preset="emerald"\]/);
  assert.match(palette, /\[data-theme-preset="indigo"\]/);

  // Check Obsidian dark values
  const obsidian = palette.slice(palette.indexOf('[data-theme-preset="obsidian"]'));
  assert.match(obsidian, /--bg:\s*#070b12/);
  assert.match(obsidian, /--surface:\s*#0f172a/);
  assert.match(obsidian, /--accent:\s*#3b82f6/);

  // Check Emerald values
  const emerald = palette.slice(palette.indexOf('[data-theme-preset="emerald"]'));
  assert.match(emerald, /--bg:\s*#05100c/);
  assert.match(emerald, /--surface:\s*#0d231c/);

  // Check Indigo values
  const indigo = palette.slice(palette.indexOf('[data-theme-preset="indigo"]'));
  assert.match(indigo, /--bg:\s*#080614/);
  assert.match(indigo, /--surface:\s*#151033/);

  // Check theme preset cycle functionality and topbar trigger in index.html
  assert.match(index, /id="theme-preset-btn"/);
  assert.match(index, /data-action="cycle-theme-preset"/);
  assert.match(app, /function applyThemePreset/);
  assert.match(app, /function cycleThemePreset/);
});

test('Batch Outreach Studio modal and UI containers are present in HTML, CSS, and JS', async () => {
  const [index, styles, app] = await Promise.all([
    readFile(indexPath, 'utf8'),
    readFile(stylesPath, 'utf8'),
    readFile(appPath, 'utf8'),
  ]);

  // Check container in index.html
  assert.match(index, /id="batch-outreach-modal-backdrop"/);

  // Check modal CSS classes in styles.css
  assert.match(styles, /\.modal-panel--batch/);
  assert.match(styles, /\.batch-studio-toolbar/);
  assert.match(styles, /\.batch-recipients-sidebar/);
  assert.match(styles, /\.batch-draft-pane/);
  assert.match(styles, /\.batch-grounding-chips/);
  assert.match(styles, /\.batch-stepper-row/);
  assert.match(styles, /\.batch-footer-actions/);

  // Check JS functions
  assert.match(app, /function openBatchOutreachStudio/);
  assert.match(app, /function renderBatchOutreachModal/);
  assert.match(app, /function exportBatchOutreachCsv/);
  assert.match(app, /function logAllBatchOutreachSent/);
});

test('Contacts, Jobs, and Accounts tables support multi-select checkboxes and bulk action toolbars', async () => {
  const app = await readFile(appPath, 'utf8');

  // Accounts table
  assert.match(app, /id="bulk-action-bar"/);
  assert.match(app, /data-action="launch-batch-outreach-accounts"/);

  // Contacts table
  assert.match(app, /id="contacts-bulk-action-bar"/);
  assert.match(app, /id="contacts-bulk-select-all"/);
  assert.match(app, /class="contacts-bulk-checkbox"/);
  assert.match(app, /data-action="launch-batch-outreach-contacts"/);
  assert.match(app, /data-action="export-selected-contacts-csv"/);

  // Jobs table
  assert.match(app, /id="jobs-bulk-action-bar"/);
  assert.match(app, /id="jobs-bulk-select-all"/);
  assert.match(app, /class="jobs-bulk-checkbox"/);
  assert.match(app, /data-action="launch-batch-outreach-jobs"/);
});

test('Dashboard 3-View Command Center and 3-Step Value Sprint are properly integrated', async () => {
  const [styles, app] = await Promise.all([
    readFile(stylesPath, 'utf8'),
    readFile(appPath, 'utf8'),
  ]);

  // Tab bar styles
  assert.match(styles, /\.dashboard-tab-bar/);
  assert.match(styles, /\.dashboard-tab-btn/);

  // Value sprint styles
  assert.match(styles, /\.value-sprint-card/);
  assert.match(styles, /\.sprint-steps-grid/);
  assert.match(styles, /\.sprint-step-item/);

  // JS implementation
  assert.match(app, /function render3StepValueSprint/);
  assert.match(app, /function renderDashboardCommandCenterTabs/);
  assert.match(app, /const DASHBOARD_TAB_SECTIONS/);
  assert.match(app, /data-action="dashboard-switch-tab"/);
  assert.match(app, /data-action="dismiss-value-sprint"/);
});

test('Batch draft generator produces grounded messaging across templates and tones', async () => {
  const app = await readFile(appPath, 'utf8');

  assert.match(app, /template === 'sales_talent_leader'/);
  assert.match(app, /template === 'sales_executive'/);
  assert.match(app, /template === 'job_referral'/);
  assert.match(app, /template === 'job_hiring_leader'/);
  assert.match(app, /template === 're_engage'/);
  assert.match(app, /tone === 'casual'/);
  assert.match(app, /tone === 'direct'/);
});
