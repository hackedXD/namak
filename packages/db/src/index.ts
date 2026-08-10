// @salt/db — repository interfaces + D1/SQLite implementations.
// The ONLY package that writes SQL (design §2.1).
export type { D1Like, D1PreparedStatement, D1Result } from './port.js';
export { SqliteD1 } from './sqlite.js';
export {
  D1MetaRepo,
  D1FormulationRepo,
} from './repos.js';
export type {
  MetaRepo,
  FormulationRepo,
  SourceStaleness,
  PricedProduct,
  CeilingRow,
} from './repos.js';
