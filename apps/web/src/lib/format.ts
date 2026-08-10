export const inr = (n: number): string =>
  '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const inr0 = (n: number): string =>
  '₹' + Math.round(n).toLocaleString('en-IN');

export const perUnit = (n: number, unit: string): string => `${inr(n)} / ${unit}`;

export const pct = (n: number): string => `${Math.round(n)}%`;

export const slugify = (s: string): string =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export function prettyDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export const channelLabel: Record<string, string> = {
  jan_aushadhi: 'Jan Aushadhi',
  unbranded: 'Generic',
  branded: 'Branded',
  epharmacy: 'E-pharmacy',
};
