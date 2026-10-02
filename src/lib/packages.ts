export interface BoothPackage {
  id: string;
  label: string;
  /** Board layout on one uncut 4R (4x6in) sheet; see boardLayout() in strip.ts. */
  format: string;
  shots: number;
  priceIdr: number;
  blurb: string;
  /** Grid shape for the little preview on the package card. */
  cols: number;
  rows: number;
}

/** Every package prints on one 4R sheet. More copies are bought as extra prints. */
export const PACKAGES: BoothPackage[] = [
  { id: 'six', label: '6 Pose', format: 'grid6', shots: 6, priceIdr: 30000, cols: 2, rows: 3, blurb: 'Enam gaya dalam satu lembar. Paling seru buat rame-rame.' },
  { id: 'four', label: '4 Pose', format: 'grid4', shots: 4, priceIdr: 25000, cols: 2, rows: 2, blurb: 'Empat foto besar, susunan kotak klasik.' },
  { id: 'three', label: '3 Pose', format: 'stack3', shots: 3, priceIdr: 25000, cols: 1, rows: 3, blurb: 'Tiga foto lebar bertumpuk. Pas buat grup.' },
  { id: 'single', label: 'Satu Potret', format: 'single', shots: 1, priceIdr: 20000, cols: 1, rows: 1, blurb: 'Satu foto terbaikmu, satu lembar penuh.' },
];

/** Priced per extra 4R sheet; guests pick how many. */
export const EXTRA_PRINT = { id: 'extra-print', label: '+1 cetak', priceIdr: 15000 };
export const MAX_EXTRA_PRINTS = 20;

/** Everything the operator can price. Kept as a list so the console renders it generically. */
export const ADDONS = [EXTRA_PRINT];

/**
 * Looks are kept as discrete operations rather than CSS strings so the board can be
 * composed pixel by pixel on browsers whose canvas ignores `ctx.filter` (older Safari).
 * Add a look by adding an entry here; every screen picks it up.
 */
export type FilterOp =
  | { op: 'saturate'; v: number }
  | { op: 'contrast'; v: number }
  | { op: 'brightness'; v: number }
  | { op: 'sepia'; v: number }
  | { op: 'grayscale'; v: number };

export interface BoothFilter {
  id: string;
  label: string;
  ops: FilterOp[];
}

export const FILTERS: BoothFilter[] = [
  { id: 'original', label: 'Asli', ops: [] },
  { id: 'kodak', label: 'Hangat', ops: [{ op: 'saturate', v: 1.15 }, { op: 'contrast', v: 1.05 }, { op: 'sepia', v: 0.12 }] },
  { id: 'ilford', label: 'Hitam Putih', ops: [{ op: 'grayscale', v: 1 }, { op: 'contrast', v: 1.12 }] },
  { id: 'faded', label: 'Vintage', ops: [{ op: 'sepia', v: 0.45 }, { op: 'contrast', v: 0.94 }, { op: 'brightness', v: 1.06 }] },
  { id: 'golden', label: 'Senja', ops: [{ op: 'saturate', v: 1.25 }, { op: 'sepia', v: 0.22 }, { op: 'brightness', v: 1.05 }] },
];

export function filterCss(id: string): string {
  const ops = FILTERS.find((f) => f.id === id)?.ops ?? [];
  return ops.length ? ops.map((o) => `${o.op}(${o.v})`).join(' ') : 'none';
}

/** A frame design. Add one by adding an entry here. */
export interface BoothTemplate {
  id: string;
  label: string;
  board: string;
  ink: string;
  muted: string;
  /** Prints the event name under the photos. */
  eventMark: boolean;
  date: boolean;
  /** Multiplies the outer margin. */
  border: number;
}

export const TEMPLATES: BoothTemplate[] = [
  { id: 'plain', label: 'Klasik', board: '#f3eee8', ink: '#181816', muted: '#6e6259', eventMark: true, date: true, border: 1 },
  { id: 'noir', label: 'Malam', board: '#141312', ink: '#f3eee8', muted: '#a8a29e', eventMark: true, date: true, border: 1 },
  { id: 'terracotta', label: 'Terakota', board: '#cc785c', ink: '#1b1410', muted: '#3d2a22', eventMark: true, date: true, border: 1 },
  { id: 'minimal', label: 'Polos', board: '#ffffff', ink: '#181816', muted: '#6e6259', eventMark: false, date: false, border: 0.6 },
  { id: 'wide', label: 'Galeri', board: '#f3eee8', ink: '#181816', muted: '#6e6259', eventMark: true, date: true, border: 2 },
];

export function packageById(id: string): BoothPackage | undefined {
  return PACKAGES.find((p) => p.id === id);
}

export function formatPrice(amount: number): string {
  return `Rp${amount.toLocaleString('id-ID')}`;
}
