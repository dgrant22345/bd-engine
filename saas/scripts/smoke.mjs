const baseUrl = process.env.BD_CLOUD_SMOKE_URL || 'http://127.0.0.1:8787';
const baseHostname = new URL(baseUrl).hostname;
const allowMutations = ['127.0.0.1', 'localhost', '::1'].includes(baseHostname)
  || process.env.BD_CLOUD_SMOKE_ALLOW_MUTATIONS === 'true';
const mutationCheck = allowMutations ? check : skip;

const checks = [];
let cookie = '';
let authEmail = '';

await check('public health is availability-only (no internals leak)', async () => {
  const body = await getJson('/health');
  assert(body.ok === true, 'health did not return ok=true');
  assert(body.status === 'operational', `expected operational, got ${body.status}`);
  // CG-016: configuration/environment/infrastructure detail must not be public.
  for (const leak of ['checks', 'mode', 'release', 'startedAt', 'databaseConnected', 'stripeMode']) {
    assert(!Object.prototype.hasOwnProperty.call(body, leak), `public /health leaks "${leak}"`);
  }
});

await check('liveness and readiness probes respond', async () => {
  const live = await fetch(`${baseUrl}/livez`);
  assert(live.status === 200, `livez expected 200, got ${live.status}`);
  const ready = await fetch(`${baseUrl}/readyz`);
  // Local/dev in-memory mode is intentionally ready; production requires the DB.
  assert(ready.status === 200, `readyz expected 200, got ${ready.status}: ${await ready.text()}`);
});

await check('protected API rejects anonymous requests', async () => {
  const response = await fetch(`${baseUrl}/api/bootstrap`);
  assert(response.status === 401, `expected 401, got ${response.status}`);
});

await check('detailed status rejects anonymous requests', async () => {
  const response = await fetch(`${baseUrl}/api/status`);
  assert(response.status === 401, `expected 401, got ${response.status}`);
});

await check('public plans include sales and job seeker options', async () => {
  const body = await getJson('/api/plans');
  const planIds = (body.plans || []).map((plan) => plan.id);
  assert(planIds.includes('sales'), 'public plans omitted Sales Professional');
  assert(planIds.includes('jobseeker'), 'public plans omitted Job Seeker');
});

