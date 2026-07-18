import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const launcherPath = new URL('../../packaging/windows/BD-Engine-Launcher.ps1', import.meta.url);
const installerPath = new URL('../../packaging/windows/BD-Engine.iss', import.meta.url);

test('Windows launcher stays local, single-instance, and recovers from a port conflict', async () => {
  const launcher = await readFile(launcherPath, 'utf8');
  assert.match(launcher, /-LocalOnly/);
  assert.match(launcher, /server\.pid/);
  assert.match(launcher, /server\.port/);
  assert.match(launcher, /Get-AvailableServerPort/);
  assert.match(launcher, /\$PreferredPort \+ \$offset/);
  assert.match(launcher, /127\.0\.0\.1/);
});

test('Windows uninstaller preserves customer data unless removal is explicit', async () => {
  const installer = await readFile(installerPath, 'utf8');
  assert.match(installer, /Choose No to keep your database, settings, logs, and import history/);
  assert.match(installer, /if \(CurUninstallStep = usPostUninstall\) and DeleteUserData/);
  assert.match(installer, /PrivilegesRequired=lowest/);
});
