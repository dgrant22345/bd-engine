import { createHash } from 'node:crypto';

export function accountClosureSubjectHash(userId) {
  return createHash('sha256').update(String(userId || '')).digest('hex');
}

export function buildAccountClosurePlan(userId, tenants = [], memberships = []) {
  const tenantMap = new Map((tenants || []).map((tenant) => [tenant.id, tenant]));
  const userMemberships = (memberships || []).filter((membership) => membership.userId === userId);
  const deleteTenants = [];
  const leaveTenants = [];
  const blockers = [];

  for (const membership of userMemberships) {
    const tenant = tenantMap.get(membership.tenantId);
    if (!tenant) {
      leaveTenants.push({ id: membership.tenantId, name: 'Unavailable workspace', role: membership.role });
      continue;
    }
    const others = memberships.filter((item) => item.tenantId === tenant.id && item.userId !== userId);
    const otherOwners = others.filter((item) => item.role === 'owner');
    if (membership.role === 'owner' && others.length > 0 && otherOwners.length === 0) {
      blockers.push({
        tenantId: tenant.id,
        tenantName: tenant.name,
        code: 'last_owner_with_collaborators',
        message: `Transfer ownership of ${tenant.name} before closing your account.`,
      });
    } else if (others.length > 0 || membership.role !== 'owner') {
      leaveTenants.push({ id: tenant.id, name: tenant.name, role: membership.role });
    } else {
      deleteTenants.push({
        id: tenant.id,
        name: tenant.name,
        role: membership.role,
        subscriptionId: tenant.stripeSubscriptionId || tenant.stripe_subscription_id || '',
      });
    }
  }

  return {
    eligible: blockers.length === 0,
    blockers,
    deleteTenants,
    leaveTenants,
    subscriptionIds: [...new Set(deleteTenants.map((tenant) => tenant.subscriptionId).filter(Boolean))],
  };
}
