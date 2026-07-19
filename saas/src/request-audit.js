const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

export function buildMutationAuditEntry({ method, statusCode, tenantId, userId, url, requestId }) {
  const normalizedMethod = String(method || '').toUpperCase();
  const normalizedStatus = Number(statusCode || 0);
  if (!MUTATING_METHODS.has(normalizedMethod) || !tenantId || !userId) return null;
  if (normalizedStatus < 200 || normalizedStatus >= 400) return null;

  let pathname;
  try {
    pathname = new URL(String(url || '/'), 'http://localhost').pathname;
  } catch {
    pathname = '/';
  }
  const routeParts = pathname.split('/').filter(Boolean);
  return {
    tenantId,
    actorUserId: userId,
    action: `api.${normalizedMethod.toLowerCase()}`,
    entityType: routeParts[0] === 'api' ? routeParts[1] || 'workspace' : 'workspace',
    metadata: {
      route: pathname,
      statusCode: normalizedStatus,
      requestId: String(requestId || ''),
    },
  };
}
