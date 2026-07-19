const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

export function canMutateWorkspace(role, method) {
  if (!MUTATING_METHODS.has(String(method || '').toUpperCase())) return true;
  return ['owner', 'admin', 'member'].includes(String(role || '').toLowerCase());
}

export function canManageBilling(role) {
  return ['owner', 'admin'].includes(String(role || '').toLowerCase());
}

export function canDeleteWorkspaceData(role) {
  return String(role || '').toLowerCase() === 'owner';
}
