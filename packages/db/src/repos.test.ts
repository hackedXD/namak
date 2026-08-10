import { describe, it, expect, beforeEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SqliteD1 } from './sqlite.js';
import { D1MetaRepo, D1FormulationRepo } from './repos.js';

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'schema', 'migrations');

let db: SqliteD1;
beforeEach(() => {
  db = new SqliteD1(':memory:');
  db.applyMigrations(MIGRATIONS);
});

// These insert SOURCE-REGISTRY + SNAPSHOT metadata (not drug data) — the real
// shape the ingestion pipeline writes.
function seedMeta(): void {
  db.exec(`
    INSERT INTO source(id,name,url,license,cadence,tier) VALUES
      ('nppa_ceiling','NPPA ceiling prices','https://nppa.gov.in','public','event',1),
      ('geonames_pincode','GeoNames pincode','https://download.geonames.org','cc-by-4.0','rare',2);
    INSERT INTO source_snapshot(source_id,sha256,r2_key,fetched_at,status) VALUES
      ('nppa_ceiling','aa','raw/nppa/1.pdf','2026-08-01T00:00:00+00:00','promoted'),
      ('geonames_pincode','bb','raw/gn/1.zip','2026-06-01T00:00:00+00:00','promoted');
    INSERT INTO knowledge_version(version,promoted_at,snapshot_ids) VALUES (7,'2026-08-01T00:00:00+00:00','[1,2]');
  `);
}

describe('D1MetaRepo', () => {
  it('reports the latest knowledge version', async () => {
    seedMeta();
    expect(await new D1MetaRepo(db).knowledgeVersion()).toBe(7);
  });

  it('returns 0 when nothing has been promoted', async () => {
    expect(await new D1MetaRepo(db).knowledgeVersion()).toBe(0);
  });

  it('computes per-source staleness in days from the last promoted snapshot', async () => {
    seedMeta();
    const sources = await new D1MetaRepo(db).sources('2026-08-10T00:00:00+00:00');
    const byId = Object.fromEntries(sources.map((s) => [s.sourceId, s]));
    expect(byId['nppa_ceiling']!.staleDays).toBe(9); // Aug 1 → Aug 10
    expect(byId['nppa_ceiling']!.status).toBe('fresh');
    expect(byId['geonames_pincode']!.staleDays).toBe(70); // Jun 1 → Aug 10
    expect(byId['geonames_pincode']!.status).toBe('stale'); // > 45 days
  });

  it("marks a source with no promoted snapshot as 'never'", async () => {
    db.exec(`INSERT INTO source(id,name,url,license,cadence,tier) VALUES ('s2_kendra','Kendras','x','public','monthly',1);`);
    const sources = await new D1MetaRepo(db).sources('2026-08-10T00:00:00+00:00');
    expect(sources[0]!.status).toBe('never');
    expect(sources[0]!.staleDays).toBeNull();
  });
});

describe('D1FormulationRepo — SQL is valid and returns empty until canonical data lands', () => {
  it('byId / currentPrices / currentCeiling run cleanly with no canonical rows', async () => {
    seedMeta();
    const repo = new D1FormulationRepo(db);
    expect(await repo.byId(1)).toBeNull();
    expect(await repo.byCanonicalKey('tablet|IR|1:650:mg:-')).toBeNull();
    expect(await repo.currentPrices(1)).toEqual([]);
    expect(await repo.currentCeiling(1)).toBeNull();
  });
});
