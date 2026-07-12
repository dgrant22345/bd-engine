import { defineConfig } from '@playwright/test';

// Browser journey harness (CG-002). Starts the cloud server fresh on a test
// port in in-memory mode (no DATABASE_URL), so journeys are deterministic and
// never touch real data. Every journey fails on ANY uncaught page error — the
// generalized regression for CG-001 (a dead form was throwing ReferenceError).
export default defineConfig({
  testDir: './test/browser',
  timeout: 60000,
  retries: process.env.CI ? 1 : 0,
  // One worker: journeys share a single in-memory server; parallel signups
  // would race the process-local rate limiter and tenant state.
  workers: 1,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:8788',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node src/server.js',
    port: 8788,
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
    env: {
      BD_CLOUD_PORT: '8788',
      // Journeys perform several signups per run; the production limiter
      // stays intact — only the harness raises the ceiling.
      BD_SIGNUP_MAX: '1000',
      BD_LOGIN_MAX: '1000',
    },
  },
});
