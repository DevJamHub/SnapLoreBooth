import { PACKAGES } from './packages';
import { boardLayout, type Rect } from './strip';

/**
 * Turns an operator's frame design into something the booth can print with: a 1200x1800 PNG
 * whose holes are transparent, plus where each hole is. Runs in the operator's browser, which
 * can decode any image the designer exported.
 *
 * A design marks its photo spots one of two ways:
 *  - transparent holes (Canva Pro "transparent background", Photoshop, Photopea), or
 *  - solid green #00FF00 boxes, which free Canva can export; the green is keyed out here.
 */

const SHEET_W = 1200;
const SHEET_H = 1800;
/** Holes are traced on a quarter-size grid: plenty precise, and quick on an iPad. */
const CELL = 4;
const GRID_W = SHEET_W / CELL;
const GRID_H = SHEET_H / CELL;
/** Smaller clear patches are speckles in the artwork, not places for a photo. */
const MIN_HOLE_SHARE = 0.004;
/** Mostly see-through counts as a hole; a soft drop shadow does not. */
const CLEAR_ALPHA = 32;
/** The photo reaches a little under the frame's edge, so no white seam shows at the cut. */
const BLEED = 4;

export class FrameFileError extends Error {}

export interface PreparedFrame {
  blob: Blob;
  /** Object URL of the prepared PNG, for previews. Revoke it when done. */
  url: string;
  slots: Rect[];
  /** How the design marked its holes. */
  marking: 'transparent' | 'green';
  /** The package with as many photos as the design has holes. */
  format: string;
}

function loadFile(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new FrameFileError('File ini bukan gambar yang bisa dibaca. Ekspor ulang sebagai PNG.'));
    };
    img.src = url;
  });
}

/** Pure-ish green, as a designer's #00FF00 box comes out after export and compression. */
function isKeyGreen(r: number, g: number, b: number): boolean {
  return g >= 180 && r <= 120 && b <= 120 && g - Math.max(r, b) >= 100;
}

/**
 * Makes the green boxes transparent. Their anti-aliased rims are keyed too, and what is left
 * of a rim loses its green tint, so no green line shows around a printed photo.
 */
function keyOutGreen(data: Uint8ClampedArray): number {
  const total = SHEET_W * SHEET_H;
  const core = new Uint8Array(total);
  let keyed = 0;
  for (let p = 0; p < total; p++) {
    const i = p * 4;
    if (data[i + 3] >= CLEAR_ALPHA && isKeyGreen(data[i], data[i + 1], data[i + 2])) {
      core[p] = 1;
      keyed++;
    }
  }
  if (keyed === 0) return 0;

  for (let p = 0; p < total; p++) {
    const i = p * 4;
    if (core[p]) {
      data[i + 3] = 0;
      continue;
    }
    const x = p % SHEET_W;
    const nearKey =
      (x > 0 && core[p - 1]) ||
      (x < SHEET_W - 1 && core[p + 1]) ||
      (p >= SHEET_W && core[p - SHEET_W]) ||
      (p < total - SHEET_W && core[p + SHEET_W]);
    if (!nearKey) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const spill = g - Math.max(r, b);
    if (spill > 40) data[i + 3] = 0;
    else if (spill > 0) data[i + 1] = Math.max(r, b);
  }
  return keyed;
}

type Point = [number, number];

