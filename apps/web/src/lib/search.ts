import { molecules, products, formulations, formulationById } from './mock';

export interface SearchHit {
  type: 'product' | 'molecule' | 'formulation';
  title: string;
  subtitle: string;
  href: string;
  score: number;
}

export function searchAll(qRaw: string, limit = 8): SearchHit[] {
  const q = qRaw.trim().toLowerCase();
  if (!q) return [];
  const hits: SearchHit[] = [];

  for (const p of products) {
    const f = formulationById.get(p.formulationId);
    const hay = `${p.brand} ${p.manufacturer} ${f?.label ?? ''}`.toLowerCase();
    const s = score(hay, p.brand.toLowerCase(), q);
    if (s > 0) hits.push({ type: 'product', title: p.brand, subtitle: `${f?.label ?? ''} · ${p.manufacturer}`, href: `/medicine/${p.slug}`, score: s + 0.2 });
  }
  for (const m of molecules) {
    const s = score(m.name.toLowerCase(), m.name.toLowerCase(), q);
    if (s > 0) hits.push({ type: 'molecule', title: m.name, subtitle: m.klass, href: `/molecule/${m.slug}`, score: s + 0.1 });
  }
  for (const f of formulations) {
    const s = score(f.label.toLowerCase(), f.label.toLowerCase(), q);
    if (s > 0) hits.push({ type: 'formulation', title: f.label, subtitle: `${f.form} · ${f.release}`, href: `/formulation/${f.slug}`, score: s });
  }

  const seen = new Set<string>();
  return hits
    .sort((a, b) => b.score - a.score)
    .filter((h) => (seen.has(h.href) ? false : (seen.add(h.href), true)))
    .slice(0, limit);
}

function score(hay: string, name: string, q: string): number {
  if (name === q) return 3;
  if (name.startsWith(q)) return 2;
  if (hay.includes(q)) return 1;
  // loose: all query chars appear in order
  let i = 0;
  for (const ch of hay) if (ch === q[i]) i++;
  return i === q.length ? 0.4 : 0;
}
