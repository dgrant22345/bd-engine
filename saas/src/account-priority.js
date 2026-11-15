const count = value => Math.max(0, Number(value) || 0);
const diminishing = (value, weight, scale) => weight * Math.min(1, Math.log2(1 + count(value)) / scale);

export function calculateAccountPriority(item = {}, nowMs = Date.now()) {
  const focused = item.relevantRoleCount !== null && item.relevantRoleCount !== undefined;
  const roles = count(focused ? item.relevantRoleCount : item.openRoleCount ?? item.jobCount);
  const network = diminishing(item.connectionCount, 20, 4)
    + diminishing(item.seniorContactCount, 10, 2) + diminishing(item.talentContactCount, 10, 2);
  const verifiedAge = (nowMs - Date.parse(item.lastHiringVerifiedAt || '')) / 86400000;
  const freshness = Number.isFinite(verifiedAge) && verifiedAge >= 0
    ? (verifiedAge <= 2 ? 10 : verifiedAge <= 7 ? 6 : verifiedAge <= 14 ? 2 : 0) : 0;
  const coverage = ['failed', 'partial'].includes(item.hiringCoverage) ? 0.6 : 1;
  const hiring = (diminishing(roles, 25, 5) + diminishing(Math.min(roles, count(item.newRoleCount7d)), 15, 4)) * coverage;
  const lastContact = Date.parse(item.lastContactedAt || '');
  const contactAge = (nowMs - lastContact) / 86400000;
  const followup = network > 0 && roles > 0 ? (!Number.isFinite(lastContact) || contactAge >= 14 ? 10 : contactAge >= 7 ? 5 : 0) : 0;
  const score = Math.max(0, Math.min(100, Math.round(network + hiring + (roles ? freshness : 0) + followup)));
  return { score, explanation: `${roles} ${focused ? 'matching' : 'active'} role${roles === 1 ? '' : 's'}, ${count(item.connectionCount)} contact${count(item.connectionCount) === 1 ? '' : 's'} in your network. ${focused ? '' : 'Set a role focus to measure fit. '}${item.hiringCoverage === 'partial' ? 'Source coverage is incomplete. ' : item.hiringCoverage === 'failed' ? 'The source needs a successful refresh. ' : ''}${freshness ? 'Hiring evidence was checked recently.' : 'Hiring evidence needs a fresh check.'}` };
}

export function applyAccountPriority(item, nowMs = Date.now()) {
  const { score, explanation } = calculateAccountPriority(item, nowMs);
  item.targetScore = score;
  item.dailyScore = score;
  item.alertPriorityScore = score;
  item.targetScoreExplanation = explanation;
}
