import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { FormulationRecord } from '@salt/domain';
import {
  SqliteD1,
  D1MetaRepo,
  type FormulationRepo,
  type MetaRepo,
  type PricedProduct,
  type CeilingRow,
} from '@salt/db';
import { createApp } from './app.js';
import { DEFAULT_CHANNEL_TIER } from './deps.js';

const NOW = '2026-08-10T00:00:00+00:00';
const MIGRATIONS = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'packages',
  'schema',
  'migrations',
);

// ── Fake formulation repo returning the design's Appendix A worked example ──
const para650: FormulationRecord = {
  id: 4412,
  canonicalKey: 'tablet|IR|317:650:mg:-',
  dosageForm: 'tablet',
  releaseType: 'IR',
  route: 'oral',
  isFdc: false,
  components: [
    { molecule: { id: 317, innName: 'paracetamol', isNti: false }, strengthBase: 650, strengthUnit: 'mg', saltForm: null, ordinal: 0 },
  ],
};

function pp(id: number, brand: string, channel: string, packSize: number, mrp: number): PricedProduct {
  return {
    productId: id,
    brandName: brand,
    channelId: channel,
    manufacturer: null,
    packSize,
    packUnit: 'tablet',
    mrp,
    formulation: para650,
    hasActiveRecall: false,
    provenance: { sourceId: 'ipdms', snapshotDate: '2026-07-28' },
  };
}

const fakeFormulationRepo: FormulationRepo = {
  byId: async (id) => (id === 4412 ? para650 : null),
  byCanonicalKey: async (k) => (k === para650.canonicalKey ? para650 : null),
  currentPrices: async (fid) =>
    fid === 4412
      ? [
          pp(1, 'Dolo 650', 'branded', 15, 31.5),
          pp(2, 'Calpol 650', 'branded', 15, 29),
          pp(3, 'Paracetamol', 'unbranded', 10, 11),
          pp(4, 'PMBJP Para650', 'jan_aushadhi', 10, 2.8),
        ]
      : [],
  currentCeiling: async (fid): Promise<CeilingRow | null> =>
    fid === 4412
      ? { formulationId: 4412, ceilingPerUnit: 2.09, gstPct: 12, notificationNo: 'S.O.3869(E)', notificationDate: '2022-11-01' }
      : null,
};

const fakeMetaRepo: MetaRepo = {
  knowledgeVersion: async () => 1,
  sources: async () => [
    { sourceId: 'nppa_ceiling', name: 'NPPA', lastPromoted: '2026-08-08T00:00:00+00:00', staleDays: 2, status: 'fresh' },
  ],
};

function appWithFakes() {
  return createApp({
    formulationRepo: fakeFormulationRepo,
    metaRepo: fakeMetaRepo,
    channelTier: DEFAULT_CHANNEL_TIER,
    now: () => NOW,
  });
}

describe('GET /v1/ladder', () => {
  it('returns the ranked ladder + ceiling + overcharge with a provenance block', async () => {
    const app = appWithFakes();
    const res = await app.request('/v1/ladder?formulation=4412&quantity=30&quoted=3');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.ladder.map((r: any) => r.product.brandName)).toEqual([
      'PMBJP Para650', 'Paracetamol', 'Calpol 650', 'Dolo 650',
    ]);
    expect(body.data.legalMaxPerUnit).toBe(2.34);
    expect(body.data.topSaving).toBe(54.6);
    expect(body.data.overcharge.isOvercharge).toBe(true);
    // envelope
    expect(body.meta.knowledgeVersion).toBe(1);
    expect(body.meta.asOf).toBe(NOW);
    expect(body.provenance[0]).toMatchObject({ field: 'ladder[].mrp', sourceId: 'ipdms' });
  });

  it('returns resolvable:false (200) for an unknown formulation, not a 404', async () => {
    const res = await appWithFakes().request('/v1/ladder?formulation=9999');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({ resolvable: false, reason: 'formulation_not_found' });
  });

  it('rejects unknown query parameters (400)', async () => {
    const res = await appWithFakes().request('/v1/ladder?formulation=4412&surprise=1');
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('validation');
  });

  it('requires a formulation or product (400)', async () => {
    const res = await appWithFakes().request('/v1/ladder?quantity=30');
    expect(res.status).toBe(400);
  });

  it('rejects a malformed pincode (400)', async () => {
    const res = await appWithFakes().request('/v1/ladder?formulation=4412&pincode=abc');
    expect(res.status).toBe(400);
  });
});

describe('unknown routes', () => {
  it('404 with a structured error', async () => {
    const res = await appWithFakes().request('/v1/nope');
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('not_found');
  });
});

describe('GET /v1/meta/health (real D1)', () => {
  it('reports knowledge version + per-source staleness', async () => {
    const db = new SqliteD1(':memory:');
    db.applyMigrations(MIGRATIONS);
    db.exec(`
      INSERT INTO source(id,name,url,license,cadence,tier) VALUES
        ('nppa_ceiling','NPPA ceiling prices','https://nppa.gov.in','public','event',1);
      INSERT INTO source_snapshot(source_id,sha256,r2_key,fetched_at,status) VALUES
        ('nppa_ceiling','aa','raw/nppa/1.pdf','2026-08-01T00:00:00+00:00','promoted');
      INSERT INTO knowledge_version(version,promoted_at,snapshot_ids) VALUES (3,'2026-08-01T00:00:00+00:00','[1]');
    `);
    const app = createApp({
      formulationRepo: fakeFormulationRepo,
      metaRepo: new D1MetaRepo(db),
      channelTier: DEFAULT_CHANNEL_TIER,
      now: () => NOW,
    });
    const res = await app.request('/v1/meta/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.knowledgeVersion).toBe(3);
    expect(body.data.sources[0]).toMatchObject({ id: 'nppa_ceiling', staleDays: 9, status: 'fresh' });
    expect(body.meta.staleness.worstSourceDays).toBe(9);
  });
});
