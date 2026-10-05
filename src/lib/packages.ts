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

/**
 * Skin smoothing, applied to each photo before its colour look. A few named levels, so the
 * guest picks a feeling rather than a number. See applyBeauty() in beauty.ts.
 */
export interface BeautyLevel {
  id: string;
  label: string;
  blurb: string;
  /** How far skin moves toward its smoothed self, 0–1. */
  smooth: number;
  /** Smoothing radius as a fraction of the photo's shorter side, so a face smooths alike in every slot size. */
  radius: number;
  /**
   * How different from its surroundings (in 0–255 brightness) a detail may be and still be
   * smoothed away; above it, it is an edge and stays. Eyes and brows sit far above either.
   */
  edge: number;
  /** Lift toward white on skin, 0–1. */
  lift: number;
  /** Red added and blue taken from skin, in 0–255 steps. */
  warmth: number;
}

export const BEAUTY: BeautyLevel[] = [
  { id: 'off', label: 'Mati', blurb: 'Foto apa adanya', smooth: 0, radius: 0, edge: 0, lift: 0, warmth: 0 },
  { id: 'natural', label: 'Natural', blurb: 'Kulit lebih halus, tetap kamu', smooth: 0.65, radius: 0.008, edge: 26, lift: 0.04, warmth: 0 },
  { id: 'glow', label: 'Glowing', blurb: 'Lebih halus dan cerah', smooth: 0.9, radius: 0.012, edge: 44, lift: 0.1, warmth: 4 },
];

export function beautyLevel(id: string | undefined): BeautyLevel | null {
  const level = BEAUTY.find((b) => b.id === id);
  return level && level.smooth + level.lift > 0 ? level : null;
}

/** Guests browse frames by theme; the frames that ship with the booth sit under this one. */
export const BUILTIN_THEME = 'Simpel';
/** Uploaded frames the operator gave no theme. */
export const UNSORTED_THEME = 'Lainnya';

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
