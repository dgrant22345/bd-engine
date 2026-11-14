// Builds one week's Canadian hiring tracker snapshot and prints it as JSON.
// It reads the employers' public job sites into an isolated in-memory
// workspace; it never connects to the customer database. The server runs it
// as a separate process once a week (see startHiringTrackerRunner).
import { pathToFileURL } from 'node:url';
import { createStore } from '../src/store.js';
import { roleKey, TRACKER_EMPLOYERS, trackerWeek } from '../src/hiring-tracker.js';

export async function buildHiringTrackerSnapshot({ now = new Date(), employers = TRACKER_EMPLOYERS } = {}) {
  if (process.env.DATABASE_URL) throw new Error('The hiring tracker snapshot runs without DATABASE_URL, in an isolated in-memory workspace.');
  const startedAt = performance.now();
  const store = createStore();
  const tenantId = `hiring-tracker-${now.getTime()}`;
  store.ensureTenant({ id: tenantId, name: 'Hiring tracker' }, { id: `${tenantId}-owner`, name: 'Hiring tracker' });
  await store.patchSettings(tenantId, { geographyFocus: 'Canada' });
  for (const employer of employers) {
    const { name, sector: _sector, site: _site, ...board } = employer;
    const account = await store.addAccount(tenantId, { displayName: name });
    store.addConfig(tenantId, { ...board, companyName: name, accountId: account.id, discoveryStatus: 'resolved', reviewStatus: 'approved', active: true });
  }
  await store.importLiveJobs(tenantId, { plan: { displayName: 'Hiring tracker', limits: { jobBoards: -1 } }, autoDiscover: false, fetchConcurrency: 4 });
  const configs = (await store.findConfigs(tenantId, { page: 1, pageSize: 100 })).items;
  const jobs = (await store.findJobs(tenantId, { page: 1, pageSize: 100000 })).items.filter((item) => item.active !== false);
  const snapshot = {
    week: trackerWeek(now),
    takenAt: now.toISOString(),
    employers: employers.map((employer) => {
      const config = configs.find((item) => item.companyName === employer.name);
      const roles = config ? jobs.filter((item) => item.configId === config.id) : [];
      // Only a full read is published; a partial or failed one shows no figures.
      const status = config?.lastImportStatus === 'success' ? 'complete' : 'unavailable';
      return {
        name: employer.name,
        sector: employer.sector,
        site: employer.site,
        status,
        openRoles: status === 'complete' ? roles.length : null,
        keys: status === 'complete' ? [...new Set(roles.map((item) => roleKey(employer.boardId, item.jobId)))].sort() : [],
      };
    }),
  };
  snapshot.elapsedMs = Math.round(performance.now() - startedAt);
  return snapshot;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  // Progress logs go to stderr; stdout carries only the snapshot.
  console.log = (...args) => console.error(...args);
  console.warn = (...args) => console.error(...args);
  const snapshot = await buildHiringTrackerSnapshot();
  process.stdout.write(`${JSON.stringify(snapshot)}\n`);
}
