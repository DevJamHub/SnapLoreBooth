/**
 * Stickers, writing and doodles a guest adds to their sheet on the Gaya screen. They are kept on
 * the session as data in the sheet's own pixels (1200x1800, or 600x1800 for a strip), so the
 * print, the live video and the QR page all draw the same thing. Drawing needs a browser; the
 * catalogue and the checks are shared with the server, which refuses anything the screen would
 * not make.
 */

export type DecorFont = 'serif' | 'sans' | 'hand';

export interface StickerDecor {
  kind: 'sticker';
  sticker: string;
  /** Centre, in sheet pixels. */
  x: number;
  y: number;
  /** Height in sheet pixels; the width follows the sticker's own shape. */
  size: number;
  /** Degrees clockwise. */
  angle: number;
}

export interface TextDecor {
  kind: 'text';
  text: string;
  font: DecorFont;
  color: string;
  x: number;
  y: number;
  size: number;
  angle: number;
}

/** One finger stroke: sheet coordinates as a flat [x0, y0, x1, y1, …] list. */
export interface InkDecor {
  kind: 'ink';
  color: string;
  width: number;
  points: number[];
}

export type DecorItem = StickerDecor | TextDecor | InkDecor;

export type Sticker = { id: string; label: string } & ({ emoji: string } | { badge: string; bg: string; fg: string });

/** The event's own badge: its name or hashtag, whatever the sheet prints. */
export const EVENT_STICKER = 'event';

/**
 * Emoji draw with the device's own emoji font (Apple on an iPad, Noto on Android); only ones
 * every Android since 10 has are listed. Badges are drawn here, so they look alike everywhere.
 */
export const STICKERS: Sticker[] = [
  { id: 'heart', label: 'Hati', emoji: '💖' },
  { id: 'sparkle', label: 'Kilau', emoji: '✨' },
  { id: 'crown', label: 'Mahkota', emoji: '👑' },
  { id: 'bow', label: 'Pita', emoji: '🎀' },
  { id: 'blossom', label: 'Bunga', emoji: '🌸' },
  { id: 'butterfly', label: 'Kupu-kupu', emoji: '🦋' },
  { id: 'star', label: 'Bintang', emoji: '⭐' },
  { id: 'fire', label: 'Api', emoji: '🔥' },
  { id: 'kiss', label: 'Kecup', emoji: '💋' },
  { id: 'cool', label: 'Keren', emoji: '😎' },
  { id: 'party', label: 'Pesta', emoji: '🥳' },
  { id: 'popper', label: 'Konfeti', emoji: '🎉' },
  { id: 'rainbow', label: 'Pelangi', emoji: '🌈' },
  { id: 'cherry', label: 'Ceri', emoji: '🍒' },
  { id: 'bunny', label: 'Kelinci', emoji: '🐰' },
  { id: 'cat', label: 'Kucing', emoji: '🐱' },
  { id: 'bear', label: 'Beruang', emoji: '🧸' },
  { id: 'cake', label: 'Kue', emoji: '🎂' },
  { id: 'ring', label: 'Cincin', emoji: '💍' },
  { id: 'bouquet', label: 'Buket', emoji: '💐' },
  { id: 'camera', label: 'Kamera', emoji: '📸' },
  { id: 'music', label: 'Musik', emoji: '🎶' },
  { id: 'cloud', label: 'Awan', emoji: '☁️' },
  { id: 'moon', label: 'Bulan', emoji: '🌙' },
  { id: EVENT_STICKER, label: 'Nama acara', badge: '', bg: '#cc785c', fg: '#ffffff' },
  { id: 'omg', label: 'OMG', badge: 'OMG!', bg: '#ff5c8a', fg: '#ffffff' },
  { id: 'bestie', label: 'Bestie', badge: 'BESTIE', bg: '#a78bfa', fg: '#ffffff' },
  { id: 'love', label: 'Love', badge: 'LOVE YOU', bg: '#ef476f', fg: '#ffffff' },
  { id: 'yay', label: 'Yay', badge: 'YAY!', bg: '#ffd23f', fg: '#181816' },
  { id: 'cie', label: 'Ciee', badge: 'CIEE~', bg: '#4cc9f0', fg: '#181816' },
  { id: 'sah', label: 'Sah', badge: 'SAH!', bg: '#181816', fg: '#f3eee8' },
  { id: 'hbd', label: 'HBD', badge: 'HBD!', bg: '#7bd389', fg: '#181816' },
  { id: 'squad', label: 'Squad', badge: 'SQUAD', bg: '#f3eee8', fg: '#181816' },
  { id: 'cute', label: 'Cute', badge: 'so cute', bg: '#ffb4c8', fg: '#7a2340' },
];

