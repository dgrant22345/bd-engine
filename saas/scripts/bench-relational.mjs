import pg from 'pg';
const url = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : process.env.DATABASE_URL;
const T = 'tenant-60abe43f';
const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
const time = async (label, fn) => { const t = Date.now(); const r = await fn(); console.log(`  ${label}: ${Date.now() - t}ms`); return r; };

// Correctness: rel counts vs blob counts
const blob = (await pool.query(`SELECT jsonb_array_length(accounts) a, jsonb_array_length(contacts) c, jsonb_array_length(jobs) j, jsonb_array_length(configs) cf FROM tenant_data WHERE tenant_id=$1`, [T])).rows[0];
const rel = (await pool.query(`SELECT
  (SELECT count(*) FROM rel_accounts WHERE tenant_id=$1) a,
  (SELECT count(*) FROM rel_contacts WHERE tenant_id=$1) c,
  (SELECT count(*) FROM rel_jobs WHERE tenant_id=$1) j,
  (SELECT count(*) FROM rel_board_configs WHERE tenant_id=$1) cf`, [T])).rows[0];
console.log('counts blob :', JSON.stringify(blob));
console.log('counts rel  :', JSON.stringify(rel));
console.log('MATCH       :', blob.a==rel.a && blob.c==rel.c && blob.j==rel.j && blob.cf==rel.cf);

console.log('\n--- BLOB approach (what the app does today) ---');
await time('load whole tenant_data row (~30MB parse) + would sort/filter in JS', async () => {
  const row = (await pool.query(`SELECT accounts, contacts FROM tenant_data WHERE tenant_id=$1`, [T])).rows[0];
  // simulate the app: it then sorts/filters these arrays in JS
  const accts = row.accounts.sort((a,b)=>(b.targetScore||0)-(a.targetScore||0)).slice(0,25);
  return accts.length;
});

console.log('\n--- RELATIONAL approach (indexed SQL, loads only what is needed) ---');
await time('top-25 accounts by score (paginated)', () => pool.query(
  `SELECT id, display_name, target_score, data FROM rel_accounts WHERE tenant_id=$1 ORDER BY target_score DESC LIMIT 25`, [T]));
await time('search accounts ILIKE "bank" (page 1)', () => pool.query(
  `SELECT id, display_name FROM rel_accounts WHERE tenant_id=$1 AND (display_name ILIKE '%bank%' OR domain ILIKE '%bank%') ORDER BY target_score DESC LIMIT 25`, [T]));
await time('total account count', () => pool.query(`SELECT count(*) FROM rel_accounts WHERE tenant_id=$1`, [T]));
await time('contacts for one account', () => pool.query(
  `SELECT id, full_name, title FROM rel_contacts WHERE tenant_id=$1 AND account_id=(SELECT id FROM rel_accounts WHERE tenant_id=$1 LIMIT 1) LIMIT 50`, [T]));
await time('single account by id (composite PK)', () => pool.query(
  `SELECT data FROM rel_accounts WHERE tenant_id=$1 AND id=(SELECT id FROM rel_accounts WHERE tenant_id=$1 LIMIT 1)`, [T]));

await pool.end();
