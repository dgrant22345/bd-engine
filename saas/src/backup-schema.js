export const BACKUP_TABLES = Object.freeze([
  { name: 'users', orderBy: 'id', conflict: ['id'] },
  { name: 'tenants', orderBy: 'id', conflict: ['id'] },
  { name: 'memberships', orderBy: 'tenant_id, user_id', conflict: ['tenant_id', 'user_id'] },
  { name: 'tenant_data', orderBy: 'tenant_id', conflict: ['tenant_id'] },
  { name: 'accounts', orderBy: 'tenant_id, id', conflict: ['id'] },
  { name: 'contacts', orderBy: 'tenant_id, id', conflict: ['id'] },
  { name: 'jobs', orderBy: 'tenant_id, id', conflict: ['id'] },
  { name: 'board_configs', orderBy: 'tenant_id, id', conflict: ['id'] },
  { name: 'activities', orderBy: 'tenant_id, id', conflict: ['id'] },
  { name: 'tasks', orderBy: 'tenant_id, id', conflict: ['id'] },
  { name: 'import_runs', orderBy: 'tenant_id, started_at, id', conflict: ['id'] },
  { name: 'import_run_items', orderBy: 'tenant_id, id', conflict: ['id'], serial: 'id' },
  { name: 'audit_log', orderBy: 'tenant_id, id', conflict: ['id'], serial: 'id' },
  { name: 'support_tickets', orderBy: 'tenant_id, created_at, id', conflict: ['id'] },
  { name: 'support_ticket_messages', orderBy: 'tenant_id, ticket_id, created_at, id', conflict: ['id'], serial: 'id' },
  { name: 'background_jobs', orderBy: 'tenant_id, updated_at, id', conflict: ['id'] },
  { name: 'account_closures', orderBy: 'requested_at, id', conflict: ['id'] },
  { name: 'stripe_webhook_events', orderBy: 'created_at, event_id', conflict: ['event_id'] },
  { name: 'schema_migrations', orderBy: 'id', conflict: ['id'] },
  { name: 'analytics_events', orderBy: 'id', conflict: ['id'], serial: 'id', analytics: true },
  { name: 'sessions', orderBy: 'id', conflict: ['id'], volatile: true },
  { name: 'password_reset_tokens', orderBy: 'created_at', conflict: ['token_hash'], volatile: true },
  { name: 'email_verification_tokens', orderBy: 'created_at', conflict: ['token_hash'], volatile: true },
  { name: 'rate_limit_buckets', orderBy: 'bucket_key', conflict: ['bucket_key'], volatile: true },
]);

export function backupTables({ includeVolatile = false, skipAnalytics = false } = {}) {
  return BACKUP_TABLES.filter((table) => {
    if (table.volatile && !includeVolatile) return false;
    if (table.analytics && skipAnalytics) return false;
    return true;
  });
}