await mutationCheck('signup creates a session', async () => {
  const email = `smoke-auth-${Date.now()}@example.com`;
  authEmail = email;
  const response = await fetch(`${baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: 'smoke-password-1234',
      name: 'Smoke Auth User',
      workspaceName: 'Smoke Auth Workspace',
    }),
  });
  assert(response.status === 201, `signup failed with ${response.status}`);
  cookie = response.headers.get('set-cookie')?.split(';')[0] || '';
  assert(cookie.includes('bd_session='), 'signup did not set bd_session cookie');
  const body = await response.json();
  assert(body.user?.email === email, 'signup returned unexpected user');
});

await mutationCheck('password reset changes the account password', async () => {
  const request = await fetch(`${baseUrl}/api/auth/password-reset/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: authEmail }),
  });
  assert(request.status === 202, `password reset request returned ${request.status}`);
  const requestBody = await request.json();
  assert(requestBody.resetToken, 'test reset request did not return a reset token');

  const confirm = await fetch(`${baseUrl}/api/auth/password-reset/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: requestBody.resetToken, password: 'smoke-password-5678' }),
  });
  assert(confirm.status === 200, `password reset confirm returned ${confirm.status}`);

  const oldLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: authEmail, password: 'smoke-password-1234' }),
  });
  assert(oldLogin.status === 401, 'old password still logged in after reset');

  const newLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: authEmail, password: 'smoke-password-5678' }),
  });
  assert(newLogin.status === 200, `new password login returned ${newLogin.status}`);
});

await mutationCheck('authenticated session can load bootstrap', async () => {
  const body = await getJson('/api/bootstrap?includeFilters=true', cookie);
  assert(body.workspace?.name, 'bootstrap did not include workspace');
  assert(Array.isArray(body.ownerRoster), 'bootstrap did not include owner roster');
});

await mutationCheck('authenticated status includes operator detail', async () => {
  const body = await getJson('/api/status', cookie);
  assert(typeof body.checks?.emailConfigured === 'boolean', '/api/status did not include emailConfigured');
  assert(typeof body.checks?.supportNotificationsConfigured === 'boolean', '/api/status did not include support notification readiness');
  assert(typeof body.checks?.errorAlertsConfigured === 'boolean', '/api/status did not include error alert readiness');
  assert(Object.prototype.hasOwnProperty.call(body.checks || {}, 'relationalMirrorHealthy'), '/api/status omitted relational mirror readiness');
  assert(Object.prototype.hasOwnProperty.call(body.checks || {}, 'relationalContentHealthy'), '/api/status omitted relational content readiness');
});

await mutationCheck('manual ATS URL creates an import-ready board config', async () => {
  const response = await fetch(`${baseUrl}/api/configs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      companyName: 'Smoke Manual Board',
      careersUrl: 'https://job-boards.greenhouse.io/smokemanualboard',
      active: true,
    }),
  });
  assert(response.status === 201, `config create returned ${response.status}`);
  const config = await response.json();
  assert(config.atsType === 'greenhouse', `expected greenhouse, got ${config.atsType || 'blank'}`);
  assert(config.ats === 'greenhouse', `expected ats mirror greenhouse, got ${config.ats || 'blank'}`);
  assert(config.boardId === 'smokemanualboard', `expected board id from URL, got ${config.boardId || 'blank'}`);
  assert(config.resolvedBoardUrl === 'https://job-boards.greenhouse.io/smokemanualboard', 'resolved board URL was not preserved');
  assert(config.reviewStatus === 'approved', 'manual config was not approved');
  assert(config.active === true, 'manual config was not active');

  const exact = await getJson(`/api/configs/${config.id}`, cookie);
  assert(exact.id === config.id, 'exact config lookup returned the wrong board');
  const diagnostics = await getJson('/api/ingestion/diagnostics', cookie);
  assert(diagnostics.coverageSummary?.importReady === 1, 'coverage diagnostics did not count the import-ready board');
  assert(diagnostics.coverageCategories?.ready_not_run === 1, 'coverage diagnostics did not explain the unrefreshed board');
});

await mutationCheck('privacy export and confirmed workspace delete work', async () => {
  const exportResponse = await fetch(`${baseUrl}/api/privacy/export`, {
    headers: { Cookie: cookie },
  });
  assert(exportResponse.status === 200, `privacy export returned ${exportResponse.status}`);
  assert((exportResponse.headers.get('content-disposition') || '').includes('bd-engine-'), 'privacy export did not set a download filename');
  const exported = await exportResponse.json();
  assert(exported.user?.email?.startsWith('smoke-auth-'), 'privacy export did not include the signed-in user');
  assert(exported.workspace?.configs?.some((item) => item.boardId === 'smokemanualboard'), 'privacy export did not include workspace config data');

  const badDelete = await fetch(`${baseUrl}/api/privacy/delete-workspace`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ confirm: 'DELETE', password: 'smoke-password-5678' }),
  });
  assert(badDelete.status === 400, `bad privacy delete confirmation returned ${badDelete.status}`);

  const deleteResponse = await fetch(`${baseUrl}/api/privacy/delete-workspace`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      confirm: 'DELETE Smoke Auth Workspace',
      password: 'smoke-password-5678',
    }),
  });
  assert(deleteResponse.status === 200, `privacy delete returned ${deleteResponse.status}`);
  const deleted = await deleteResponse.json();
  assert(deleted.deleted?.configCount >= 1, 'privacy delete did not report deleted config data');
  assert(deleted.remaining?.total === 0, 'privacy delete did not clear workspace data');

  const afterExport = await getJson('/api/privacy/export', cookie);
  assert(afterExport.workspace?.configs?.length === 0, 'workspace configs remained after privacy delete');
});

