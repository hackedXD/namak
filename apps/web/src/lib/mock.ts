/* ============================================================================
   DEMO DATA — illustrative only. NOT real prices, brands-as-priced, or kendra
   records. This module exists solely to make the front-end prototype navigable
   and is never imported by the ingestion/canonical data path. A persistent
   "Demo data" banner marks every page. Real prices come from the ingestion
   plane (NPPA ceilings, PMBJP catalogue, Pharma Sahi Daam) once wired.
   ========================================================================== */

export type Channel = 'jan_aushadhi' | 'unbranded' | 'branded' | 'epharmacy';

export interface Molecule {
  slug: string;
  name: string;
  inn: string;
  isNti: boolean;
  klass: string; // therapeutic class label
  about: string;
}

export interface Formulation {
  id: number;
  slug: string;
  moleculeSlugs: string[];
  label: string; // 'Paracetamol 650 mg'
  form: string; // tablet | capsule | syrup
  release: 'IR' | 'SR' | 'ER';
  packUnit: string; // tablet | ml
}

export interface Product {
  id: number;
  slug: string;
  brand: string;
  manufacturer: string;
  channel: Channel;
  formulationId: number;
  packSize: number;
  mrp: number;
  sourceId: string;
}

export interface Ceiling {
  formulationId: number;
  perUnit: number; // excl GST
  gstPct: number;
  notificationNo: string;
  date: string;
}

export interface Kendra {
  code: string;
  name: string;
  address: string;
  pincode: string;
  district: string;
  state: string;
  lat: number;
  lng: number;
}

export interface SourceInfo {
  id: string;
  name: string;
  tier: 1 | 2;
  license: string;
  cadence: string;
  lastUpdated: string;
  staleDays: number;
  status: 'fresh' | 'warn' | 'stale' | 'pending';
  note: string;
}

export const molecules: Molecule[] = [
  { slug: 'paracetamol', name: 'Paracetamol', inn: 'paracetamol', isNti: false, klass: 'Analgesic · Antipyretic', about: 'Relieves pain and fever. One of the most widely used medicines in India.' },
  { slug: 'metformin', name: 'Metformin', inn: 'metformin', isNti: false, klass: 'Antidiabetic (biguanide)', about: 'First-line therapy for type 2 diabetes; lowers blood glucose.' },
  { slug: 'amlodipine', name: 'Amlodipine', inn: 'amlodipine', isNti: false, klass: 'Antihypertensive (CCB)', about: 'A calcium-channel blocker used to lower blood pressure.' },
  { slug: 'telmisartan', name: 'Telmisartan', inn: 'telmisartan', isNti: false, klass: 'Antihypertensive (ARB)', about: 'An angiotensin-receptor blocker for high blood pressure.' },
  { slug: 'atorvastatin', name: 'Atorvastatin', inn: 'atorvastatin', isNti: false, klass: 'Lipid-lowering (statin)', about: 'Lowers cholesterol to reduce cardiovascular risk.' },
  { slug: 'pantoprazole', name: 'Pantoprazole', inn: 'pantoprazole', isNti: false, klass: 'Proton-pump inhibitor', about: 'Reduces stomach acid; used for acidity and ulcers.' },
  { slug: 'azithromycin', name: 'Azithromycin', inn: 'azithromycin', isNti: false, klass: 'Antibiotic (macrolide)', about: 'A broad-spectrum antibiotic. Use only as prescribed.' },
  { slug: 'levothyroxine', name: 'Levothyroxine', inn: 'levothyroxine', isNti: true, klass: 'Thyroid hormone', about: 'Thyroid replacement. A narrow-therapeutic-index medicine — brand switches need a doctor.' },
  { slug: 'glimepiride', name: 'Glimepiride', inn: 'glimepiride', isNti: false, klass: 'Antidiabetic (sulfonylurea)', about: 'Stimulates insulin release; often combined with metformin.' },
];

