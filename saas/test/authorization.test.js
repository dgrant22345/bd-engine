import test from 'node:test';
import assert from 'node:assert/strict';

import { canDeleteWorkspaceData, canManageBilling, canMutateWorkspace } from '../src/authorization.js';

test('viewer access is read-only while workspace members can change customer data', () => {
  assert.equal(canMutateWorkspace('viewer', 'GET'), true);
  assert.equal(canMutateWorkspace('viewer', 'POST'), false);
  assert.equal(canMutateWorkspace('member', 'PATCH'), true);
  assert.equal(canMutateWorkspace('owner', 'DELETE'), true);
});

test('billing and destructive privacy actions require elevated roles', () => {
  assert.equal(canManageBilling('member'), false);
  assert.equal(canManageBilling('admin'), true);
  assert.equal(canManageBilling('owner'), true);
  assert.equal(canDeleteWorkspaceData('admin'), false);
  assert.equal(canDeleteWorkspaceData('owner'), true);
});
