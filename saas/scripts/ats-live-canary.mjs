import { pathToFileURL } from 'node:url';
import { createStore } from '../src/store.js';

// Public boards used only for operational compatibility checks. These are not
// endorsements and no customer or applicant data is sent or stored.
const LIVE_BOARDS = [
  { atsType: 'greenhouse', companyName: 'Waymo', boardId: 'waymo', resolvedBoardUrl: 'https://job-boards.greenhouse.io/waymo' },
  { atsType: 'lever', companyName: 'Palantir', boardId: 'palantir', resolvedBoardUrl: 'https://jobs.lever.co/palantir' },
  { atsType: 'ashby', companyName: 'Linear', boardId: 'linear', resolvedBoardUrl: 'https://jobs.ashbyhq.com/linear' },
  { atsType: 'smartrecruiters', companyName: 'SmartRecruiters', boardId: 'smartrecruiters', resolvedBoardUrl: 'https://careers.smartrecruiters.com/smartrecruiters' },
  { atsType: 'jobvite', companyName: 'Absolute Software', boardId: 'absolute', resolvedBoardUrl: 'https://jobs.jobvite.com/absolute/jobs' },
  {
    atsType: 'workday',
    companyName: 'NVIDIA',
    boardId: 'nvidia/NVIDIAExternalCareerSite',
    apiUrl: 'https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite/jobs',
    resolvedBoardUrl: 'https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite',
  },
  { atsType: 'bamboohr', companyName: 'PCS Wireless', boardId: 'pcsglobal', resolvedBoardUrl: 'https://pcsglobal.bamboohr.com/careers' },
  { atsType: 'workable', companyName: 'City Wide Facility Solutions', boardId: 'citywide', resolvedBoardUrl: 'https://apply.workable.com/citywide/' },
  { atsType: 'recruitee', companyName: 'Emergent Software', boardId: 'emergentsoftware', resolvedBoardUrl: 'https://emergentsoftware.recruitee.com/' },
  { atsType: 'personio', companyName: 'Personio', boardId: 'personio', resolvedBoardUrl: 'https://personio.jobs.personio.de/' },
  { atsType: 'rippling', companyName: 'Pace', boardId: 'pace', resolvedBoardUrl: 'https://ats.rippling.com/pace/jobs' },
  {
    atsType: 'custom_static',
    companyName: 'Lightspeed Commerce',
    boardId: 'lightspeedhq',
    apiUrl: 'https://www.lightspeedhq.com/careers/openings/',
    resolvedBoardUrl: 'https://www.lightspeedhq.com/careers/openings/',
  },
];

export async function runAtsLiveCanary({ logger = console } = {}) {
  const store = createStore();
  const tenantId = `tenant-ats-live-canary-${Date.now()}`;
  store.ensureTenant({ id: tenantId, name: 'ATS live canary' }, { id: `${tenantId}-owner`, name: 'Canary owner' });
  await store.patchSettings(tenantId, { geographyFocus: 'Global' });

  for (const board of LIVE_BOARDS) {
    const account = await store.addAccount(tenantId, { displayName: board.companyName });
    store.addConfig(tenantId, {
      ...board,
      accountId: account.id,
      discoveryStatus: 'resolved',
      reviewStatus: 'approved',
      active: true,
    });
  }

  const startedAt = Date.now();
  const result = await store.importLiveJobs(tenantId, {
    plan: { displayName: 'Live canary', limits: { jobBoards: -1 } },
    autoDiscover: false,
    fetchConcurrency: 4,
  });
  const imported = await store.findJobs(tenantId, { page: 1, pageSize: 10000 });
  const errorsByProvider = new Map((result.errors || []).map((error) => [error.atsType, error.error]));
  const rows = LIVE_BOARDS.map((board) => {
    const count = imported.items.filter((job) => job.atsType === board.atsType).length;
    const error = errorsByProvider.get(board.atsType) || '';
    return {
      provider: board.atsType,
      board: board.companyName,
      jobs: count,
      status: count > 0 && !error ? 'PASS' : 'FAIL',
      error,
    };
  });
  const failed = rows.filter((row) => row.status === 'FAIL');
  logger.table?.(rows);
  logger.log?.(`Live ATS canary: ${rows.length - failed.length}/${rows.length} providers passed; ${imported.total} public jobs imported in ${Date.now() - startedAt}ms.`);
  return { ok: failed.length === 0, rows, totalJobs: imported.total, importResult: result };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const result = await runAtsLiveCanary();
  if (!result.ok) process.exitCode = 1;
}