export const formulations: Formulation[] = [
  { id: 4412, slug: 'paracetamol-650-tablet', moleculeSlugs: ['paracetamol'], label: 'Paracetamol 650 mg', form: 'tablet', release: 'IR', packUnit: 'tablet' },
  { id: 4413, slug: 'paracetamol-500-tablet', moleculeSlugs: ['paracetamol'], label: 'Paracetamol 500 mg', form: 'tablet', release: 'IR', packUnit: 'tablet' },
  { id: 5001, slug: 'metformin-500-tablet', moleculeSlugs: ['metformin'], label: 'Metformin 500 mg', form: 'tablet', release: 'IR', packUnit: 'tablet' },
  { id: 5002, slug: 'metformin-500-sr-tablet', moleculeSlugs: ['metformin'], label: 'Metformin 500 mg SR', form: 'tablet', release: 'SR', packUnit: 'tablet' },
  { id: 5100, slug: 'metformin-500-glimepiride-1-tablet', moleculeSlugs: ['metformin', 'glimepiride'], label: 'Metformin 500 mg + Glimepiride 1 mg', form: 'tablet', release: 'IR', packUnit: 'tablet' },
  { id: 6001, slug: 'amlodipine-5-tablet', moleculeSlugs: ['amlodipine'], label: 'Amlodipine 5 mg', form: 'tablet', release: 'IR', packUnit: 'tablet' },
  { id: 6100, slug: 'telmisartan-40-tablet', moleculeSlugs: ['telmisartan'], label: 'Telmisartan 40 mg', form: 'tablet', release: 'IR', packUnit: 'tablet' },
  { id: 7001, slug: 'atorvastatin-10-tablet', moleculeSlugs: ['atorvastatin'], label: 'Atorvastatin 10 mg', form: 'tablet', release: 'IR', packUnit: 'tablet' },
  { id: 8001, slug: 'pantoprazole-40-tablet', moleculeSlugs: ['pantoprazole'], label: 'Pantoprazole 40 mg', form: 'tablet', release: 'IR', packUnit: 'tablet' },
  { id: 9001, slug: 'azithromycin-500-tablet', moleculeSlugs: ['azithromycin'], label: 'Azithromycin 500 mg', form: 'tablet', release: 'IR', packUnit: 'tablet' },
  { id: 9500, slug: 'levothyroxine-50-tablet', moleculeSlugs: ['levothyroxine'], label: 'Levothyroxine 50 mcg', form: 'tablet', release: 'IR', packUnit: 'tablet' },
];

