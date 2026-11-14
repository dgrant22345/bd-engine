import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Owner invites a teammate from Settings > Team; the teammate opens the link,
// creates an account for the invited address and lands in the shared
// workspace; someone with two workspaces switches between them.
async function signUp(page, { name, email, workspace }) {
  await page.goto('/?signup=1');
  await page.locator('#signup-name').fill(name);
  await page.locator('#signup-email').fill(email);
  await page.locator('#signup-password').fill('team-browser-password-1');
  await page.locator('#signup-workspace').fill(workspace);
  await page.locator('#signup-legal-consent').check();
  await page.locator('#signup-form button[type="submit"]').click();
  const app = page.frameLocator('iframe.cloud-app-frame');
  await expect(app.locator('#setup-profile-form')).toBeVisible({ timeout: 15000 });
  await app.getByRole('button', { name: 'Start with people' }).click();
  await expect(page.locator('.cloud-account-status')).toBeVisible({ timeout: 15000 });
}

async function openTeam(page, reload) {
  await page.goto(`/?open=${reload}#/admin/team`);
  const team = page.frameLocator('iframe.cloud-app-frame').locator('#admin-section-team');
  await expect(team.locator('.team-row').first()).toBeVisible({ timeout: 15000 });
  return team;
}

test('invite a teammate, join through the link, and switch workspaces', async ({ browser }, testInfo) => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const errors = [];
  const ownerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  owner.on('pageerror', (error) => errors.push(`owner: ${error.message}`));
  await signUp(owner, { name: 'Olivia Owner', email: `olivia-${run}@example.test`, workspace: 'Northline Staffing' });

  let team = await openTeam(owner, 1);
  await expect(team).toContainText('1 of 3 seats used');
  const teammate = `marcus-${run}@example.test`;
  await team.getByLabel('Invite by email').fill(teammate);
  await team.getByRole('button', { name: 'Send invitation' }).click();
  await expect(team.locator('[data-team-status]')).toContainText(`Share this link with ${teammate}`);
  await expect(team).toContainText('1 invitation pending');
  const link = await team.getByLabel('Invitation link').inputValue();
  expect(link).toMatch(/\/\?invite=[\w-]{40,}$/);

  // The teammate opens the link: the token leaves the address bar at once.
  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  guest.on('pageerror', (error) => errors.push(`guest: ${error.message}`));
  await guest.goto(link);
  await expect(guest.getByRole('heading', { name: 'Join Northline Staffing' })).toBeVisible();
  expect(new URL(guest.url()).search).toBe('');
  await expect(guest.locator('#invite-signup-email')).toHaveValue(teammate);
  const axe = await new AxeBuilder({ page: guest }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(axe.violations.map((item) => item.id)).toEqual([]);
  await guest.locator('#invite-signup-name').fill('Marcus Lee');
  await guest.locator('#invite-signup-password').fill('team-browser-password-2');
  await guest.locator('#invite-legal-consent').check();
  await guest.getByRole('button', { name: 'Create account and join' }).click();
  await expect(guest.locator('.cloud-workspace')).toHaveText('Northline Staffing', { timeout: 15000 });
  await guest.screenshot({ path: testInfo.outputPath('teammate-joined.png') });

  // The link works once.
  const lateContext = await browser.newContext();
  const late = await lateContext.newPage();
  await late.goto(link);
  await expect(late.getByRole('heading', { name: 'This invitation has been used' })).toBeVisible();

  // The owner sees two people and can change the teammate's role.
  team = await openTeam(owner, 2);
  await expect(team).toContainText('2 of 3 seats used');
  await expect(team).toContainText('Marcus Lee');
  await team.getByLabel('Role for Marcus Lee').selectOption('admin');
  await expect(team.locator('[data-team-status]')).toContainText('Marcus Lee is now an admin.');
  await owner.screenshot({ path: testInfo.outputPath('team-owner.png') });

  // Someone with their own workspace joins too, then switches back and forth.
  const boContext = await browser.newContext();
  const bo = await boContext.newPage();
  bo.on('pageerror', (error) => errors.push(`bo: ${error.message}`));
  const boEmail = `bo-${run}@example.test`;
  await signUp(bo, { name: 'Bo Hart', email: boEmail, workspace: 'Hart Search' });
  team = await openTeam(owner, 3);
  await team.getByLabel('Invite by email').fill(boEmail);
  await team.getByRole('button', { name: 'Send invitation' }).click();
  const boLink = await team.getByLabel('Invitation link').inputValue();
  await bo.goto(boLink);
  await bo.getByRole('button', { name: 'Join Northline Staffing' }).click();
  await expect(bo.locator('.cloud-workspace')).toHaveText('Northline Staffing', { timeout: 15000 });
  await bo.locator('#cloud-avatar-btn').click();
  const switcher = bo.getByRole('group', { name: 'Workspaces' });
  await expect(switcher.getByRole('menuitemradio', { name: /Northline Staffing/ })).toHaveAttribute('aria-checked', 'true');
  await switcher.getByRole('menuitemradio', { name: /Hart Search/ }).click();
  await expect(bo.locator('.cloud-workspace')).toHaveText('Hart Search', { timeout: 15000 });

  expect(errors).toEqual([]);
  await Promise.all([ownerContext, guestContext, lateContext, boContext].map((context) => context.close()));
});
