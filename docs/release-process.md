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
npm.cmd --prefix saas audit --omit=dev --audit-level=high
npm.cmd --prefix saas run benchmark:ats
npm.cmd --prefix saas run test:browser
npm.cmd --prefix saas run test:browser:compat
npm.cmd --prefix renderer run check
npm.cmd --prefix renderer test
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\package-windows.ps1 -SkipInstaller
```

Load the intended production environment in a secure operator shell and run `npm.cmd --prefix saas run check:production-config`. The checker reports variable names and readiness messages only; it never prints secret values. Do not proceed with a commercial release while it reports errors.

With Inno Setup 6 installed, also build the installer and test it on a clean Windows profile or VM.

## 3. Deploy Hosted App

Push the approved commit to the Railway-connected branch. Confirm Railway deployed that exact Git hash. Then run read-only smoke checks against the deployed URL and review `/health`, relational parity, recent 5xx errors, and support/email/billing configuration.

When `renderer/` changes, deploy that directory to the private `ats-renderer` Railway service and verify `/health` from the web service before enabling `BD_ATS_RENDER_SERVICE_URL`. Keep the renderer without a public domain. Its `RENDERER_TOKEN` and the web service's `BD_ATS_RENDER_SERVICE_TOKEN` must match and should be rotated together.

Do not enable mutation smoke tests against customer production data.

## 4. Publish Windows App

Build `dist\BD-Engine-Setup.exe`, verify its version metadata, scan the artifact, and test install, first launch, CSV preview/import, restart persistence, upgrade preservation, and both uninstall data choices. Code signing is required before broad public distribution.

## 5. Roll Back

For application regressions, redeploy the previous known-good commit. For renderer regressions, clear `BD_ATS_RENDER_SERVICE_URL` first so discovery returns to static-only behavior, then redeploy the previous renderer revision. For data migrations, follow `saas/OPERATIONS.md`: preserve a current backup, verify relational/legacy parity, create a rollback snapshot where needed, and restore into a disposable database before applying recovery to production.
