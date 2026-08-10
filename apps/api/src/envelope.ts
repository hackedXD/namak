// The response envelope (design §5.2). Every response carries meta (knowledge
// version + staleness) and, for price-bearing responses, a provenance block —
// the technical expression of the neutrality claim.

export interface Provenance {
  field: string;
  sourceId: string;
  snapshotDate: string;
}

export interface Meta {
  knowledgeVersion: number;
  asOf: string | null;
  staleness: { worstSourceDays: number | null; degraded: boolean };
}

export interface Envelope<T> {
  data: T;
  meta: Meta;
  provenance?: Provenance[];
}

export function envelope<T>(data: T, meta: Meta, provenance?: Provenance[]): Envelope<T> {
  return provenance && provenance.length > 0 ? { data, meta, provenance } : { data, meta };
}
