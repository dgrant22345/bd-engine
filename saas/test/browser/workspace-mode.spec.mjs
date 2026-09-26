import { test, expect } from '@playwright/test';

async function workspace(page) {
  const email = `mode-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  expect((await page.request.post('/api/auth/signup', { data: { email, password: 'Mode-fixture-2026!', name: 'Mode QA', workspaceName: 'Mode QA', persona: 'bd', legalAcceptance: { accepted: true, termsVersion: '2026-08-21', privacyVersion: '2026-08-21' } } })).ok()).toBeTruthy();
  expect((await page.request.post('/api/setup/complete', { data: { workspaceName: 'Mode QA', userName: 'Mode QA', userEmail: email, owners: [] } })).ok()).toBeTruthy();
  const person = await (await page.request.post('/api/contacts', { data: { fullName: 'Mode Test Person', notes: 'Saved note' } })).json();
  await page.goto(`/app/#/contacts?person=${person.id}`);
  await expect(page.locator('#person-heading')).toHaveText('Mode Test Person');
}

test('mode switch survives blocked browser storage and preserves the active People editor', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === 'bd_persona') throw new DOMException('Storage unavailable', 'SecurityError');
      return original.call(this, key, value);
    };
  });
  await workspace(page);
  const notes = page.locator('[name="notes"]');
  await notes.fill('Unfinished recruiting note');
  let requests = 0;
  await page.route('**/api/persona', async route => {
    requests++;
    await new Promise(resolve => setTimeout(resolve, 400));
    await route.continue();
  });
  const started = Date.now();
  await expect(page.locator('#persona-mode-btn')).toHaveAccessibleName(/Current mode: Recruiting.*Switch to Job seeker/);
  await page.locator('#persona-mode-btn').click();
  await expect(page.locator('#persona-mode-btn')).toBeDisabled();
  await expect(page.locator('[data-action="toggle-persona-mode"]').nth(1)).toBeDisabled();
  await expect(page.locator('#persona-mode-label')).toHaveText('Job seeker');
  await expect(page.locator('#persona-mode-btn')).toBeEnabled();
  console.log(`app/app.js::togglePersonaMode with 400ms fixture delay: ${Date.now() - started}ms`);
  expect(requests).toBe(1);
  await expect(notes).toHaveValue('Unfinished recruiting note');
  await expect(page.locator('#person-heading')).toHaveText('Mode Test Person');
  await expect(page.locator('.toast--error')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('mode-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('summary[aria-label="Workspace options"]').click();
  await expect(page.locator('#persona-mode-menu-description')).toContainText('Current mode: Job seeker. Switch to Recruiting / business development.');
  const menu = page.locator('.topbar-overflow-menu');
  const items = await menu.locator(':scope > button:visible').evaluateAll(buttons => buttons.map(button => {
    const { x, y, width, height } = button.getBoundingClientRect();
    return { x, y, width, height };
  }));
  for (let index = 1; index < items.length; index++) {
    expect(items[index].y).toBeGreaterThanOrEqual(items[index - 1].y + items[index - 1].height - 1);
    expect(items[index].width).toBeGreaterThan(230);
  }
  expect(await menu.evaluate(element => element.scrollWidth <= element.clientWidth)).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath('mode-mobile.png') });
  await page.getByRole('button', { name: /Switch workspace mode/ }).click();
  await expect(page.locator('#persona-mode-label')).toHaveText('Recruiting');
  await expect(notes).toHaveValue('Unfinished recruiting note');
  await notes.fill('Saved note');
});

test('failed mode switch leaves the current mode and enables retry', async ({ page }) => {
  await workspace(page);
  await page.route('**/api/persona', route => route.fulfill({ status: 503, json: { error: 'Temporarily unavailable' } }));
  await page.locator('#persona-mode-btn').click();
  await expect(page.locator('.toast--error')).toContainText('Could not switch mode');
  await expect(page.locator('#persona-mode-label')).toHaveText('Recruiting');
  await expect(page.locator('#persona-mode-btn')).toBeEnabled();
  await page.unroute('**/api/persona');
  await page.locator('#persona-mode-btn').click();
  await expect(page.locator('#persona-mode-label')).toHaveText('Job seeker');
});
