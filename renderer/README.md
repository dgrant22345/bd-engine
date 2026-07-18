# BD Engine ATS Renderer

This internal service renders one public careers page for ATS discovery when normal redirects, HTML, embedded JSON, and static markup are insufficient.

It is designed to run as a separate Railway service reachable only through `http://ats-renderer.railway.internal:8790`. Requests require `RENDERER_TOKEN`; the BD Engine web service uses the same value through `BD_ATS_RENDER_SERVICE_TOKEN`.

The service rejects local/private destinations, validates browser subrequests, blocks heavy media, runs Chromium as the non-root `pwuser`, limits concurrency and queue depth, creates a fresh browser context per request, and never stores rendered content.

Railway's container runtime does not permit Chromium's Linux user-namespace sandbox. The Railway deployment therefore relies on the service-level isolation and controls above with `RENDER_CHROMIUM_SANDBOX=false`. Enable the browser sandbox only on a runtime configured with the required kernel and seccomp support.

## Configuration

- `RENDERER_TOKEN`: required shared secret, at least 24 characters.
- `PORT`: internal listening port, set to `8790` on Railway.
- `RENDER_CONCURRENCY`: simultaneous Chromium renders, default `1`.
- `RENDER_MAX_QUEUE`: queued renders before returning `429`, default `4`.
- `RENDER_MAX_TIMEOUT_MS`: maximum page-render time, default `25000`.
- `RENDER_MAX_HTML_BYTES`: maximum returned HTML size, default `5242880`.
- `RENDER_CHROMIUM_SANDBOX`: opt into Chromium's process sandbox, default `false`.

The web service uses `BD_ATS_RENDER_SERVICE_URL=http://ats-renderer.railway.internal:8790/render`, the matching token, and a bounded `BD_ATS_RENDER_TIMEOUT_MS`. Do not assign a public Railway domain to this service.

## Verification

```powershell
npm.cmd install
npm.cmd run check
npm.cmd test
```

After deployment, call `/health` and one authenticated `/render` request from the web service's private network. A renderer failure must remain non-fatal: ATS discovery records the failed attempt and continues with static discovery results.