// DEMO products. Prices are illustrative — the ladder maths is real.
export const products: Product[] = [
  // Paracetamol 650
  p(1, 'Dolo 650', 'Micro Labs', 'branded', 4412, 15, 31.5, 'ipdms'),
  p(2, 'Calpol 650', 'GSK', 'branded', 4412, 15, 30.16, 'ipdms'),
  p(3, 'Crocin 650 Advance', 'GSK', 'branded', 4412, 15, 33.6, 'ipdms'),
  p(4, 'Paracetamol 650 (Generic)', 'Cipla', 'unbranded', 4412, 10, 12.5, 'ipdms'),
  p(5, 'Paracetamol 650', 'PMBJP', 'jan_aushadhi', 4412, 10, 2.8, 'pmbjp_catalogue'),
  p(6, 'ParaSafe 650', 'NetMeds', 'epharmacy', 4412, 15, 28.0, 'epharmacy'),
  // Paracetamol 500
  p(10, 'Dolo 500', 'Micro Labs', 'branded', 4413, 15, 18.0, 'ipdms'),
  p(11, 'Paracetamol 500', 'PMBJP', 'jan_aushadhi', 4413, 10, 2.2, 'pmbjp_catalogue'),
  // Metformin 500
  p(20, 'Glycomet 500', 'USV', 'branded', 5001, 20, 24.0, 'ipdms'),
  p(21, 'Metformin 500 (Generic)', 'Cipla', 'unbranded', 5001, 15, 9.5, 'ipdms'),
  p(22, 'Metformin 500', 'PMBJP', 'jan_aushadhi', 5001, 10, 3.15, 'pmbjp_catalogue'),
  p(23, 'Gluformin 500', 'Abbott', 'branded', 5001, 20, 26.4, 'ipdms'),
  // Metformin 500 SR
  p(30, 'Glycomet SR 500', 'USV', 'branded', 5002, 20, 29.0, 'ipdms'),
  p(31, 'Metformin SR 500', 'PMBJP', 'jan_aushadhi', 5002, 10, 3.8, 'pmbjp_catalogue'),
  // Metformin + Glimepiride
  p(40, 'Glycomet-GP 1', 'USV', 'branded', 5100, 15, 62.0, 'ipdms'),
  p(41, 'Metformin+Glimepiride', 'PMBJP', 'jan_aushadhi', 5100, 10, 8.4, 'pmbjp_catalogue'),
  // Amlodipine 5
  p(50, 'Amlong 5', 'Micro Labs', 'branded', 6001, 15, 22.0, 'ipdms'),
  p(51, 'Amlodac 5', 'Zydus', 'branded', 6001, 15, 20.5, 'ipdms'),
  p(52, 'Amlodipine 5 (Generic)', 'Cipla', 'unbranded', 6001, 10, 6.0, 'ipdms'),
  p(53, 'Amlodipine 5', 'PMBJP', 'jan_aushadhi', 6001, 10, 1.65, 'pmbjp_catalogue'),
  // Telmisartan 40
  p(60, 'Telma 40', 'Glenmark', 'branded', 6100, 15, 96.0, 'ipdms'),
  p(61, 'Telmikind 40', 'Mankind', 'branded', 6100, 15, 74.0, 'ipdms'),
  p(62, 'Telmisartan 40', 'PMBJP', 'jan_aushadhi', 6100, 10, 8.9, 'pmbjp_catalogue'),
  // Atorvastatin 10
  p(70, 'Atorva 10', 'Zydus', 'branded', 7001, 15, 74.0, 'ipdms'),
  p(71, 'Storvas 10', 'Ranbaxy', 'branded', 7001, 10, 52.0, 'ipdms'),
  p(72, 'Atorvastatin 10', 'PMBJP', 'jan_aushadhi', 7001, 10, 6.75, 'pmbjp_catalogue'),
  // Pantoprazole 40
  p(80, 'Pan 40', 'Alkem', 'branded', 8001, 15, 130.0, 'ipdms'),
  p(81, 'Pantop 40', 'Aristo', 'branded', 8001, 15, 118.0, 'ipdms'),
  p(82, 'Pantoprazole 40', 'PMBJP', 'jan_aushadhi', 8001, 10, 8.0, 'pmbjp_catalogue'),
  // Azithromycin 500
  p(90, 'Azithral 500', 'Alembic', 'branded', 9001, 5, 78.0, 'ipdms'),
  p(91, 'Azee 500', 'Cipla', 'branded', 9001, 5, 70.0, 'ipdms'),
  p(92, 'Azithromycin 500', 'PMBJP', 'jan_aushadhi', 9001, 3, 21.0, 'pmbjp_catalogue'),
  // Levothyroxine 50 (NTI)
  p(95, 'Thyronorm 50', 'Abbott', 'branded', 9500, 100, 148.0, 'ipdms'),
  p(96, 'Eltroxin 50', 'GSK', 'branded', 9500, 100, 155.0, 'ipdms'),
  p(97, 'Levothyroxine 50', 'PMBJP', 'jan_aushadhi', 9500, 100, 42.0, 'pmbjp_catalogue'),
];

export const ceilings: Ceiling[] = [
  { formulationId: 4412, perUnit: 2.09, gstPct: 12, notificationNo: 'S.O.3869(E)', date: '2022-11-11' },
  { formulationId: 4413, perUnit: 1.61, gstPct: 12, notificationNo: 'S.O.3869(E)', date: '2022-11-11' },
  { formulationId: 5001, perUnit: 1.72, gstPct: 12, notificationNo: 'S.O.1499(E)', date: '2022-03-30' },
  { formulationId: 6001, perUnit: 1.14, gstPct: 12, notificationNo: 'S.O.1499(E)', date: '2022-03-30' },
  { formulationId: 6100, perUnit: 6.84, gstPct: 12, notificationNo: 'S.O.1499(E)', date: '2022-03-30' },
  { formulationId: 7001, perUnit: 5.9, gstPct: 12, notificationNo: 'S.O.1499(E)', date: '2022-03-30' },
  { formulationId: 8001, perUnit: 8.06, gstPct: 12, notificationNo: 'S.O.1215(E)', date: '2023-03-10' },
  { formulationId: 9001, perUnit: 12.36, gstPct: 12, notificationNo: 'S.O.1499(E)', date: '2022-03-30' },
  { formulationId: 9500, perUnit: 1.32, gstPct: 12, notificationNo: 'S.O.1499(E)', date: '2022-03-30' },
];

