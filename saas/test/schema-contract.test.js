import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSchemaManifest } from '../scripts/check-schema-contract.mjs';

test('schema manifest is stable across platform line endings', () => {
  const source = `
    CREATE TABLE IF NOT EXISTS example_table (id TEXT PRIMARY KEY);
    CREATE UNIQUE INDEX IF NOT EXISTS example_identity_idx ON example_table (id);
    await runSchemaMigration('20260718_example', 'Example migration', async () => {});
  `.trim();

  assert.deepEqual(
    buildSchemaManifest(source.replaceAll('\n', '\r\n')),
    buildSchemaManifest(source),
  );
});
