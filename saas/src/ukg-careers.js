import { fetchPaginatedAtsJobs, readAtsReportedTotal } from './ats-pagination.js';
import { ukgBoard } from '../public/ukg-board.js';

export { ukgBoard };

export function ukgProPage(payload, boardUrl) {
  if (!Array.isArray(payload?.opportunities)) throw new Error('UKG Pro: invalid opportunities; existing jobs preserved');
  const total = readAtsReportedTotal(payload.totalCount);
  if (total === null) throw new Error('UKG Pro: results count missing; existing jobs preserved');
  return { total, jobs: payload.opportunities.map(row => {
    if (!row?.Title || !/^[a-f\d-]{36}$/i.test(row.Id || '')) return { id: '', title: '' };
    const url = new URL(`${boardUrl}/OpportunityDetail`); url.searchParams.set('opportunityId', row.Id);
    const location = (Array.isArray(row.Locations) ? row.Locations : []).map(item => {
      const a = item.Address || {}; return [a.City, a.State?.Name || a.State?.Code, a.Country?.Name || a.Country?.Code].filter(Boolean).join(', ');
    }).filter(Boolean).join('; ');
    return { id: row.Id, title: row.Title, url: url.toString(), location,
      department: row.JobCategoryName || '', employmentType: row.FullTime === true ? 'Full time' : row.FullTime === false ? 'Part time' : '', postedAt: row.PostedDate || '' };
  }) };
}

export function ukgReadyPage(payload, descriptor) {
  if (!Array.isArray(payload?.job_requisitions)) throw new Error('UKG Ready: invalid requisitions; existing jobs preserved');
  const total = readAtsReportedTotal(payload._paging?.total);
  if (total === null) throw new Error('UKG Ready: results count missing; existing jobs preserved');
  return { total, jobs: payload.job_requisitions.map(row => {
    if (!row?.job_title || !/^\d+$/.test(String(row.id || ''))) return { id: '', title: '' };
    const url = new URL(descriptor.url); url.searchParams.set('ShowJob', row.id);
    const a = row.location || {}, country = ({ CAN: 'Canada', USA: 'United States' })[a.country] || a.country;
    const location = [a.city, typeof a.state === 'string' ? a.state : a.state?.name || a.state?.code, country].filter(Boolean).join(', ');
    return { id: String(row.id), title: row.job_title, url: url.toString(),
      location: row.is_remote_job ? `Remote${location ? `; ${location}` : ''}` : location,
      employmentType: row.employee_type?.name || '', postedAt: '' };
  }) };
}

export async function readUkgBoard(value, { getJson, postJson, timeBudgetMs = 120000 }) {
  const board = ukgBoard(value);
  if (!board) throw new Error('UKG: valid public board URL missing; existing jobs preserved');
  const pageSize = board.type === 'ukg_pro' ? 50 : 20;
  return fetchPaginatedAtsJobs({ providerName: board.type === 'ukg_pro' ? 'UKG Pro' : 'UKG Ready',
    pageSize, maxPages: 250, concurrency: 2, timeBudgetMs, recheckFirstPage: true, jobKey: job => job.id,
    readPage: async (offset, budget) => {
      if (board.type === 'ukg_pro') {
        const payload = await postJson(`${board.url}/JobBoardView/LoadSearchResults`,
          { opportunitySearch: { Top: pageSize, Skip: offset, QueryString: '', Filters: [] } }, budget);
        return ukgProPage(payload, board.url);
      }
      const url = new URL(`/ta/rest/ui/recruitment/companies/${encodeURIComponent(`|${board.company}`)}/job-requisitions`, board.url);
      // UKG Ready calls its one-based page number "offset" (not a row index).
      url.searchParams.set('offset', offset / pageSize + 1); url.searchParams.set('size', pageSize);
      const publicUrl = new URL(board.url);
      for (const key of ['lang', 'ein_id', 'career_portal_id']) if (publicUrl.searchParams.has(key)) url.searchParams.set(key, publicUrl.searchParams.get(key));
      return ukgReadyPage(await getJson(url.toString(), budget), board);
    },
  });
}
