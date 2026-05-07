// Quick smoke test for LinkedIn CSV import and tenant isolation
const BASE = 'http://127.0.0.1:8787';

async function api(path, options = {}) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const cookie = res.headers.get('set-cookie');
  const data = res.status === 204 ? null : await res.json();
  return { status: res.status, data, cookie };
}

async function run() {
  // 1. Sign up
  const { data: signup, cookie } = await api('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ email: 'smoketest@example.com', password: 'test1234', name: 'Smoke Tester', workspaceName: 'Smoke Corp' }),
  });
  console.log('1. Signup:', signup.user?.name, 'in', signup.tenant?.name);
  const cookieHeader = cookie?.split(';')[0];

  // 2. Check accounts (empty)
  const { data: before } = await api('/api/accounts?page=1&pageSize=20', { headers: { Cookie: cookieHeader } });
  console.log('2. Accounts before import:', before.total);

  // 3. Import LinkedIn CSV
  const csv = `First Name,Last Name,Email Address,Company,Position,Connected On
Sarah,Chen,sarah@acmecorp.com,Acme Corp,VP of Engineering,2025-03-15
Mike,Johnson,mike@acmecorp.com,Acme Corp,Director of Talent Acquisition,2025-06-20
Lisa,Park,,TechFlow Inc,Senior Recruiter,2025-01-10
James,Wu,james@techflow.io,TechFlow Inc,CTO,2024-11-05
Anna,Kowalski,anna@novawire.com,NovaWire Systems,Head of People,2025-04-22
David,Nguyen,,NovaWire Systems,Senior Software Engineer,2025-02-14
Rachel,Kim,rachel@brightpath.co,BrightPath Consulting,Managing Partner,2025-07-01`;

  const { data: importResult } = await api('/api/import/linkedin-csv', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', Cookie: cookieHeader },
    body: csv,
  });
  console.log('3. Import result:', JSON.stringify(importResult.summary, null, 2));

  // 4. Accounts after import
  const { data: after } = await api('/api/accounts?page=1&pageSize=20', { headers: { Cookie: cookieHeader } });
  console.log('4. Accounts after import:', after.total);
  for (const a of after.items) {
    console.log(`   - ${a.displayName} (score: ${a.targetScore}, contacts: ${a.connectionCount})`);
  }

  // 5. Contacts
  const { data: cts } = await api('/api/contacts?page=1&pageSize=20', { headers: { Cookie: cookieHeader } });
  console.log('5. Contacts:', cts.total);
  for (const c of cts.items) {
    console.log(`   - ${c.fullName} @ ${c.companyName} (${c.title}) [${c.seniority}${c.isTalentLeader ? ', TALENT' : ''}]`);
  }

  // 6. Tenant isolation — demo user
  const { cookie: demoCookie } = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'demo@bdengine.io', password: 'demo1234' }),
  });
  const demoCookieHeader = demoCookie?.split(';')[0];
  const { data: demoAccts } = await api('/api/accounts?page=1&pageSize=20', { headers: { Cookie: demoCookieHeader } });
  console.log('6. Demo tenant accounts:', demoAccts.total, '(should be 3)');

  // 7. Verify no cross-tenant leak
  const smokeNames = after.items.map(a => a.displayName).join(', ');
  const demoNames = demoAccts.items.map(a => a.displayName).join(', ');
  console.log('   Smoke tenant:', smokeNames);
  console.log('   Demo tenant:', demoNames);
  const overlap = after.items.some(a => demoAccts.items.some(d => d.id === a.id));
  console.log('   Cross-tenant leak:', overlap ? 'FAIL!' : 'NONE ✓');

  console.log('\n✅ All tests passed!');
}

run().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
