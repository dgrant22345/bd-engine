import test from 'node:test';
import assert from 'node:assert/strict';

import { accountClosureSubjectHash, buildAccountClosurePlan } from '../src/account-closure.js';

const tenants = [
  { id: 'solo', name: 'Solo', stripeSubscriptionId: 'sub_solo' },
  { id: 'shared', name: 'Shared' },
  { id: 'orphan-risk', name: 'Needs owner' },
  { id: 'member', name: 'Member workspace' },
];
const memberships = [
  { tenantId: 'solo', userId: 'closing', role: 'owner' },
  { tenantId: 'shared', userId: 'closing', role: 'owner' },
  { tenantId: 'shared', userId: 'other-owner', role: 'owner' },
  { tenantId: 'orphan-risk', userId: 'closing', role: 'owner' },
  { tenantId: 'orphan-risk', userId: 'collaborator', role: 'member' },
  { tenantId: 'member', userId: 'closing', role: 'member' },
  { tenantId: 'member', userId: 'member-owner', role: 'owner' },
];

test('account closure deletes solo workspaces and leaves safely owned shared workspaces', () => {
  const plan = buildAccountClosurePlan('closing', tenants, memberships);
  assert.equal(plan.eligible, false);
  assert.deepEqual(plan.deleteTenants.map((tenant) => tenant.id), ['solo']);
  assert.deepEqual(plan.leaveTenants.map((tenant) => tenant.id), ['shared', 'member']);
  assert.deepEqual(plan.subscriptionIds, ['sub_solo']);
});

test('account closure blocks orphaning collaborators without another owner', () => {
  const plan = buildAccountClosurePlan('closing', tenants, memberships);
  assert.deepEqual(plan.blockers, [{
    tenantId: 'orphan-risk',
    tenantName: 'Needs owner',
    code: 'last_owner_with_collaborators',
    message: 'Transfer ownership of Needs owner before closing your account.',
  }]);
});

test('closure ledger identity is stable and does not expose the user id', () => {
  const subjectHash = accountClosureSubjectHash('user-private-id');
  assert.equal(subjectHash, accountClosureSubjectHash('user-private-id'));
  assert.equal(subjectHash.length, 64);
  assert.equal(subjectHash.includes('user-private-id'), false);
});
