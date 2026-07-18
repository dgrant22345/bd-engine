# BD Engine

BD Engine turns a recruiter's professional network and live hiring signals into a prioritized daily business-development list. It supports sales and job-seeker workspaces, LinkedIn Connections CSV import, company and contact ranking, public ATS discovery, normalized job ingestion, grounded outreach drafts, activity tracking, and follow-up tasks.

The repository contains three deployable components:

- `saas/`: the hosted multi-tenant Node.js application used for Railway deployments. PostgreSQL is authoritative in production.
- `server/`: the Windows-local PowerShell application packaged by the Inno Setup installer. It binds to localhost and stores customer data under `%LOCALAPPDATA%\BD Engine`.
- `renderer/`: the isolated, authenticated Playwright service used only when a public careers page requires browser rendering for ATS discovery.

The shared browser application lives in `app/`.

## Hosted Development

Requirements: Node.js 22 or newer.

```powershell
cd saas
npm.cmd install
$env:BD_ALLOW_IN_MEMORY='true'
npm.cmd start
```

Open `http://127.0.0.1:8787`. In-memory mode is for local development and tests only. Production fails closed when `DATABASE_URL` is absent or unavailable.

## Verification

```powershell
npm.cmd --prefix saas run check
npm.cmd --prefix saas test
npm.cmd --prefix saas run test:browser
npm.cmd --prefix renderer run check
npm.cmd --prefix renderer test
```

Run a local smoke test against a running server:

```powershell
$env:BD_CLOUD_SMOKE_URL='http://127.0.0.1:8787'
npm.cmd --prefix saas run smoke
```

Production smoke checks are read-only unless mutation checks are explicitly enabled. See [saas/OPERATIONS.md](saas/OPERATIONS.md).

## Windows Local Runtime

For repository development:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File server\Server.ps1 -Port 8173 -LocalOnly -OpenBrowser
```

Customers should use the installer and launch from the Start menu or desktop shortcut. They do not need Node.js, Git, SQLite tools, or a terminal.

Validate the staged package without compiling an installer:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\package-windows.ps1 -SkipInstaller
```

Build `dist\BD-Engine-Setup.exe` with Inno Setup 6 installed:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\package-windows.ps1
```

See [PACKAGING.md](PACKAGING.md) for package contents and clean-install verification.

## Product Workflow

1. Create a sales or job-search workspace.
2. Import LinkedIn `Connections.csv`, or load synthetic sample data.
3. Select companies to track.
4. Discover compatible public careers boards and import live jobs.
5. Review the daily priority list and its recommendation reasons.
6. Select a relevant contact and prepare a grounded outreach draft.
7. Log the outreach and create a follow-up.

Re-importing LinkedIn data updates matching contacts and does not intentionally overwrite user notes or workflow status.

## Job Sources

Automatic public imports currently cover Greenhouse, Lever, Ashby, SmartRecruiters, Workday, BambooHR, Workable, Jobvite, Recruitee, Personio, and Rippling. Some career sites require browser rendering, block automated requests, or use enterprise systems without a public feed. Those sources are reported for review rather than presented as successfully connected.

Provider behavior is implemented behind normalized adapters with timeouts, bounded retries, per-board failure isolation, job lifecycle handling, and regression tests. See [docs/provider-adapter-guide.md](docs/provider-adapter-guide.md).

## Data And Privacy

Hosted workspaces store customer data in PostgreSQL and send requests to configured job-board providers, email delivery, Stripe, and optional monitoring services as required by the feature. Windows-local workspaces store data on the device, but public job discovery still makes outbound requests to careers providers.

Do not commit customer exports, database backups, API keys, service-account files, Stripe secrets, activation keys, or production connection strings. See [docs/security-privacy.md](docs/security-privacy.md).

## Architecture

```text
app/                         Shared static browser UI
saas/src/                    Hosted API, auth, billing, persistence, jobs
saas/test/                   Unit, integration, contract, and browser tests
server/                      Windows-local API and SQLite runtime
packaging/windows/           Inno Setup definition and launcher
scripts/package-windows.ps1  Clean Windows staging and installer build
docs/                        Product, architecture, provider, and release guides
```

PostgreSQL schema migrations are idempotent entries in `saas/src/db.js` recorded in `schema_migrations`. The local SQLite adapter tracks its own schema version and additive migrations.

## Documentation

- [User quick start](docs/quick-start.md)
- [Architecture](docs/architecture.md)
- [Security and privacy](docs/security-privacy.md)
- [Provider adapter guide](docs/provider-adapter-guide.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Release process](docs/release-process.md)
- [Hosted operations](saas/OPERATIONS.md)
- [Disaster recovery](saas/docs/disaster-recovery.md)
- [Windows packaging](PACKAGING.md)
- [Changelog](CHANGELOG.md)