export const DECOR_COLORS = ['#ffffff', '#181816', '#cc785c', '#ff5c8a', '#ffd23f', '#4cc9f0', '#7bd389', '#a78bfa'];

export const DECOR_FONTS: { id: DecorFont; label: string; css: string; weight: number }[] = [
  { id: 'hand', label: 'Tulisan tangan', css: '--font-hand', weight: 700 },
  { id: 'serif', label: 'Klasik', css: '--font-display', weight: 600 },
  { id: 'sans', label: 'Tegas', css: '--font-body', weight: 800 },
];

export const INK_WIDTHS = [8, 16, 28];

export const DECOR_LIMITS = { items: 60, text: 30, inkPoints: 9000, strokePoints: 1200 };

export class DecorInputError extends Error {}

const round = (n: number) => Math.round(n * 10) / 10;

function num(value: unknown, min: number, max: number, field: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new DecorInputError(`${field} di luar batas`);
  return round(n);
}

/**
 * Checks what the screen sent and returns a clean copy. Positions may fall a little outside the
 * sheet (a sticker half off the edge is a look), but never far.
 */
export function parseDecor(input: unknown, sheet: { width: number; height: number }): DecorItem[] {
  if (input === null) return [];
  if (!Array.isArray(input)) throw new DecorInputError('hiasan harus berupa daftar');
  if (input.length > DECOR_LIMITS.items) throw new DecorInputError(`maksimal ${DECOR_LIMITS.items} hiasan`);
  const { width: w, height: h } = sheet;
  let inkTotal = 0;

  return input.map((raw): DecorItem => {
    if (typeof raw !== 'object' || raw === null) throw new DecorInputError('hiasan tidak dikenal');
    const item = raw as Record<string, unknown>;
    if (item.kind === 'ink') {
      const color = String(item.color);
      if (!DECOR_COLORS.includes(color)) throw new DecorInputError('warna tidak dikenal');
      const points = item.points;
      if (!Array.isArray(points) || points.length < 2 || points.length % 2 !== 0) throw new DecorInputError('coretan tidak utuh');
      if (points.length > DECOR_LIMITS.strokePoints * 2) throw new DecorInputError('coretan terlalu panjang');
      inkTotal += points.length;
      if (inkTotal > DECOR_LIMITS.inkPoints * 2) throw new DecorInputError('coretan terlalu banyak');
      return {
        kind: 'ink',
        color,
        width: num(item.width, 2, 80, 'tebal'),
        points: points.map((p, i) => num(p, i % 2 === 0 ? -w * 0.1 : -h * 0.1, i % 2 === 0 ? w * 1.1 : h * 1.1, 'titik')),
      };
    }

    const placed = {
      x: num(item.x, -w * 0.5, w * 1.5, 'posisi'),
      y: num(item.y, -h * 0.5, h * 1.5, 'posisi'),
      size: num(item.size, 20, Math.max(w, h), 'ukuran'),
      angle: num(item.angle, -720, 720, 'putaran'),
    };
    if (item.kind === 'sticker') {
      const sticker = String(item.sticker);
      if (!STICKERS.some((s) => s.id === sticker)) throw new DecorInputError('stiker tidak dikenal');
      return { kind: 'sticker', sticker, ...placed };
    }
    if (item.kind === 'text') {
      const text = typeof item.text === 'string' ? item.text.replace(/\s+/g, ' ').trim().slice(0, DECOR_LIMITS.text) : '';
      if (!text) throw new DecorInputError('tulisan kosong');
      const font = DECOR_FONTS.find((f) => f.id === item.font)?.id;
      if (!font) throw new DecorInputError('huruf tidak dikenal');
      const color = String(item.color);
      if (!DECOR_COLORS.includes(color)) throw new DecorInputError('warna tidak dikenal');
      return { kind: 'text', text, font, color, ...placed };
    }
    throw new DecorInputError('hiasan tidak dikenal');
  });
}

