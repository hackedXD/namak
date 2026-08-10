// A minimal database port shaped like the subset of the Cloudflare D1 API we use.
// The real D1 binding satisfies this directly in production; the SQLite adapter
// (sqlite.ts) satisfies it for local dev and tests. Repos are written against
// this port, so there is ONE repo implementation for both environments.

export interface D1Result<T> {
  results: T[];
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<{ success: boolean }>;
}

export interface D1Like {
  prepare(sql: string): D1PreparedStatement;
}