/** Andrew's monotone chain. */
function convexHull(points: Point[]): Point[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o: Point, a: Point, b: Point) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Point[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

interface Blob2D {
  cells: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  hull: Point[];
}

/**
 * The rectangle a hole was drawn as, tilted if the designer tilted it. Holes that are not
 * rectangles (circles, hearts) get their level bounding box: the frame masks the rest.
 */
function holeRect(hole: Blob2D): Rect {
  const level = {
    cx: (hole.minX + hole.maxX + 1) / 2,
    cy: (hole.minY + hole.maxY + 1) / 2,
    w: hole.maxX - hole.minX + 1,
    h: hole.maxY - hole.minY + 1,
    angle: 0,
  };
  let best = { ...level, area: level.w * level.h };

  // Rotating calipers: the smallest box around a convex shape has one side on a hull edge.
  const { hull } = hole;
  for (let i = 0; i < hull.length; i++) {
    const [x1, y1] = hull[i];
    const [x2, y2] = hull[(i + 1) % hull.length];
    const theta = Math.atan2(y2 - y1, x2 - x1);
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const [x, y] of hull) {
      const u = x * cos + y * sin;
      const v = -x * sin + y * cos;
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    }
    const area = (maxU - minU) * (maxV - minV);
    if (area < best.area) {
      const mu = (minU + maxU) / 2;
      const mv = (minV + maxV) / 2;
      best = { cx: mu * cos - mv * sin, cy: mu * sin + mv * cos, w: maxU - minU, h: maxV - minV, angle: (theta * 180) / Math.PI, area };
    }
  }

  // Keep the box's long side where the designer meant it: a tilt is never past 45 degrees.
  let { angle, w, h } = best;
  while (angle > 45) [angle, w, h] = [angle - 90, h, w];
  while (angle <= -45) [angle, w, h] = [angle + 90, h, w];

  const nearlyLevel = Math.abs(angle) < 0.5 || best.area > level.w * level.h * 0.97;
  const rectangular = hole.cells / best.area > 0.9;
  const pick = nearlyLevel || !rectangular ? level : { cx: best.cx, cy: best.cy, w, h, angle };

  const sw = pick.w * CELL + BLEED * 2;
  const sh = pick.h * CELL + BLEED * 2;
  const rect: Rect = { x: pick.cx * CELL - sw / 2, y: pick.cy * CELL - sh / 2, w: sw, h: sh };
  if (pick.angle) rect.angle = Math.round(pick.angle * 10) / 10;
  return rect;
}

/** Finds the see-through regions of the sheet. */
function findHoles(data: Uint8ClampedArray): Rect[] {
  const clear = new Uint8Array(GRID_W * GRID_H);
  for (let gy = 0; gy < GRID_H; gy++) {
    for (let gx = 0; gx < GRID_W; gx++) {
      // Sample the middle of each cell.
      const p = (gy * CELL + CELL / 2) * SHEET_W + gx * CELL + CELL / 2;
      clear[gy * GRID_W + gx] = data[p * 4 + 3] < CLEAR_ALPHA ? 1 : 0;
    }
  }

  const seen = new Uint8Array(clear.length);
  const stack = new Int32Array(clear.length);
  const rowMin = new Int32Array(GRID_H);
  const rowMax = new Int32Array(GRID_H);
  const minCells = clear.length * MIN_HOLE_SHARE;
  const holes: Rect[] = [];

  for (let start = 0; start < clear.length; start++) {
    if (!clear[start] || seen[start]) continue;
    rowMin.fill(GRID_W);
    rowMax.fill(-1);
    const hole: Blob2D = { cells: 0, minX: GRID_W, minY: GRID_H, maxX: 0, maxY: 0, hull: [] };
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    while (top > 0) {
      const p = stack[--top];
      const x = p % GRID_W;
      const y = (p - x) / GRID_W;
      hole.cells++;
      if (x < rowMin[y]) rowMin[y] = x;
      if (x > rowMax[y]) rowMax[y] = x;
      if (x < hole.minX) hole.minX = x;
      if (x > hole.maxX) hole.maxX = x;
      if (y < hole.minY) hole.minY = y;
      if (y > hole.maxY) hole.maxY = y;
      const next = [x > 0 ? p - 1 : -1, x < GRID_W - 1 ? p + 1 : -1, y > 0 ? p - GRID_W : -1, y < GRID_H - 1 ? p + GRID_W : -1];
      for (const q of next) {
        if (q >= 0 && clear[q] && !seen[q]) {
          seen[q] = 1;
          stack[top++] = q;
        }
      }
    }
    if (hole.cells < minCells) continue;

    // Only each row's two ends can be on the hull; use the cells' outer corners.
    const corners: Point[] = [];
    for (let y = hole.minY; y <= hole.maxY; y++) {
      if (rowMax[y] < 0) continue;
      corners.push([rowMin[y], y], [rowMax[y] + 1, y], [rowMin[y], y + 1], [rowMax[y] + 1, y + 1]);
    }
    hole.hull = convexHull(corners);
    holes.push(holeRect(hole));
  }

  return readingOrder(holes);
}

