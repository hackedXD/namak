// The Hono app (design §5.2). createApp(deps) returns an app testable with
// app.request(...) in vitest — no Cloudflare runtime needed. Production wires the
// real D1 binding (index.ts); tests inject fakes / a local SQLite repo.

import { Hono } from 'hono';
import { buildLadder, type CandidateProduct, type CeilingInput, type LadderInput } from '@salt/pricing';
import type { PricedProduct, CeilingRow } from '@salt/db';
import type { Deps } from './deps.js';
import { envelope, type Meta, type Provenance } from './envelope.js';
import { notFound, validationError } from './errors.js';
import { ladderQuery, zodFields } from './validation.js';

const WARN_STALE_DAYS = 45; // §10.4

async function buildMeta(deps: Deps): Promise<Meta> {
  const [knowledgeVersion, sources] = await Promise.all([
    deps.metaRepo.knowledgeVersion(),
    deps.metaRepo.sources(deps.now()),
  ]);
  const staleDays = sources.map((s) => s.staleDays).filter((d): d is number => d !== null);
  const worst = staleDays.length ? Math.max(...staleDays) : null;
  return {
    knowledgeVersion,
    asOf: deps.now(),
    staleness: { worstSourceDays: worst, degraded: worst !== null && worst > WARN_STALE_DAYS },
  };
}

function toCandidate(p: PricedProduct): CandidateProduct {
  const c: CandidateProduct = {
    productId: p.productId,
    brandName: p.brandName,
    channelId: p.channelId,
    packSize: p.packSize,
    packUnit: p.packUnit,
    mrp: p.mrp,
    formulation: p.formulation,
    provenance: p.provenance,
  };
  if (p.manufacturer !== null) c.manufacturer = p.manufacturer;
  if (p.hasActiveRecall) c.hasActiveRecall = true;
  return c;
}

function toCeiling(row: CeilingRow | null): CeilingInput | null {
  return row
    ? {
        ceilingPerUnit: row.ceilingPerUnit,
        gstPct: row.gstPct,
        notificationNo: row.notificationNo,
        notificationDate: row.notificationDate,
      }
    : null;
}

export function createApp(deps: Deps): Hono {
  const app = new Hono();

  app.get('/v1/meta/health', async (c) => {
    const meta = await buildMeta(deps);
    const sources = await deps.metaRepo.sources(deps.now());
    return c.json(
      envelope(
        {
          knowledgeVersion: meta.knowledgeVersion,
          sources: sources.map((s) => ({
            id: s.sourceId,
            lastPromoted: s.lastPromoted,
            staleDays: s.staleDays,
            status: s.status,
          })),
        },
        meta,
      ),
    );
  });

  app.get('/v1/ladder', async (c) => {
    const parsed = ladderQuery.safeParse(c.req.query());
    if (!parsed.success) return validationError(c, zodFields(parsed.error));
    const input = parsed.data;

    const meta = await buildMeta(deps);

    // product-slug lookup needs canonical product data (not ingested yet).
    if (input.formulation === undefined) {
      return c.json(
        envelope({ resolvable: false, reason: 'product_lookup_not_available' }, meta),
      );
    }

    const src = await deps.formulationRepo.byId(input.formulation);
    if (!src) {
      // a valid question we can't yet answer — 200 with resolvable:false (§5.5)
      return c.json(envelope({ resolvable: false, reason: 'formulation_not_found' }, meta));
    }

    const [prices, ceiling] = await Promise.all([
      deps.formulationRepo.currentPrices(src.id),
      deps.formulationRepo.currentCeiling(src.id),
    ]);

    const ladderInput: LadderInput = {
      formulation: src,
      candidates: prices.map(toCandidate),
      ceiling: toCeiling(ceiling),
      quantityNeeded: input.quantity,
      channelTier: deps.channelTier,
      ...(meta.asOf !== null ? { asOf: meta.asOf } : {}),
      ...(input.quoted !== undefined ? { quotedUnitPrice: input.quoted } : {}),
    };
    const ladder = buildLadder(ladderInput);

    const provenance: Provenance[] = ladder.provenance.map((p) => ({
      field: 'ladder[].mrp',
      sourceId: p.sourceId,
      snapshotDate: p.snapshotDate,
    }));
    return c.json(envelope(ladder, meta, provenance));
  });

  app.notFound((c) => notFound(c, 'No such route'));
  return app;
}
