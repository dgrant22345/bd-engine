const baseUrl = process.env.BD_CLOUD_SMOKE_URL || 'http://127.0.0.1:8787';

const checks = [];
let cookie = '';

await check('health endpoint', async () => {
  const body = await getJson('/health');
  assert(body.ok === true, 'health did not return ok=true');
});

await check('protected API rejects anonymous requests', async () => {
  const response = await fetch(`${baseUrl}/api/bootstrap`);
  assert(response.status === 401, `expected 401, got ${response.status}`);
});

await check('signup creates a session', async () => {
  const email = `smoke-auth-${Date.now()}@example.com`;
  const response = await fetch(`${baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: 'smoke1234',
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

await check('authenticated session can load bootstrap', async () => {
  const body = await getJson('/api/bootstrap?includeFilters=true', cookie);
  assert(body.workspace?.name, 'bootstrap did not include workspace');
  assert(Array.isArray(body.ownerRoster), 'bootstrap did not include owner roster');
});

await check('shared app is mounted under /app', async () => {
  const response = await fetch(`${baseUrl}/app/`, { headers: cookie ? { Cookie: cookie } : {} });
  assert(response.ok, `/app/ returned ${response.status}`);
  const html = await response.text();
  assert(html.includes('/app/styles.css'), 'app html did not rewrite stylesheet path');
  assert(html.includes('/app/app.js'), 'app html did not rewrite app script path');
  assert(!html.includes('serviceWorker.register'), 'app html should not register a service worker in SaaS shell');
});

await check('analytics visit records and summarizes visitors', async () => {
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

await check('new signup gets an empty first-run workspace', async () => {
  const email = `smoke-${Date.now()}@example.com`;
  const response = await fetch(`${baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: 'smoke1234',
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

await check('job seeker persona persists into the app bootstrap', async () => {
  const email = `smoke-jobseeker-${Date.now()}@example.com`;
  const response = await fetch(`${baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: 'smoke1234',
      name: 'Smoke Job Seeker',
      workspaceName: 'Smoke Job Search',
      persona: 'jobseeker',
    }),
  });
  assert(response.status === 201, `signup returned ${response.status}`);
  const signupCookie = response.headers.get('set-cookie')?.split(';')[0] || '';
  const signupBody = await response.json();
  assert(signupBody.persona === 'jobseeker', 'signup did not return jobseeker persona');
  assert(signupBody.tenant?.persona === 'jobseeker', 'tenant did not persist jobseeker persona');
  const setup = await getJson('/api/setup/status', signupCookie);
  assert(setup.persona === 'jobseeker', '/api/setup/status did not return jobseeker persona');
  const me = await getJson('/api/auth/me', signupCookie);
  assert(me.persona === 'jobseeker', '/api/auth/me did not return jobseeker persona');
  const bootstrap = await getJson('/api/bootstrap?includeFilters=true', signupCookie);
  assert(bootstrap.persona === 'jobseeker', '/api/bootstrap did not return jobseeker persona');
});

await check('referral code tracks referred signup', async () => {
  const referrerEmail = `smoke-referrer-${Date.now()}@example.com`;
  const referrerResponse = await fetch(`${baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: referrerEmail,
      password: 'smoke1234',
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
      password: 'smoke1234',
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
  console.log(`${item.ok ? 'OK' : 'FAIL'} ${item.name}${item.error ? `: ${item.error}` : ''}`);
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