/* ---------- drawing (browser only) ---------- */

const TILE = 512;
const tiles = new Map<string, HTMLCanvasElement>();
const TILES_KEPT = 80;

function remember(key: string, tile: HTMLCanvasElement): HTMLCanvasElement {
  tiles.set(key, tile);
  if (tiles.size > TILES_KEPT) tiles.delete(tiles.keys().next().value!);
  return tile;
}

/** The family a CSS variable from next/font names, for canvas text. */
function fontFamily(variable: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const family = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
  return family ? `${family}, ${fallback}` : fallback;
}

const EMOJI_FONT = '"Apple Color Emoji", "Noto Color Emoji", "Segoe UI Emoji", sans-serif';

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function badgeText(sticker: Sticker, eventName: string): string {
  if (!('badge' in sticker)) return '';
  return (sticker.id === EVENT_STICKER ? eventName : sticker.badge).slice(0, 24) || 'Snaplore';
}

function stickerTile(sticker: Sticker, eventName: string): HTMLCanvasElement {
  const key = `s|${sticker.id}|${sticker.id === EVENT_STICKER ? eventName : ''}`;
  const cached = tiles.get(key);
  if (cached) return cached;
  const canvas = document.createElement('canvas');

  if ('emoji' in sticker) {
    canvas.width = TILE;
    canvas.height = TILE;
    const ctx = canvas.getContext('2d')!;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${Math.round(TILE * 0.82)}px ${EMOJI_FONT}`;
    ctx.fillText(sticker.emoji, TILE / 2, TILE * 0.54);
    return remember(key, canvas);
  }

  // A pill with a white rim and a soft shadow, sized to its words.
  const text = badgeText(sticker, eventName);
  const fontSize = 150;
  const font = `800 ${fontSize}px ${fontFamily('--font-body', 'system-ui, sans-serif')}`;
  const probe = canvas.getContext('2d')!;
  probe.font = font;
  const textW = Math.ceil(probe.measureText(text).width);
  const padX = fontSize * 0.55;
  const rim = fontSize * 0.09;
  const shadow = fontSize * 0.12;
  const pillW = textW + padX * 2;
  const pillH = fontSize * 1.45;
  canvas.width = Math.ceil(pillW + rim * 2 + shadow * 2);
  canvas.height = Math.ceil(pillH + rim * 2 + shadow * 2);
  const ctx = canvas.getContext('2d')!;
  const x = shadow + rim;
  const y = shadow + rim;
  ctx.shadowColor = 'rgba(0, 0, 0, 0.28)';
  ctx.shadowBlur = shadow;
  ctx.shadowOffsetY = shadow * 0.4;
  ctx.fillStyle = '#ffffff';
  roundedRect(ctx, x - rim, y - rim, pillW + rim * 2, pillH + rim * 2, (pillH + rim * 2) / 2);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = sticker.bg;
  roundedRect(ctx, x, y, pillW, pillH, pillH / 2);
  ctx.fill();
  ctx.fillStyle = sticker.fg;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + pillW / 2, y + pillH / 2 + fontSize * 0.04);
  return remember(key, canvas);
}

/** Dark writing gets a white rim and light writing a dark one, so it reads on any photo. */
function rimFor(color: string): string {
  const n = parseInt(color.slice(1), 16);
  const luma = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return luma > 150 ? 'rgba(24, 24, 22, 0.85)' : 'rgba(255, 255, 255, 0.95)';
}

function textTile(item: TextDecor): HTMLCanvasElement {
  const key = `t|${item.font}|${item.color}|${item.text}`;
  const cached = tiles.get(key);
  if (cached) return cached;
  const spec = DECOR_FONTS.find((f) => f.id === item.font) ?? DECOR_FONTS[0];
  const fontSize = 160;
  const font = `${spec.weight} ${fontSize}px ${fontFamily(spec.css, 'system-ui, sans-serif')}`;
  const canvas = document.createElement('canvas');
  const probe = canvas.getContext('2d')!;
  probe.font = font;
  const rim = fontSize * 0.1;
  const textW = Math.ceil(probe.measureText(item.text).width);
  canvas.width = textW + Math.ceil(rim * 4);
  canvas.height = Math.ceil(fontSize * 1.35 + rim * 2);
  const ctx = canvas.getContext('2d')!;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = rim * 2;
  ctx.strokeStyle = rimFor(item.color);
  const cx = canvas.width / 2;
  const cy = canvas.height / 2 + fontSize * 0.04;
  ctx.strokeText(item.text, cx, cy);
  ctx.fillStyle = item.color;
  ctx.fillText(item.text, cx, cy);
  return remember(key, canvas);
}

/** The picture of a sticker or a line of writing, drawn once and reused at any size. */
export function decorTile(item: StickerDecor | TextDecor, eventName: string): HTMLCanvasElement | null {
  if (item.kind === 'text') return textTile(item);
  const sticker = STICKERS.find((s) => s.id === item.sticker);
  return sticker ? stickerTile(sticker, eventName) : null;
}

/** Width over height of a placed sticker or line of writing. */
export function decorAspect(item: StickerDecor | TextDecor, eventName: string): number {
  const tile = decorTile(item, eventName);
  return tile ? tile.width / tile.height : 1;
}

/** A stroke as a smooth line through the midpoints of its samples. */
export function drawInk(ctx: CanvasRenderingContext2D, item: InkDecor) {
  const p = item.points;
  ctx.save();
  ctx.strokeStyle = item.color;
  ctx.fillStyle = item.color;
  ctx.lineWidth = item.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  if (p.length === 2) {
    ctx.arc(p[0], p[1], item.width / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }
  ctx.moveTo(p[0], p[1]);
  for (let i = 2; i < p.length - 2; i += 2) {
    ctx.quadraticCurveTo(p[i], p[i + 1], (p[i] + p[i + 2]) / 2, (p[i + 1] + p[i + 3]) / 2);
  }
  ctx.lineTo(p[p.length - 2], p[p.length - 1]);
  ctx.stroke();
  ctx.restore();
}

/** Every font the items write with, loaded, so the first draw is not in a fallback face. */
export async function loadDecorFonts(items: DecorItem[]): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  const specs = new Set<string>();
  for (const item of items) {
    if (item.kind === 'text') {
      const spec = DECOR_FONTS.find((f) => f.id === item.font) ?? DECOR_FONTS[0];
      specs.add(`${spec.weight} 64px ${fontFamily(spec.css, 'sans-serif')}`);
    } else if (item.kind === 'sticker') {
      const sticker = STICKERS.find((s) => s.id === item.sticker);
      if (sticker && 'badge' in sticker) specs.add(`800 64px ${fontFamily('--font-body', 'sans-serif')}`);
    }
  }
  await Promise.all([...specs].map((spec) => document.fonts.load(spec).catch(() => undefined)));
}

/** Draws the items over a sheet, in the order they were added; strokes and stickers interleave. */
export function drawDecor(ctx: CanvasRenderingContext2D, items: DecorItem[], eventName: string) {
  for (const item of items) {
    if (item.kind === 'ink') {
      drawInk(ctx, item);
      continue;
    }
    const tile = decorTile(item, eventName);
    if (!tile) continue;
    const h = item.size;
    const w = h * (tile.width / tile.height);
    ctx.save();
    ctx.translate(item.x, item.y);
    ctx.rotate((item.angle * Math.PI) / 180);
    ctx.drawImage(tile, -w / 2, -h / 2, w, h);
    ctx.restore();
  }
}