await check('shared app is mounted under /app', async () => {
  const response = await fetch(`${baseUrl}/app/`, { headers: cookie ? { Cookie: cookie } : {} });
  assert(response.ok, `/app/ returned ${response.status}`);
  const html = await response.text();
  assert(html.includes('/app/styles.css'), 'app html did not rewrite stylesheet path');
  assert(html.includes('/app/app.js'), 'app html did not rewrite app script path');
  assert(!html.includes('serviceWorker.register'), 'app html should not register a service worker in SaaS shell');
});

await check('public demo opens a read-only synthetic workspace', async () => {
  const response = await fetch(`${baseUrl}/api/demo/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert(response.status === 201, `demo start returned ${response.status}`);
  const demoCookie = response.headers.get('set-cookie')?.split(';')[0] || '';
  assert(demoCookie.includes('bd_session='), 'demo did not set a session cookie');
  const body = await response.json();
  assert(body.demo === true && body.readOnly === true, 'demo response was not marked read-only');

  const me = await getJson('/api/auth/me', demoCookie);
  assert(me.demo === true && me.readOnly === true, '/api/auth/me did not mark demo read-only');

  const dashboard = await getJson('/api/dashboard', demoCookie);
  assert(dashboard.summary?.accountCount >= 3, 'demo workspace did not load synthetic accounts');
  assert(dashboard.summary?.activeJobCount >= 4, 'demo workspace did not load synthetic jobs');

  const blocked = await fetch(`${baseUrl}/api/configs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: demoCookie },
    body: JSON.stringify({ companyName: 'Should Not Save', atsType: 'greenhouse', boardId: 'blocked' }),
  });
  assert(blocked.status === 403, `demo mutation should be blocked, got ${blocked.status}`);
  const blockedBody = await blocked.json();
  assert(blockedBody.code === 'demo_read_only', 'demo mutation did not return demo_read_only');
});

await mutationCheck('analytics visit records and summarizes visitors', async () => {
  const visitorId = `smoke-visitor-${Date.now()}`;
  const response = await fetch(`${baseUrl}/api/analytics/visit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      visitorId,
      path: '/',
      referrer: 'https://example.com/search?q=private',
      source: 'smoke',
    }),
  });
  assert(response.status === 202, `analytics visit returned ${response.status}`);
  const admin = await getJson('/api/admin/bootstrap', cookie);
  assert(admin.analytics?.recent?.visitors >= 1, 'analytics summary did not count visitors');
  assert(Array.isArray(admin.analytics?.topSources), 'analytics summary did not include sources');
});

await mutationCheck('new signup gets an empty first-run workspace', async () => {
  const email = `smoke-${Date.now()}@example.com`;
  const response = await fetch(`${baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: 'smoke-password-1234',
      name: 'Smoke Test User',
      workspaceName: 'Smoke Test Workspace',
    }),
  });
  assert(response.status === 201, `signup returned ${response.status}`);
  const signupCookie = response.headers.get('set-cookie')?.split(';')[0] || '';
  assert(signupCookie.includes('bd_session='), 'signup did not set bd_session cookie');
  const setup = await getJson('/api/setup/status', signupCookie);
  assert(setup.requiresSetup === true, 'new workspace should require setup');
  assert(setup.workspaceName === 'Smoke Test Workspace', 'new workspace name was not preserved');
});

