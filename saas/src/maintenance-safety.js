const MIN_BACKUP_REFERENCE_LENGTH = 12;

export function requireMaintenanceApproval({
  apply = false,
  tenantId = '',
  confirmation = '',
  expectedConfirmation = '',
  backupReference = '',
  action = 'Applying this maintenance operation',
  requireTenant = true,
} = {}) {
  if (!apply) return;
  if (requireTenant && !String(tenantId || '').trim()) {
    throw new Error(`${action} requires --tenant <tenant-id>.`);
  }
  if (confirmation !== expectedConfirmation) {
    throw new Error(`${action} requires --confirm ${expectedConfirmation}.`);
  }
  if (String(backupReference || '').trim().length < MIN_BACKUP_REFERENCE_LENGTH) {
    throw new Error(`${action} requires --backup-reference <verified-backup-id-or-sha>.`);
  }
}

export function workspaceLabel(index) {
  return `workspace ${Number(index) + 1}`;
}
