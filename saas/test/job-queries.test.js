import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTenantJobQueries } from '../src/job-queries.js';

test('job list and count share relational filters without a legacy jobs join', () => {
  const query = buildTenantJobQueries('tenant-one', { geography: 'canada', minRelevance: 45, hasContacts: true, page: 2, pageSize: 20 });
  for (const statement of [query.rows, query.count]) {
    assert.doesNotMatch(statement.text, /tenant_data|source_order/);
    assert.match(statement.text, /j\.tenant_id = \$1/);
    assert.match(statement.text, /contacts WHERE tenant_id = \$1/);
    assert.match(statement.text, /matchesSearchFocus/);
    assert.equal(statement.params[0], 'tenant-one');
  }
  assert.match(query.rows.text, /j\.id ASC/);
  assert.deepEqual(query.rows.params.slice(-2), [20, 20]);
});

test('untrusted search and pipeline ids remain bound parameters', () => {
  const query = buildTenantJobQueries('tenant-one', { q: "test%' OR TRUE --", ids: 'first,second', pageSize: 'NaN', page: -2 });
  assert.equal(query.page, 1);
  assert.equal(query.pageSize, 25);
  assert.doesNotMatch(query.rows.text, /OR TRUE --/);
  assert.match(query.rows.text, /j\.id = ANY/);
  assert.deepEqual(query.count.params[1], ['first', 'second']);
});