await mutationCheck('sample workspace completes onboarding without overwriting data', async () => {
  const email = `smoke-sample-${Date.now()}@example.com`;
  const response = await fetch(`${baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: 'smoke-password-1234',
      name: 'Smoke Sample User',
      workspaceName: 'Smoke Sample Workspace',
    }),
  });
  assert(response.status === 201, `signup returned ${response.status}`);
  const signupCookie = response.headers.get('set-cookie')?.split(';')[0] || '';

  const sampleResponse = await fetch(`${baseUrl}/api/setup/sample-data`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: signupCookie },
    body: JSON.stringify({
      workspaceName: 'Smoke Sample Workspace',
      userName: 'Smoke Sample User',
      userEmail: email,
      persona: 'bd',
    }),
  });
  assert(sampleResponse.status === 201, `sample data returned ${sampleResponse.status}`);
  const sample = await sampleResponse.json();
  assert(sample.sample === true, 'sample route did not mark the response as sample data');
  assert(sample.stats?.accounts >= 3, 'sample workspace did not include accounts');
  assert(sample.stats?.contacts >= 4, 'sample workspace did not include contacts');
  assert(sample.stats?.jobs >= 4, 'sample workspace did not include jobs');
  assert(sample.stats?.configs >= 3, 'sample workspace did not include ATS boards');

  const setup = await getJson('/api/setup/status', signupCookie);
  assert(setup.requiresSetup === false, 'sample workspace should complete setup');

  const secondResponse = await fetch(`${baseUrl}/api/setup/sample-data`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: signupCookie },
    body: JSON.stringify({ workspaceName: 'Smoke Sample Workspace' }),
  });
  assert(secondResponse.status === 409, `second sample load should be blocked, got ${secondResponse.status}`);
});

await mutationCheck('job seeker signup preserves its persona across the app', async () => {
  const email = `smoke-jobseeker-${Date.now()}@example.com`;
  const response = await fetch(`${baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: 'smoke-password-1234',
      name: 'Smoke Job Seeker',
      workspaceName: 'Smoke Job Search',
      persona: 'jobseeker',
    }),
  });
  assert(response.status === 201, `signup returned ${response.status}`);
  const signupCookie = response.headers.get('set-cookie')?.split(';')[0] || '';
  const signupBody = await response.json();
  assert(signupBody.persona === 'jobseeker', 'signup should preserve the jobseeker persona');
  assert(signupBody.tenant?.persona === 'jobseeker', 'tenant should preserve the jobseeker persona');
  const setup = await getJson('/api/setup/status', signupCookie);
  assert(setup.persona === 'jobseeker', '/api/setup/status should return jobseeker persona');
  const me = await getJson('/api/auth/me', signupCookie);
  assert(me.persona === 'jobseeker', '/api/auth/me should return jobseeker persona');
  const bootstrap = await getJson('/api/bootstrap?includeFilters=true', signupCookie);
  assert(bootstrap.persona === 'jobseeker', '/api/bootstrap should return jobseeker persona');
});

await mutationCheck('referral code tracks referred signup', async () => {
  const referrerEmail = `smoke-referrer-${Date.now()}@example.com`;
  const referrerResponse = await fetch(`${baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: referrerEmail,
      password: 'smoke-password-1234',
      name: 'Smoke Referrer',
      workspaceName: 'Smoke Referrer Workspace',
    }),
  });
  assert(referrerResponse.status === 201, `referrer signup returned ${referrerResponse.status}`);
  const referrerCookie = referrerResponse.headers.get('set-cookie')?.split(';')[0] || '';
  const referrerBilling = await getJson('/api/billing', referrerCookie);
  assert(referrerBilling.referral?.code, 'referrer did not receive a referral code');

  const referredEmail = `smoke-referred-${Date.now()}@example.com`;
  const referredResponse = await fetch(`${baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: referredEmail,
      password: 'smoke-password-1234',
      name: 'Smoke Referred',
      workspaceName: 'Smoke Referred Workspace',
      referralCode: referrerBilling.referral.code,
    }),
  });
  assert(referredResponse.status === 201, `referred signup returned ${referredResponse.status}`);
  const referredCookie = referredResponse.headers.get('set-cookie')?.split(';')[0] || '';
  const referredMe = await getJson('/api/auth/me', referredCookie);
  assert(referredMe.referral?.referredByTenantId, 'referred signup did not retain referrer tenant');
});

for (const item of checks) {
  console.log(`${item.skipped ? 'SKIP' : item.ok ? 'OK' : 'FAIL'} ${item.name}${item.error ? `: ${item.error}` : ''}`);
}

if (checks.some((item) => !item.ok)) {
  process.exitCode = 1;
}

async function getJson(path, sessionCookie = '') {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: sessionCookie ? { Cookie: sessionCookie } : {},
  });
  assert(response.ok, `${path} returned ${response.status}`);
  return response.json();
}

async function check(name, fn) {
  try {
    await fn();
    checks.push({ name, ok: true });
  } catch (error) {
    checks.push({ name, ok: false, error: error.message || String(error) });
  }
}

async function skip(name) {
  checks.push({ name, ok: true, skipped: true });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
