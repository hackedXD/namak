// Offline schema smoke test — applies every migration in order into an in-memory
// SQLite (node:sqlite, the local analog of Cloudflare D1) and asserts the expected
// objects exist. No network, no native deps. Run: pnpm --filter @salt/schema test
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', 'migrations');

const EXPECTED_TABLES = [
  'source',
  'source_snapshot',
  'molecule',
  'molecule_synonym',
  'formulation',
  'formulation_component',
  'channel',
  'product',
  'product_price',
  'ceiling_price',
  'recall',
  'outlet',
  'substitution_rule',
  'match_audit',
  'knowledge_version',
  'staging_ceiling',
];

const db = new DatabaseSync(':memory:');

const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

if (files.length === 0) {
  console.error('FAIL: no migration files found in', migrationsDir);
  process.exit(1);
}

for (const f of files) {
  const sql = readFileSync(join(migrationsDir, f), 'utf8');
  try {
    db.exec(sql);
    console.log(`applied ${f}`);
  } catch (e) {
    console.error(`FAIL applying ${f}:`, e.message);
    process.exit(1);
  }
}

const rows = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
  .all()
  .map((r) => r.name)
  .filter((n) => !n.startsWith('sqlite_'));

const missing = EXPECTED_TABLES.filter((t) => !rows.includes(t));
if (missing.length) {
  console.error('FAIL: missing tables:', missing.join(', '));
  process.exit(1);
}

// Foreign keys must be enforceable: turn on the pragma and integrity-check.
db.exec('PRAGMA foreign_keys = ON;');
const fkErrors = db.prepare('PRAGMA foreign_key_check').all();
if (fkErrors.length) {
  console.error('FAIL: foreign_key_check reported issues:', fkErrors);
  process.exit(1);
}

console.log(`\nOK: ${rows.length} tables present, all ${EXPECTED_TABLES.length} expected tables found, FK check clean.`);