/** Top to bottom, then left to right within a row — the order guests shoot in. */
function readingOrder(holes: Rect[]): Rect[] {
  const centre = (r: Rect) => r.y + r.h / 2;
  const rows: Rect[][] = [];
  for (const hole of [...holes].sort((a, b) => centre(a) - centre(b))) {
    const row = rows.find((r) => Math.abs(centre(r[0]) - centre(hole)) < Math.min(r[0].h, hole.h) / 2);
    if (row) row.push(hole);
    else rows.push([hole]);
  }
  return rows.flatMap((row) => row.sort((a, b) => a.x - b.x));
}

const PACKAGE_SHOTS = PACKAGES.map((p) => p.shots).join(', ');

export async function prepareFrame(file: File): Promise<PreparedFrame> {
  const img = await loadFile(file);
  const ratio = img.naturalWidth / img.naturalHeight;
  if (Math.abs(ratio - 2 / 3) > 0.02) {
    throw new FrameFileError(
      `Ukuran frame harus 4R tegak (rasio 2:3), mis. 1200 × 1800 px. File ini ${img.naturalWidth} × ${img.naturalHeight} px.`,
    );
  }

  // Every frame is stored at the size the sheet is composed at.
  const canvas = document.createElement('canvas');
  canvas.width = SHEET_W;
  canvas.height = SHEET_H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new FrameFileError('Browser ini tidak bisa memproses gambar.');
  ctx.drawImage(img, 0, 0, SHEET_W, SHEET_H);
  const pixels = ctx.getImageData(0, 0, SHEET_W, SHEET_H);

  let clearCount = 0;
  for (let i = 3; i < pixels.data.length; i += 4) if (pixels.data[i] < CLEAR_ALPHA) clearCount++;
  const hasClearHoles = clearCount >= SHEET_W * SHEET_H * MIN_HOLE_SHARE;
  const marking = hasClearHoles ? 'transparent' : 'green';
  if (!hasClearHoles) {
    if (keyOutGreen(pixels.data) === 0) {
      throw new FrameFileError(
        'Tidak ada tempat foto di desain ini. Isi tempat foto dengan kotak hijau #00FF00, atau buat bagian itu transparan.',
      );
    }
    ctx.putImageData(pixels, 0, 0);
  }

  const slots = findHoles(pixels.data);
  const pkg = PACKAGES.find((p) => p.shots === slots.length);
  if (!pkg) {
    throw new FrameFileError(
      slots.length === 0
        ? 'Tempat fotonya terlalu kecil. Buat kotak foto lebih besar.'
        : `Terdeteksi ${slots.length} tempat foto. Frame harus punya ${PACKAGE_SHOTS} tempat foto, sesuai paket.`,
    );
  }

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new FrameFileError('Browser ini tidak bisa menyimpan PNG.');
  return { blob, url: URL.createObjectURL(blob), slots, marking, format: pkg.format };
}

/**
 * A starting point for the designer: a 4R sheet with green boxes where the package's photos
 * sit by default. Move, resize or tilt them; the booth reads wherever they end up.
 */
export async function frameGuide(format: string, label: string): Promise<Blob> {
  const pkg = PACKAGES.find((p) => p.format === format);
  const layout = boardLayout(format, 'plain', pkg?.shots ?? 1);
  const canvas = document.createElement('canvas');
  canvas.width = SHEET_W;
  canvas.height = SHEET_H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#f3eee8';
  ctx.fillRect(0, 0, SHEET_W, SHEET_H);
  ctx.fillStyle = '#00ff00';
  for (const slot of layout.slots) ctx.fillRect(slot.x, slot.y, slot.w, slot.h);

  if (layout.footer) {
    const { x, y, w, h } = layout.footer;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#181816';
    ctx.font = '600 40px system-ui, sans-serif';
    ctx.fillText(`Panduan frame ${label} · 1200 × 1800 px`, x + w / 2, y + h * 0.38, w);
    ctx.fillStyle = '#6e6259';
    ctx.font = '400 28px system-ui, sans-serif';
    ctx.fillText('Kotak hijau = tempat foto. Boleh digeser, diubah ukuran, dimiringkan.', x + w / 2, y + h * 0.68, w);
  }

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('guide failed');
  return blob;
}
