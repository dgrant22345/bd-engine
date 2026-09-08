// Read-only public-source canary. Never connects to customer storage.
import { createStore } from '../src/store.js';
if (process.env.DATABASE_URL) throw new Error('Public source canary requires DATABASE_URL to be unset.');
const store = createStore();
const tenantId = 'td-public-coverage';
store.ensureTenant({ id: tenantId, name: 'Public source check' }, { id: 'canary' });
await store.patchSettings(tenantId, { geographyFocus: 'Global' });
const account = await store.addAccount(tenantId, { displayName: 'TD' });
store.addConfig(tenantId, { accountId: account.id, companyName: 'TD', atsType: 'workday',
  boardId: 'td/TD_Bank_Careers', apiUrl: 'https://td.wd3.myworkdayjobs.com/wday/cxs/td/TD_Bank_Careers/jobs',
  discoveryStatus: 'resolved', reviewStatus: 'approved', active: true });
const startedAt = performance.now();
const result = await store.importLiveJobs(tenantId, { plan: { limits: { jobBoards: -1 } }, autoDiscover: false });
const config = (await store.findConfigs(tenantId, { pageSize: 10 })).items[0];
const canadian = await store.findJobs(tenantId, { geography: 'canada', pageSize: 1 });
console.log(JSON.stringify({ elapsedMs: Math.round(performance.now() - startedAt),
  coverage: config.lastImportCoverage, canadianJobs: canadian.total, errors: result.errors }, null, 2));
if (result.errors?.length || config.lastImportCoverage?.complete !== true) process.exitCode = 1;
