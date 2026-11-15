// Reconcile a retry's temporary ID with the durable natural identity. Saved
// workflow state belongs to the durable record, not a newly fetched ATS row.
export function mergeImportedJob(existing, incoming, previous = null) {
  const merged = { ...existing, ...incoming, id: existing.id, tenantId: existing.tenantId,
    createdAt: existing.createdAt || incoming.createdAt,
    firstSeenAt: existing.firstSeenAt || existing.createdAt || incoming.firstSeenAt };
  for (const key of ['pipelineStage', 'relevanceFeedback']) {
    if (previous && key === 'pipelineStage' && !existing[key] && previous[key]) merged[key] = previous[key];
    else if (Object.hasOwn(existing, key)) merged[key] = existing[key];
    else if (previous && Object.hasOwn(previous, key)) merged[key] = previous[key];
  }
  if (previous?.firstSeenAt && Date.parse(previous.firstSeenAt) < Date.parse(merged.firstSeenAt)) merged.firstSeenAt = previous.firstSeenAt;
  return merged;
}

export function applyJobIdentityResolutions(rows, resolutions = []) {
  if (!resolutions.length) return;
  const byId = new Map(rows.map(row => [row.id, row]));
  for (const { incomingId, job, retiredJob } of resolutions) {
    if (incomingId !== job.id && !retiredJob) byId.delete(incomingId);
    for (const row of [job, retiredJob].filter(Boolean)) {
      const existing = byId.get(row.id);
      if (existing) Object.assign(existing, row);
      else byId.set(row.id, row);
    }
  }
  rows.splice(0, rows.length, ...byId.values());
}
