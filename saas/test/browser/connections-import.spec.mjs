import { test, expect } from '@playwright/test';

// A workspace that has finished setup, opened on the People view.
async function workspace(page) {
  const email = `import-ux-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const response = await page.request.post('/api/auth/signup', { data: { email, password: 'Import-fixture-2026', name: 'Import Fixture', workspaceName: 'Import QA', persona: 'bd', legalAcceptance: { accepted: true, termsVersion: '2026-08-21', privacyVersion: '2026-08-21' } } });
  expect(response.ok()).toBeTruthy();
  expect((await page.request.post('/api/setup/complete', { data: { workspaceName: 'Import QA', userName: 'Import Fixture', userEmail: email, owners: [] } })).ok()).toBeTruthy();
  await page.goto('/');
  await expect(page.locator('iframe.cloud-app-frame')).toBeVisible();
  const app = page.frameLocator('iframe.cloud-app-frame');
  await expect.poll(() => page.frames().some((frame) => frame.url().includes('/app/'))).toBeTruthy();
  const frame = page.frames().find((candidate) => candidate.url().includes('/app/'));
  await frame.evaluate(() => { location.hash = '#/contacts'; });
  return { app, frame };
}

async function openImportDialog(app) {
  await app.locator('[data-action="open-network-import-modal"]:visible').first().click();
  await expect(app.locator('.network-import-dialog')).toBeVisible();
}

const file = (name, text, encoding = 'utf8') => ({ name, mimeType: 'text/csv', buffer: Buffer.from(text, encoding) });

test('the import dialog previews with the server rules and reports what was really imported', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  const { app, frame } = await workspace(page);
  await openImportDialog(app);

  // A semicolon-delimited, Windows-1252 file with localized column names.
  await app.locator('#network-modal-csv-input').setInputFiles(file(
    'kontakte.csv',
    'Vorname;Nachname;Firma;Position\r\nJos\u00e9;Mu\u00f1oz;Soci\u00e9t\u00e9 G\u00e9n\u00e9rale;Directeur des Ressources Humaines\r\nZo\u00eb;K\u00fchn;M\u00fcller GmbH;Recruiter\r\n;;Acme;Engineer',
    'latin1',
  ));
  const stats = app.locator('.network-stat-card');
  await expect(stats).toHaveCount(4);
  await expect(stats.nth(0)).toContainText('2');
  await expect(stats.nth(0)).toContainText('Connections in file');
  await expect(stats.nth(1)).toContainText('2');
  await expect(app.locator('.network-preview-note')).toContainText('2 new contacts will be added');
  await expect(app.locator('.network-preview-note')).toContainText('1 row without a name or company will be skipped');

  const run = app.locator('[data-action="network-modal-run-import"]');
  await expect(run).toBeEnabled();
  await run.click();
  const result = app.locator('.network-import-success-card');
  await expect(result).toContainText('Import complete', { timeout: 20000 });
  await expect(result.locator('.success-metric-box').nth(0)).toContainText('2');
  await expect(result.locator('.success-metric-box').nth(0)).toContainText('Contacts added');

  // The dialog stays on the page it was opened from, and the list behind it
  // already shows the imported people with their accents intact.
  await expect(app.locator('#setup-profile-form')).toHaveCount(0);
  expect(await frame.evaluate(() => location.hash)).toContain('#/contacts');
  await app.locator('[data-action="close-network-import-modal"]').first().click();
  await expect(app.getByText('Jos\u00e9 Mu\u00f1oz').first()).toBeVisible();
  // The company column, not the phone-only line under the name.
  await expect(app.locator('.people-company', { hasText: 'Soci\u00e9t\u00e9 G\u00e9n\u00e9rale' }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('the import dialog explains files it cannot use and imports nothing', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  const { app, frame } = await workspace(page);
  await openImportDialog(app);
  const problem = app.locator('.network-import-problem');
  const run = app.locator('[data-action="network-modal-run-import"]');

  await app.locator('#network-modal-csv-input').setInputFiles(file('colours.csv', 'Colour,Size\nRed,Large'));
  await expect(problem).toContainText('needs a name column and a Company column, but found: Colour, Size.');
  await expect(problem).toContainText('Nothing was imported.');
  await expect(run).toHaveCount(0);

  await app.locator('#network-modal-csv-input').setInputFiles(file('Connections.xlsx', 'PK not a csv'));
  await expect(problem).toContainText('That is a spreadsheet workbook.');
  await expect(run).toHaveCount(0);

  // Choosing a usable file afterwards clears the problem.
  await app.locator('#network-modal-csv-input').setInputFiles(file('Connections.csv', 'First Name,Last Name,Company,Position\nAna,Stone,Acme,VP Talent'));
  await expect(problem).toHaveCount(0);
  await expect(run).toBeEnabled();

  const total = await frame.evaluate(async () => (await (await fetch('/api/contacts?page=1&pageSize=1', { credentials: 'include' })).json()).total);
  expect(total).toBe(0);
  expect(errors).toEqual([]);
});
