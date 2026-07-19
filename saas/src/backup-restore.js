import { BACKUP_TABLES } from './backup-schema.js';

const TABLE_SCHEMA = new Map(BACKUP_TABLES.map((table) => [table.name, table]));

export function quoteBackupIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

export function validateBackupRows(backup) {
  const unknownTables = Object.keys(backup.tables).filter((table) => !TABLE_SCHEMA.has(table));
  if (unknownTables.length) throw new Error(`Backup contains unsupported tables: ${unknownTables.join(', ')}`);
  for (const [table, rows] of Object.entries(backup.tables)) {
    if (!Array.isArray(rows)) throw new Error(`Backup table ${table} must contain an array.`);
    const schema = TABLE_SCHEMA.get(table);
    for (const row of rows) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        throw new Error(`Backup contains an invalid ${table} row.`);
      }
      const missingKey = schema.conflict.find((column) => row[column] === undefined || row[column] === null);
      if (missingKey) throw new Error(`Backup ${table} row is missing required key ${missingKey}.`);
    }
  }
}

export function buildBackupUpsert(table, row) {
  const schema = TABLE_SCHEMA.get(table);
  if (!schema) throw new Error(`Backup contains an unsupported table: ${table}`);
  const columns = Object.keys(row).filter((key) => row[key] !== undefined);
  const columnSql = columns.map(quoteBackupIdentifier).join(', ');
  const valueSql = columns.map((_, index) => `$${index + 1}`).join(', ');
  const conflictSql = schema.conflict.map(quoteBackupIdentifier).join(', ');
  const updateColumns = columns.filter((column) => !schema.conflict.includes(column));
  const updateSql = updateColumns.length
    ? `DO UPDATE SET ${updateColumns.map((column) => `${quoteBackupIdentifier(column)} = EXCLUDED.${quoteBackupIdentifier(column)}`).join(', ')}`
    : 'DO NOTHING';
  return {
    text: `INSERT INTO ${quoteBackupIdentifier(table)} (${columnSql}) VALUES (${valueSql}) ON CONFLICT (${conflictSql}) ${updateSql}`,
    values: columns.map((column) => {
      const value = row[column];
      return value && typeof value === 'object' ? JSON.stringify(value) : value;
    }),
  };
}
