# Release Process

## 1. Prepare

1. Work from a clean intentional branch and review `git status`.
2. Update `VERSION` and `CHANGELOG.md` for a customer release.
3. Create and verify a production backup before migrations or bulk changes.
4. Confirm required provider credentials and deployment variables in the target environment.

## 2. Verify

```powershell
npm.cmd --prefix saas run check
npm.cmd --prefix saas test
npm.cmd --prefix saas run test:browser
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\package-windows.ps1 -SkipInstaller
```

With Inno Setup 6 installed, also build the installer and test it on a clean Windows profile or VM.

## 3. Deploy Hosted App

Push the approved commit to the Railway-connected branch. Confirm Railway deployed that exact Git hash. Then run read-only smoke checks against the deployed URL and review `/health`, relational parity, recent 5xx errors, and support/email/billing configuration.

Do not enable mutation smoke tests against customer production data.

## 4. Publish Windows App

Build `dist\BD-Engine-Setup.exe`, verify its version metadata, scan the artifact, and test install, first launch, CSV preview/import, restart persistence, upgrade preservation, and both uninstall data choices. Code signing is required before broad public distribution.

## 5. Roll Back

For application regressions, redeploy the previous known-good commit. For data migrations, follow `saas/OPERATIONS.md`: preserve a current backup, verify relational/legacy parity, create a rollback snapshot where needed, and restore into a disposable database before applying recovery to production.
