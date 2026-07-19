import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const dbPath = fileURLToPath(new URL('../src/db.js', import.meta.url));
const manifestPath = fileURLToPath(new URL('../schema-manifest.json', import.meta.url));

function uniqueMatches(source, pattern) {
  return [...new Set([...source.matchAll(pattern)].map((match) => match[1]))].sort();
}

export function buildSchemaManifest(source) {
  const normalizedSource = source.replace(/\r\n?/g, '\n');
  const migrations = [...normalizedSource.matchAll(/runSchemaMigration\('([^']+)',\s*'([^']+)'/g)]
    .map((match) => ({ id: match[1], description: match[2] }));
  return {
    generatedFrom: 'src/db.js',
    sourceSha256: createHash('sha256').update(normalizedSource).digest('hex'),
    migrations,
    tables: uniqueMatches(normalizedSource, /CREATE TABLE IF NOT EXISTS\s+([a-zA-Z0-9_]+)/g),
    indexes: uniqueMatches(normalizedSource, /CREATE (?:UNIQUE )?INDEX IF NOT EXISTS\s+([a-zA-Z0-9_]+)/g),
  };
}

function validateManifest(manifest) {
  const ids = manifest.migrations.map((migration) => migration.id);
  if (new Set(ids).size !== ids.length) throw new Error('Migration IDs must be unique.');
  if (ids.some((id) => !/^\d{8}_[a-z0-9_]+$/.test(id))) throw new Error('Migration IDs must use YYYYMMDD_description format.');
  for (let index = 1; index < ids.length; index += 1) {
    if (ids[index].slice(0, 8) < ids[index - 1].slice(0, 8)) {
      throw new Error(`Migration ${ids[index]} is dated before ${ids[index - 1]}.`);
    }
  }
  for (const required of ['users', 'tenants', 'memberships', 'tenant_data', 'sessions', 'schema_migrations']) {
    if (!manifest.tables.includes(required)) throw new Error(`Required table ${required} is missing from db.js.`);
  }
}

const source = await readFile(dbPath, 'utf8');
const actual = buildSchemaManifest(source);
validateManifest(actual);

if (process.argv.includes('--write')) {
  await writeFile(manifestPath, `${JSON.stringify(actual, null, 2)}\n`, 'utf8');
  console.log(`Schema contract updated: ${actual.tables.length} tables, ${actual.indexes.length} indexes, ${actual.migrations.length} migrations.`);
} else {
  const expected = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new Error('Schema contract drift detected. Review db.js, then run npm run schema:manifest and commit the result.');
  }
  console.log(`Schema contract verified: ${actual.tables.length} tables, ${actual.indexes.length} indexes, ${actual.migrations.length} migrations.`);
}