export const kendras: Kendra[] = [
  { code: 'PMBJK-560034-01', name: 'Jan Aushadhi Kendra — Koramangala', address: '80 Feet Rd, 4th Block, Koramangala', pincode: '560034', district: 'Bengaluru', state: 'Karnataka', lat: 12.9345, lng: 77.6266 },
  { code: 'PMBJK-560034-02', name: 'Jan Aushadhi Kendra — Jakkasandra', address: '1st Main, Jakkasandra', pincode: '560034', district: 'Bengaluru', state: 'Karnataka', lat: 12.9312, lng: 77.628 },
  { code: 'PMBJK-560095-01', name: 'Jan Aushadhi Kendra — HSR Layout', address: 'Sector 2, HSR Layout', pincode: '560102', district: 'Bengaluru', state: 'Karnataka', lat: 12.9116, lng: 77.6412 },
  { code: 'PMBJK-110001-01', name: 'Jan Aushadhi Kendra — Connaught Place', address: 'Block A, Connaught Place', pincode: '110001', district: 'New Delhi', state: 'Delhi', lat: 28.6329, lng: 77.2195 },
  { code: 'PMBJK-400001-01', name: 'Jan Aushadhi Kendra — Fort', address: 'D N Road, Fort', pincode: '400001', district: 'Mumbai', state: 'Maharashtra', lat: 18.9346, lng: 72.8352 },
  { code: 'PMBJK-600002-01', name: 'Jan Aushadhi Kendra — Anna Salai', address: 'Anna Salai, Mount Road', pincode: '600002', district: 'Chennai', state: 'Tamil Nadu', lat: 13.0604, lng: 80.2626 },
];

export const sources: SourceInfo[] = [
  { id: 'nppa_ceiling', name: 'NPPA ceiling prices', tier: 1, license: 'Government / public', cadence: 'On notification + annual', lastUpdated: '2026-08-01', staleDays: 9, status: 'fresh', note: 'Statutory maximum prices under DPCO 2013.' },
  { id: 'pmbjp_catalogue', name: 'PMBJP (Jan Aushadhi) catalogue', tier: 1, license: 'Government / public', cadence: 'Monthly', lastUpdated: '2026-07-20', staleDays: 21, status: 'fresh', note: 'Generic products and MRPs from Jan Aushadhi.' },
  { id: 'ipdms', name: 'Pharma Sahi Daam (IPDMS 2.0)', tier: 1, license: 'Government / public', cadence: 'Monthly', lastUpdated: '2026-07-18', staleDays: 23, status: 'fresh', note: 'Brand-level prices, scheduled + non-scheduled.' },
  { id: 'geonames_pincode', name: 'GeoNames PIN centroids', tier: 2, license: 'CC-BY 4.0 (community)', cadence: 'Rare', lastUpdated: '2026-06-01', staleDays: 70, status: 'warn', note: 'Pincode → coordinates for kendra proximity.' },
  { id: 's2_kendra', name: 'PMBJP kendra directory', tier: 1, license: 'Government / public', cadence: 'Monthly', lastUpdated: '—', staleDays: 0, status: 'pending', note: 'Per-kendra list. Awaiting an India-IP fetch.' },
  { id: 'epharmacy', name: 'E-pharmacy catalogues', tier: 2, license: 'Commercial ToS', cadence: 'Weekly', lastUpdated: '2026-08-05', staleDays: 5, status: 'fresh', note: 'Long-tail brands (labelled, separable).' },
];

function p(id: number, brand: string, manufacturer: string, channel: Channel, formulationId: number, packSize: number, mrp: number, sourceId: string): Product {
  return { id, slug: slug(brand), brand, manufacturer, channel, formulationId, packSize, mrp, sourceId };
}
function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// ── indexes / lookups ───────────────────────────────────────────────────────
export const moleculeBySlug = new Map(molecules.map((m) => [m.slug, m]));
export const formulationById = new Map(formulations.map((f) => [f.id, f]));
export const formulationBySlug = new Map(formulations.map((f) => [f.slug, f]));
export const productBySlug = new Map(products.map((p) => [p.slug, p]));
export const ceilingByFormulation = new Map(ceilings.map((c) => [c.formulationId, c]));

export function productsForFormulation(id: number): Product[] {
  return products.filter((p) => p.formulationId === id);
}
export function formulationsForMolecule(slug: string): Formulation[] {
  return formulations.filter((f) => f.moleculeSlugs.includes(slug));
}
export function moleculesOf(f: Formulation): Molecule[] {
  return f.moleculeSlugs.map((s) => moleculeBySlug.get(s)!).filter(Boolean);
}
