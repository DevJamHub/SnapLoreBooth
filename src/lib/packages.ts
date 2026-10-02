export interface BoothPackage {
  id: string;
  label: string;
  format: string;
  shots: number;
  prints: number;
  priceIdr: number;
  blurb: string;
}

export const PACKAGES: BoothPackage[] = [
  {
    id: 'strip',
    label: 'Strip Klasik',
    format: '2x6',
    shots: 4,
    prints: 2,
    priceIdr: 25000,
    blurb: '4 pose, dicetak memanjang. Dapat 2 lembar — satu buat kamu, satu buat temanmu.',
  },
  {
    id: 'postcard',
    label: 'Kartu Pos',
    format: '4x6',
    shots: 3,
    prints: 1,
    priceIdr: 25000,
    blurb: '3 pose dalam satu kartu besar. Pas buat rame-rame.',
  },
  {
    id: 'square',
    label: 'Satu Potret',
    format: '1x1',
    shots: 1,
    prints: 1,
    priceIdr: 20000,
    blurb: 'Satu foto terbaikmu, dicetak persegi.',
  },
];

/** Only add-ons the booth actually delivers; each one changes what comes out of the printer. */
export const ADDONS = [{ id: 'extra-print', label: 'Tambah 1 cetakan', priceIdr: 5000, extraPrints: 1 }];

/**
 * Looks are kept as discrete operations rather than CSS strings so the board can be
 * composed pixel by pixel on browsers whose canvas ignores `ctx.filter` (older Safari).
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
