// Local SQLite adapter that satisfies the D1Like port, for dev and tests.
// Wraps node:sqlite (SQLite is D1's engine, so behaviour matches). Sync under the
// hood, exposed as async to mirror D1. NOTE: run with
//   node --experimental-sqlite
// (the package's test script sets this via NODE_OPTIONS).

import process from 'node:process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { D1Like, D1PreparedStatement, D1Result } from './port.js';

// node:sqlite is an experimental builtin whose static import trips up bundlers
// (vite's builtin list predates it). Load it at runtime via getBuiltinModule so
// there is no static import to resolve. Requires `node --experimental-sqlite`.
interface StatementSync {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
  run(...params: unknown[]): unknown;
}
interface DatabaseSyncInstance {
  prepare(sql: string): StatementSync;
  exec(sql: string): void;
}
type DatabaseSyncCtor = new (path: string) => DatabaseSyncInstance;
const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as {
  DatabaseSync: DatabaseSyncCtor;
};

class SqliteStatement implements D1PreparedStatement {
  private values: unknown[] = [];
  constructor(
    private readonly db: DatabaseSyncInstance,
    private readonly sql: string,
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    this.values = values;
    return this;
  }

  async all<T>(): Promise<D1Result<T>> {
    const stmt = this.db.prepare(this.sql);
    return { results: stmt.all(...(this.values as never[])) as T[] };
  }

  async first<T>(): Promise<T | null> {
    const stmt = this.db.prepare(this.sql);
    const row = stmt.get(...(this.values as never[]));
    return (row as T) ?? null;
  }

  async run(): Promise<{ success: boolean }> {
    const stmt = this.db.prepare(this.sql);
    stmt.run(...(this.values as never[]));
    return { success: true };
  }
}

export class SqliteD1 implements D1Like {
  readonly db: DatabaseSyncInstance;

  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA foreign_keys = ON;');
  }

  prepare(sql: string): D1PreparedStatement {
    return new SqliteStatement(this.db, sql);
  }

  /** Apply @salt/schema migrations (dev/test convenience). */
  applyMigrations(migrationsDir: string): void {
    for (const f of readdirSync(migrationsDir).filter((x) => x.endsWith('.sql')).sort()) {
      this.db.exec(readFileSync(join(migrationsDir, f), 'utf8'));
    }
  }

  /** Direct exec for seeding in tests. */
  exec(sql: string): void {
    this.db.exec(sql);
  }
}
