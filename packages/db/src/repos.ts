// Repository interfaces + SQLite implementations. Nothing outside this package
// writes SQL (design §2.1). The interfaces are what the API depends on; swapping
// D1 ↔ Postgres later means swapping one implementation.

import type { CanonicalComponent, FormulationRecord, StrengthUnit } from '@salt/domain';
import type { D1Like } from './port.js';

// ── Provenance / meta ──────────────────────────────────────────────────────

export interface SourceStaleness {
  sourceId: string;
  name: string;
  lastPromoted: string | null;
  staleDays: number | null;
  status: 'fresh' | 'stale' | 'never';
}

export interface MetaRepo {
  knowledgeVersion(): Promise<number>;
  sources(nowIso: string): Promise<SourceStaleness[]>;
}

// ── Formulation / pricing ──────────────────────────────────────────────────

export interface PricedProduct {
  productId: number;
  brandName: string;
  channelId: string;
  manufacturer: string | null;
  packSize: number;
  packUnit: string;
  mrp: number;
  formulation: FormulationRecord;
  hasActiveRecall: boolean;
  provenance: { sourceId: string; snapshotDate: string };
}

export interface CeilingRow {
  formulationId: number;
  ceilingPerUnit: number;
  gstPct: number;
  notificationNo: string;
  notificationDate: string;
}

export interface FormulationRepo {
  byId(id: number): Promise<FormulationRecord | null>;
  byCanonicalKey(key: string): Promise<FormulationRecord | null>;
  currentPrices(formulationId: number): Promise<PricedProduct[]>;
  currentCeiling(formulationId: number): Promise<CeilingRow | null>;
}

const STALE_AFTER_DAYS = 45; // per the staleness contract (§10.4)

export class D1MetaRepo implements MetaRepo {
  constructor(private readonly db: D1Like) {}

  async knowledgeVersion(): Promise<number> {
    const r = await this.db
      .prepare('SELECT COALESCE(MAX(version),0) AS v FROM knowledge_version')
      .first<{ v: number }>();
    return r?.v ?? 0;
  }

  async sources(nowIso: string): Promise<SourceStaleness[]> {
    const rows = await this.db
      .prepare(
        `SELECT s.id AS sourceId, s.name AS name,
                (SELECT MAX(ss.fetched_at) FROM source_snapshot ss
                   WHERE ss.source_id = s.id AND ss.status = 'promoted') AS lastPromoted
           FROM source s
          ORDER BY s.id`,
      )
      .all<{ sourceId: string; name: string; lastPromoted: string | null }>();

    const now = Date.parse(nowIso);
    return rows.results.map((r) => {
      if (!r.lastPromoted) {
        return { ...r, staleDays: null, status: 'never' as const };
      }
      const staleDays = Math.floor((now - Date.parse(r.lastPromoted)) / 86_400_000);
      return {
        sourceId: r.sourceId,
        name: r.name,
        lastPromoted: r.lastPromoted,
        staleDays,
        status: staleDays > STALE_AFTER_DAYS ? ('stale' as const) : ('fresh' as const),
      };
    });
  }
}

interface ComponentRow {
  molecule_id: number;
  inn_name: string;
  is_nti: number;
  strength_base: number;
  strength_unit: string;
  salt_form: string | null;
  ordinal: number;
}

export class D1FormulationRepo implements FormulationRepo {
  constructor(private readonly db: D1Like) {}

  private async components(formulationId: number): Promise<CanonicalComponent[]> {
    const rows = await this.db
      .prepare(
        `SELECT fc.molecule_id, m.inn_name, m.is_nti, fc.strength_base,
                fc.strength_unit, fc.salt_form, fc.ordinal
           FROM formulation_component fc
           JOIN molecule m ON m.id = fc.molecule_id
          WHERE fc.formulation_id = ?
          ORDER BY fc.ordinal`,
      )
      .bind(formulationId)
      .all<ComponentRow>();
    return rows.results.map((c) => ({
      molecule: { id: c.molecule_id, innName: c.inn_name, isNti: c.is_nti === 1 },
      strengthBase: c.strength_base,
      strengthUnit: c.strength_unit as StrengthUnit,
      saltForm: c.salt_form,
      ordinal: c.ordinal,
    }));
  }

  private async assemble(row: {
    id: number;
    canonical_key: string;
    dosage_form: string;
    release_type: string;
    route: string;
    is_fdc: number;
  }): Promise<FormulationRecord> {
    return {
      id: row.id,
      canonicalKey: row.canonical_key,
      dosageForm: row.dosage_form,
      releaseType: row.release_type as FormulationRecord['releaseType'],
      route: row.route,
      isFdc: row.is_fdc === 1,
      components: await this.components(row.id),
    };
  }

  async byId(id: number): Promise<FormulationRecord | null> {
    const row = await this.db
      .prepare('SELECT * FROM formulation WHERE id = ?')
      .bind(id)
      .first<{ id: number; canonical_key: string; dosage_form: string; release_type: string; route: string; is_fdc: number }>();
    return row ? this.assemble(row) : null;
  }

  async byCanonicalKey(key: string): Promise<FormulationRecord | null> {
    const row = await this.db
      .prepare('SELECT * FROM formulation WHERE canonical_key = ?')
      .bind(key)
      .first<{ id: number; canonical_key: string; dosage_form: string; release_type: string; route: string; is_fdc: number }>();
    return row ? this.assemble(row) : null;
  }

  async currentPrices(formulationId: number): Promise<PricedProduct[]> {
    const rows = await this.db
      .prepare(
        `SELECT p.id AS productId, p.brand_name AS brandName, p.channel_id AS channelId,
                p.manufacturer AS manufacturer, p.pack_size AS packSize, p.pack_unit AS packUnit,
                pr.mrp AS mrp, p.source_id AS sourceId, ss.fetched_at AS snapshotDate,
                p.formulation_id AS formulationId,
                (SELECT COUNT(*) FROM recall r WHERE r.product_id = p.id) AS recallCount
           FROM product p
           JOIN product_price pr ON pr.product_id = p.id AND pr.valid_to IS NULL
           JOIN source_snapshot ss ON ss.id = pr.snapshot_id
          WHERE p.formulation_id = ? AND p.status = 'active'`,
      )
      .bind(formulationId)
      .all<{
        productId: number; brandName: string; channelId: string; manufacturer: string | null;
        packSize: number; packUnit: string; mrp: number; sourceId: string; snapshotDate: string;
        formulationId: number; recallCount: number;
      }>();

    const out: PricedProduct[] = [];
    for (const r of rows.results) {
      const formulation = await this.byId(r.formulationId);
      if (!formulation) continue; // unresolved product — excluded from the ladder
      out.push({
        productId: r.productId,
        brandName: r.brandName,
        channelId: r.channelId,
        manufacturer: r.manufacturer,
        packSize: r.packSize,
        packUnit: r.packUnit,
        mrp: r.mrp,
        formulation,
        hasActiveRecall: r.recallCount > 0,
        provenance: { sourceId: r.sourceId, snapshotDate: r.snapshotDate },
      });
    }
    return out;
  }

  async currentCeiling(formulationId: number): Promise<CeilingRow | null> {
    const r = await this.db
      .prepare(
        `SELECT formulation_id AS formulationId, ceiling_per_unit AS ceilingPerUnit,
                gst_pct AS gstPct, notification_no AS notificationNo,
                notification_date AS notificationDate
           FROM ceiling_price
          WHERE formulation_id = ? AND valid_to IS NULL
          ORDER BY id DESC LIMIT 1`,
      )
      .bind(formulationId)
      .first<CeilingRow>();
    return r ?? null;
  }
}
