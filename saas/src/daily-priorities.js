const DAY_MS = 86400000;
const LANES = { follow_up: 0, fresh_hiring: 1, active_hiring: 2, research: 3 };
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;

// Inputs are already tenant-scoped. Index evidence once rather than scanning
// every role, contact and task again for each account.
export function rankDailyAccounts(accounts, { jobs = [], contacts = [], tasks = [], now = new Date() } = {}) {
  const today = now.toISOString().slice(0, 10);
  const evidence = new Map();
  for (const account of accounts) {
    if (account.tracked === false || account.status === 'paused') continue;
    evidence.set(account.id, { account, activeRoles: 0, freshRoles: 0, contact: null, dueTasks: 0, dueAt: '', taskSummary: '' });
  }
  for (const job of jobs) {
    const item = evidence.get(job.accountId);
    if (!item || job.active === false || job.relevanceFeedback?.vote === 'not_relevant') continue;
    if (job.relevanceFeedback?.vote !== 'relevant' && (job.relevanceBand === 'low' || (job.relevanceScore != null && job.matchesSearchFocus === false))) continue;
    item.activeRoles++;
    // Import time alone is not evidence that a vacancy was recently posted.
    const age = now.getTime() - Date.parse(job.postedAt || '');
    if (Number.isFinite(age) && age >= 0 && age <= 7 * DAY_MS) item.freshRoles++;
  }
  for (const contact of contacts) {
    const item = evidence.get(contact.accountId);
    if (!item || !contact.fullName) continue;
    if (!item.contact || number(contact.priorityScore) > number(item.contact.priorityScore)
      || (number(contact.priorityScore) === number(item.contact.priorityScore) && String(contact.id).localeCompare(String(item.contact.id)) < 0)) item.contact = contact;
  }
  for (const task of tasks) {
    const item = evidence.get(task.accountId);
    const dueAt = Date.parse(task.dueDate || '');
    if (!item || task.status !== 'pending' || !Number.isFinite(dueAt) || new Date(dueAt).toISOString().slice(0, 10) > today) continue;
    item.dueTasks++;
    if (!item.dueAt || dueAt < Date.parse(item.dueAt)) {
      item.dueAt = task.dueDate;
      item.taskSummary = task.summary || task.title || 'Review follow-up';
    }
  }
  return [...evidence.values()].map(item => {
    const scheduled = Date.parse(item.account.nextActionAt || '');
    if (Number.isFinite(scheduled) && new Date(scheduled).toISOString().slice(0, 10) <= today && (!item.dueAt || scheduled < Date.parse(item.dueAt))) {
      item.dueAt = item.account.nextActionAt;
      item.taskSummary = item.account.nextAction || item.account.recommendedAction || 'Review scheduled next step';
    }
    const lane = item.dueAt ? 'follow_up' : item.freshRoles ? 'fresh_hiring' : item.activeRoles ? 'active_hiring' : 'research';
    const reason = lane === 'follow_up'
      ? item.dueTasks ? `${item.dueTasks} follow-up${item.dueTasks === 1 ? '' : 's'} due today or overdue` : 'Scheduled next step due today or overdue'
      : lane === 'fresh_hiring' ? `${item.freshRoles} active role${item.freshRoles === 1 ? '' : 's'} posted in the last 7 days`
        : lane === 'active_hiring' ? `${item.activeRoles} active role${item.activeRoles === 1 ? '' : 's'} to review`
          : 'Research company and verify hiring before outreach';
    return { ...item.account, dailyPriority: { lane, reason, dueTasks: item.dueTasks, dueAt: item.dueAt, taskSummary: item.taskSummary,
      activeRoles: item.activeRoles, freshRoles: item.freshRoles, contactName: item.contact?.fullName || '' } };
  }).sort((a, b) => {
    const left = a.dailyPriority; const right = b.dailyPriority;
    return LANES[left.lane] - LANES[right.lane]
      || (left.dueAt && right.dueAt ? Date.parse(left.dueAt) - Date.parse(right.dueAt) : 0)
      || Number(Boolean(right.contactName)) - Number(Boolean(left.contactName))
      || number(b.targetScore ?? b.dailyScore) - number(a.targetScore ?? a.dailyScore)
      || String(a.id).localeCompare(String(b.id));
  });
}
