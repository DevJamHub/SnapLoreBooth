import { backgroundById, type BoothBackground } from './backgrounds';
import { applyBeauty } from './beauty';
import { drawDecor, loadDecorFonts, type DecorItem } from './decor';
import { dateLocale, type Lang } from './i18n';
import { boardLayout, type BoardLayout, type Rect } from './layout';
import { FILTERS, TEMPLATES, beautyLevel, filterCss, filterFx, type BeautyLevel, type FilterFx, type FilterOp } from './packages';
import type { CustomFrame } from './types';

export { boardLayout, sheetSize, slotAspect, type BoardLayout, type Rect } from './layout';

export interface StripOptions {
  format: string;
  filterId: string;
  templateId: string;
  eventName: string;
  capturedAt: Date;
  /** An uploaded frame; it is used when templateId is its id. */
  frame?: CustomFrame | null;
  /** Flip every photo left to right, as the guest saw them in a mirrored preview. */
  mirror?: boolean;
  /** Skin smoothing; see BEAUTY in packages.ts. Stand-in photos are never smoothed. */
  beauty?: string;
  /** Built-in frames print the date under the event name unless this is false. */
  showDate?: boolean;
  /** A QR code image (data URL) to the guest's photos, printed in a built-in frame's footer. */
  qr?: string | null;
  /** The guest's stickers, writing and doodles, drawn over everything. */
  decor?: DecorItem[] | null;
  /** A backdrop put behind the people in each photo (lib/backgrounds.ts); stills only. */
  background?: string | null;
  /** The guest's language, for the date a built-in frame prints. */
  lang?: Lang;
}

/** A photo's people (the mask, in the photo's own shape) and the backdrop to put behind them. */
interface Backdrop {
  mask: HTMLCanvasElement;
  background: BoothBackground;
}

/** Puts `backdrop` behind the people in a photo already cut to its slot. */
function replaceBackdrop(base: HTMLCanvasElement, { mask, background }: Backdrop) {
  const { width: w, height: h } = base;
  const people = document.createElement('canvas');
  people.width = w;
  people.height = h;
  const p = people.getContext('2d')!;
  p.drawImage(base, 0, 0);
  // The mask has the photo's shape, so the same cover crop lines it up with the cut photo.
  p.globalCompositeOperation = 'destination-in';
  drawCover(p, mask, 0, 0, w, h);
  const ctx = base.getContext('2d')!;
  ctx.clearRect(0, 0, w, h);
  background.draw(ctx, w, h);
  ctx.drawImage(people, 0, 0);
}


function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Foto tidak bisa dimuat'));
    img.src = src;
  });
}

/**
 * Photos already loaded, by source. Gaya recomposes the sheet on every tap and the capture
 * screen after every shot; each would otherwise fetch and decode every photo again. A retake
 * gets a new source, so a stale photo is never drawn. Failed loads are not kept.
 */
const loaded = new Map<string, Promise<HTMLImageElement>>();
const LOADED_KEPT = 12;

function cachedImage(src: string): Promise<HTMLImageElement> {
  let image = loaded.get(src);
  if (image) {
    // Most recently used goes last, so the oldest is the one let go.
    loaded.delete(src);
  } else {
    image = loadImage(src);
    image.catch(() => loaded.get(src) === image && loaded.delete(src));
  }
  loaded.set(src, image);
  if (loaded.size > LOADED_KEPT) loaded.delete(loaded.keys().next().value!);
  return image;
}

const PLACEHOLDER_TONES = [
  ['#d08a6a', '#5b3f33'],
  ['#e5b07f', '#7a5a46'],
  ['#9bb98d', '#3f4c3a'],
  ['#c0a6d6', '#4f4560'],
  ['#de7d6b', '#5e2d26'],
  ['#ecca8f', '#7d6440'],
];

/** A stand-in "photo" — warm backdrop and a guest's silhouette — for slots not yet shot. */
export function placeholderCanvas(index: number, width = 600, height = 600): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const [light, dark] = PLACEHOLDER_TONES[index % PLACEHOLDER_TONES.length];
  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, light);
  bg.addColorStop(1, dark);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.38)';
  const unit = Math.min(width, height);
  ctx.beginPath();
  ctx.arc(width / 2, height * 0.42, unit * 0.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(width / 2, height * 1.02, unit * 0.34, unit * 0.36, 0, 0, Math.PI * 2);
  ctx.fill();
  return canvas;
}

export type Drawable = HTMLImageElement | HTMLCanvasElement | HTMLVideoElement;

function sizeOf(src: Drawable): { width: number; height: number } {
  return src instanceof HTMLVideoElement ? { width: src.videoWidth, height: src.videoHeight } : { width: src.width, height: src.height };
}

/** Draws src into the box as a centre-cropped "cover" fit — the same crop for stills and clips. */
function drawCover(ctx: CanvasRenderingContext2D, src: Drawable, x: number, y: number, w: number, h: number) {
  const { width, height } = sizeOf(src);
  if (!width || !height) return;
  const scale = Math.max(w / width, h / height);
  const sw = w / scale;
  const sh = h / scale;
  ctx.drawImage(src, (width - sw) / 2, (height - sh) / 2, sw, sh, x, y, w, h);
}

let canvasFilterSupport: boolean | null = null;

/** Safari before 18 accepts `ctx.filter` assignments but silently ignores them. */
function supportsCanvasFilter(): boolean {
  if (canvasFilterSupport !== null) return canvasFilterSupport;
  const probe = document.createElement('canvas').getContext('2d');
  if (!probe || !('filter' in probe)) return (canvasFilterSupport = false);
  probe.filter = 'grayscale(1)';
  return (canvasFilterSupport = probe.filter === 'grayscale(1)');
}

/** The same colour maths CSS filters use, applied to pixels in order. */
function applyOps(data: Uint8ClampedArray, ops: FilterOp[]) {
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];
    for (const { op, v } of ops) {
      if (op === 'brightness') {
        r *= v; g *= v; b *= v;
      } else if (op === 'contrast') {
        const k = 127.5 * (1 - v);
        r = r * v + k; g = g * v + k; b = b * v + k;
      } else if (op === 'grayscale') {
        const a = 1 - v;
        const nr = (0.2126 + 0.7874 * a) * r + (0.7152 - 0.7152 * a) * g + (0.0722 - 0.0722 * a) * b;
        const ng = (0.2126 - 0.2126 * a) * r + (0.7152 + 0.2848 * a) * g + (0.0722 - 0.0722 * a) * b;
        const nb = (0.2126 - 0.2126 * a) * r + (0.7152 - 0.7152 * a) * g + (0.0722 + 0.9278 * a) * b;
        r = nr; g = ng; b = nb;
      } else if (op === 'sepia') {
        const a = 1 - v;
        const nr = (0.393 + 0.607 * a) * r + (0.769 - 0.769 * a) * g + (0.189 - 0.189 * a) * b;
        const ng = (0.349 - 0.349 * a) * r + (0.686 + 0.314 * a) * g + (0.168 - 0.168 * a) * b;
        const nb = (0.272 - 0.272 * a) * r + (0.534 - 0.534 * a) * g + (0.131 + 0.869 * a) * b;
        r = nr; g = ng; b = nb;
      } else if (op === 'saturate') {
        const nr = (0.213 + 0.787 * v) * r + (0.715 - 0.715 * v) * g + (0.072 - 0.072 * v) * b;
        const ng = (0.213 - 0.213 * v) * r + (0.715 + 0.285 * v) * g + (0.072 - 0.072 * v) * b;
        const nb = (0.213 - 0.213 * v) * r + (0.715 - 0.715 * v) * g + (0.072 + 0.928 * v) * b;
        r = nr; g = ng; b = nb;
      }
    }
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }
}

let grainTile: HTMLCanvasElement | null = null;

/** Mid-grey noise; laid on with "overlay" it darkens and lightens a photo by turns, like film. */
function grainPattern(): HTMLCanvasElement {
  if (grainTile) return grainTile;
  const size = 160;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const noise = ctx.createImageData(size, size);
  for (let i = 0; i < noise.data.length; i += 4) {
    const v = 128 + (Math.random() - 0.5) * 230;
    noise.data[i] = v;
    noise.data[i + 1] = v;
    noise.data[i + 2] = v;
    noise.data[i + 3] = 255;
  }
  ctx.putImageData(noise, 0, 0);
  return (grainTile = canvas);
}

/** A look's textures over one photo, in the slot's own box (0,0)-(w,h). */
function drawFx(ctx: CanvasRenderingContext2D, fx: FilterFx[], w: number, h: number) {
  if (fx.length === 0) return;
  ctx.save();
  if ('filter' in ctx) ctx.filter = 'none';
  if (fx.includes('leak')) {
    // Warm light spilling in from one corner, and a fainter one from the opposite edge.
    ctx.globalCompositeOperation = 'screen';
    const reach = Math.max(w, h);
    const warm = ctx.createRadialGradient(0, 0, 0, 0, 0, reach * 0.85);
    warm.addColorStop(0, 'rgba(255, 150, 70, 0.7)');
    warm.addColorStop(0.4, 'rgba(255, 90, 90, 0.22)');
    warm.addColorStop(1, 'rgba(255, 90, 90, 0)');
    ctx.fillStyle = warm;
    ctx.fillRect(0, 0, w, h);
    const glow = ctx.createRadialGradient(w, h * 0.8, 0, w, h * 0.8, reach * 0.5);
    glow.addColorStop(0, 'rgba(255, 210, 120, 0.35)');
    glow.addColorStop(1, 'rgba(255, 210, 120, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);
  }
  if (fx.includes('vignette')) {
    ctx.globalCompositeOperation = 'source-over';
    const shade = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.32, w / 2, h / 2, Math.hypot(w, h) * 0.55);
    shade.addColorStop(0, 'rgba(0, 0, 0, 0)');
    shade.addColorStop(1, 'rgba(0, 0, 0, 0.5)');
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, w, h);
  }
  if (fx.includes('grain')) {
    const pattern = ctx.createPattern(grainPattern(), 'repeat');
    if (pattern) {
      ctx.globalCompositeOperation = 'overlay';
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, w, h);
    }
  }
  ctx.restore();
}

/**
 * Smoothed photos, cut to their slot. The Gaya screen recomposes the sheet on every tap and
 * the look changes far more often than the smoothing, so the smoothing is done once.
 */
const smoothed = new Map<string, HTMLCanvasElement>();
const SMOOTHED_KEPT = 16;

/**
 * One photo cut to its slot, with what the canvas cannot do itself applied to its own pixels:
 * the smoothing, and the look on browsers without canvas filters. Done on the cut photo, so a
 * tilted slot never touches a neighbour it overlaps.
 */
function slotPicture(
  img: Drawable,
  src: string | null,
  slot: Rect,
  beauty: BeautyLevel | null,
  ops: FilterOp[] | null,
  backdrop: Backdrop | null = null,
): HTMLCanvasElement {
  const w = Math.round(slot.w);
  const h = Math.round(slot.h);
  const key = (beauty || backdrop) && src ? `${beauty?.id ?? '-'}|${backdrop?.background.id ?? '-'}|${w}x${h}|${src}` : null;
  let base = key ? smoothed.get(key) : undefined;
  if (!base) {
    base = document.createElement('canvas');
    base.width = w;
    base.height = h;
    const ctx = base.getContext('2d', { willReadFrequently: true })!;
    drawCover(ctx, img, 0, 0, w, h);
    if (beauty) {
      const pixels = ctx.getImageData(0, 0, w, h);
      applyBeauty(pixels, beauty);
      ctx.putImageData(pixels, 0, 0);
    }
    if (backdrop) replaceBackdrop(base, backdrop);
    if (key) {
      smoothed.set(key, base);
      if (smoothed.size > SMOOTHED_KEPT) smoothed.delete(smoothed.keys().next().value!);
    }
  }
  if (!ops) return base;

  // The cached cut stays untouched; the look goes on a copy.
  const out = key ? document.createElement('canvas') : base;
  if (out !== base) {
    out.width = w;
    out.height = h;
    out.getContext('2d')!.drawImage(base, 0, 0);
  }
  const ctx = out.getContext('2d', { willReadFrequently: true })!;
  const pixels = ctx.getImageData(0, 0, w, h);
  applyOps(pixels.data, ops);
  ctx.putImageData(pixels, 0, 0);
  return out;
}

/** The uploaded frame these options select, if any. */
function frameOf(options: StripOptions): CustomFrame | null {
  const { frame } = options;
  return frame && frame.id === options.templateId && frame.format === options.format ? frame : null;
}

/**
 * Makes the slot the box (0,0)-(w,h) on ctx, tilted as the frame tilts it, and clips to it.
 * Pair with ctx.restore().
 */
function enterSlot(ctx: CanvasRenderingContext2D, slot: Rect, mirror = false) {
  ctx.save();
  ctx.translate(slot.x + slot.w / 2, slot.y + slot.h / 2);
  if (slot.angle) ctx.rotate((slot.angle * Math.PI) / 180);
  ctx.translate(-slot.w / 2, -slot.h / 2);
  ctx.beginPath();
  ctx.rect(0, 0, slot.w, slot.h);
  ctx.clip();
  if (mirror) {
    ctx.translate(slot.w, 0);
    ctx.scale(-1, 1);
  }
}

/** The sheet without photos: board colour, event name, date and QR. Shared by stills and video. */
function drawBoardBase(ctx: CanvasRenderingContext2D, layout: BoardLayout, options: StripOptions, qr: HTMLImageElement | null = null) {
  // An uploaded frame covers the whole sheet; white only shows through a hole left unfilled.
  if (frameOf(options)) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, layout.width, layout.height);
    return;
  }
  const template = TEMPLATES.find((t) => t.id === options.templateId) ?? TEMPLATES[0];
  ctx.fillStyle = template.board;
  ctx.fillRect(0, 0, layout.width, layout.height);

  if (layout.footer) {
    const { x, y, w, h } = layout.footer;
    let textX = x;
    let textW = w;
    if (qr) {
      // The code sits at the footer's right on a white square, so it scans on a dark board too.
      const size = Math.round(Math.min(h * 0.8, w * 0.24));
      const pad = Math.round(size * 0.08);
      const qx = x + w - size - pad;
      const qy = y + (h - size) / 2;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(qx - pad, qy - pad, size + pad * 2, size + pad * 2);
      ctx.drawImage(qr, qx, qy, size, size);
      // A full sheet keeps its words centred; a strip has no room either side, so they move over.
      const reserve = size + pad * 3;
      if (layout.width >= 1000) {
        textX = x + reserve;
        textW = w - reserve * 2;
      } else {
        textW = w - reserve;
      }
    }

    ctx.textBaseline = 'top';
    ctx.textAlign = 'center';
    const centre = textX + textW / 2;
    let cursor = y + h * 0.24;

    if (template.eventMark) {
      ctx.fillStyle = template.ink;
      ctx.font = `500 ${Math.round(layout.width * 0.056)}px Georgia, serif`;
      ctx.fillText(options.eventName.slice(0, 32), centre, cursor, textW);
      cursor += Math.round(layout.width * 0.08);
    }

    if (template.date && options.showDate !== false) {
      ctx.fillStyle = template.muted;
      ctx.font = `400 ${Math.round(layout.width * 0.026)}px ui-monospace, monospace`;
      const stamp = options.capturedAt.toLocaleDateString(dateLocale(options.lang ?? 'id'), { day: 'numeric', month: 'long', year: 'numeric' });
      ctx.fillText(stamp.toUpperCase(), centre, cursor, textW);
    }
  }
}

/** The QR image for a built-in frame's footer; an uploaded frame prints its own design only. */
function qrFor(options: StripOptions): Promise<HTMLImageElement | null> {
  if (!options.qr || frameOf(options)) return Promise.resolve(null);
  return cachedImage(options.qr).catch(() => null);
}

/**
 * Composes the frames into one printable board and returns a JPEG data URL. A null source
 * draws a placeholder, so the same function previews a frame before any photo exists.
 */
export async function composeStrip(sources: (string | null)[], options: StripOptions, quality = 0.92): Promise<string> {
  const frame = frameOf(options);
  const [images, overlay, qr] = await Promise.all([
    Promise.all(sources.map((src, i): Promise<Drawable> => (src ? cachedImage(src) : Promise.resolve(placeholderCanvas(i))))),
    frame ? cachedImage(frame.src) : Promise.resolve(null),
    qrFor(options),
    options.decor?.length ? loadDecorFonts(options.decor) : null,
  ]);
  const ops = FILTERS.find((f) => f.id === options.filterId)?.ops ?? [];
  const fx = filterFx(options.filterId);
  const layout = boardLayout(options.format, options.templateId, images.length, frame);
  // Backdrops need each photo's people found first (on the device; the first one loads the model).
  const background = backgroundById(options.background ?? undefined);
  const masks = background
    ? await Promise.all(
        sources.map((src, i) => {
          const img = images[i];
          return src && img instanceof HTMLImageElement ? import('./segment').then(({ personMask }) => personMask(src, img)) : null;
        }),
      )
    : [];

  const canvas = document.createElement('canvas');
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Browser ini tidak bisa menyusun foto');

  drawBoardBase(ctx, layout, options, qr);

  const nativeFilter = ops.length > 0 && supportsCanvasFilter();
  const beauty = beautyLevel(options.beauty);

  layout.slots.forEach((slot, i) => {
    const img = images[i];
    if (!img) return;
    const src = sources[i] ?? null;
    const slotBeauty = src ? beauty : null;
    const pixelOps = ops.length > 0 && !nativeFilter ? ops : null;
    const mask = masks[i];
    const backdrop = background && mask ? { mask, background } : null;
    const picture: Drawable = slotBeauty || pixelOps || backdrop ? slotPicture(img, src, slot, slotBeauty, pixelOps, backdrop) : img;

    enterSlot(ctx, slot, options.mirror);
    if (nativeFilter) ctx.filter = filterCss(options.filterId);
    drawCover(ctx, picture, 0, 0, slot.w, slot.h);
    // Stand-ins stay plain: textures only make sense on a photo.
    if (src) drawFx(ctx, fx, slot.w, slot.h);
    ctx.restore();
  });

  if (overlay) ctx.drawImage(overlay, 0, 0, layout.width, layout.height);
  if (options.decor?.length) drawDecor(ctx, options.decor, options.eventName);

  return canvas.toDataURL('image/jpeg', quality);
}

export interface LiveBoard {
  width: number;
  height: number;
  /** Draws the sheet with `source` in every hole (stand-ins while it has no picture yet). */
  draw(ctx: CanvasRenderingContext2D, source: Drawable | null): void;
}

/**
 * The chosen frame as a live picture, for showing guests themselves in it before they shoot:
 * the frame is loaded and its base drawn once, then each call only paints the holes.
 */
export async function liveBoard(options: StripOptions, shots: number): Promise<LiveBoard> {
  const frame = frameOf(options);
  const layout = boardLayout(options.format, options.templateId, shots, frame);
  const base = document.createElement('canvas');
  base.width = layout.width;
  base.height = layout.height;
  drawBoardBase(base.getContext('2d')!, layout, options, await qrFor(options));
  const overlay = frame ? await cachedImage(frame.src) : null;
  const standIns = layout.slots.map((slot, i) => placeholderCanvas(i, Math.round(slot.w / 2), Math.round(slot.h / 2)));

  return {
    width: layout.width,
    height: layout.height,
    draw(ctx, source) {
      const live = source && sizeOf(source).width > 0 ? source : null;
      ctx.drawImage(base, 0, 0);
      layout.slots.forEach((slot, i) => {
        enterSlot(ctx, slot, live ? options.mirror : false);
        drawCover(ctx, live ?? standIns[i], 0, 0, slot.w, slot.h);
        ctx.restore();
      });
      if (overlay) ctx.drawImage(overlay, 0, 0, layout.width, layout.height);
    },
  };
}

export interface LiveSlot {
  /** The shot's countdown clip; null when it never uploaded, and the still stands in. */
  clip: string | null;
  still: string;
}

/** Recorders differ: Safari writes MP4, Chrome MP4 or WebM. Null when this browser cannot record. */
export function recorderMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  return ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find((t) => MediaRecorder.isTypeSupported?.(t)) ?? null;
}

function loadClip(src: string, holder: HTMLElement): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');
    const timer = setTimeout(() => reject(new Error('clip timed out')), 10_000);
    video.onloadeddata = () => {
      clearTimeout(timer);
      resolve(video);
    };
    video.onerror = () => {
      clearTimeout(timer);
      reject(new Error('clip failed to load'));
    };
    video.src = src;
    // iOS only decodes frames for videos that are in the document.
    holder.appendChild(video);
  });
}

const LIVE_FALLBACK_SECONDS = 3.2;

/**
 * The "live" sheet: every slot plays its own countdown clip at once, inside the chosen frame,
 * recorded from a canvas into one short video. Takes as long as the clips play (~3s).
 * Returns null when the browser cannot record or there are no clips.
 */
export async function composeLive(slots: LiveSlot[], options: StripOptions, scale = 2 / 3, bitrate = 3_000_000): Promise<Blob | null> {
  const mimeType = recorderMimeType();
  if (!mimeType || !slots.some((s) => s.clip)) return null;

  const frame = frameOf(options);
  const layout = boardLayout(options.format, options.templateId, slots.length, frame);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(layout.width * scale);
  canvas.height = Math.round(layout.height * scale);
  if (typeof canvas.captureStream !== 'function') return null;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // The frame itself never changes, so it is drawn once and stamped under every video frame;
  // the guest's stickers and doodles likewise, over every frame.
  const base = document.createElement('canvas');
  base.width = layout.width;
  base.height = layout.height;
  drawBoardBase(base.getContext('2d')!, layout, options, await qrFor(options));
  let decorLayer: HTMLCanvasElement | null = null;
  if (options.decor?.length) {
    await loadDecorFonts(options.decor);
    decorLayer = document.createElement('canvas');
    decorLayer.width = layout.width;
    decorLayer.height = layout.height;
    drawDecor(decorLayer.getContext('2d')!, options.decor, options.eventName);
  }

  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;overflow:hidden;pointer-events:none;';
  document.body.appendChild(holder);

  try {
    const [media, overlay] = await Promise.all([
      Promise.all(
        slots.map((slot): Promise<Drawable> => (slot.clip ? loadClip(slot.clip, holder).catch(() => loadImage(slot.still)) : loadImage(slot.still))),
      ),
      frame ? cachedImage(frame.src) : Promise.resolve(null),
    ]);
    const videos = media.filter((m): m is HTMLVideoElement => m instanceof HTMLVideoElement);
    if (videos.length === 0) return null;

    const filter = filterCss(options.filterId);
    const useFilter = filter !== 'none' && supportsCanvasFilter();
    const fx = filterFx(options.filterId);
    const seconds = Math.max(...videos.map((v) => (Number.isFinite(v.duration) && v.duration > 0 ? v.duration : LIVE_FALLBACK_SECONDS)));

    videos.forEach((v) => (v.currentTime = 0));
    await Promise.all(videos.map((v) => v.play().catch(() => undefined)));

    const recorder = new MediaRecorder(canvas.captureStream(30), { mimeType, videoBitsPerSecond: bitrate });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
    const stopped = new Promise<void>((resolve) => (recorder.onstop = () => resolve()));

    const draw = () => {
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.drawImage(base, 0, 0);
      layout.slots.forEach((slot, i) => {
        const src = media[i];
        if (!src) return;
        enterSlot(ctx, slot, options.mirror);
        if (useFilter) ctx.filter = filter;
        drawCover(ctx, src, 0, 0, slot.w, slot.h);
        drawFx(ctx, fx, slot.w, slot.h);
        ctx.restore();
      });
      if (overlay) ctx.drawImage(overlay, 0, 0, layout.width, layout.height);
      if (decorLayer) ctx.drawImage(decorLayer, 0, 0);
    };

    draw();
    recorder.start();
    const started = performance.now();
    await new Promise<void>((resolve) => {
      const frame = () => {
        draw();
        if (performance.now() - started >= seconds * 1000 + 120) return resolve();
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    recorder.stop();
    await stopped;
    videos.forEach((v) => v.pause());
    return chunks.length ? new Blob(chunks, { type: mimeType.split(';')[0] }) : null;
  } finally {
    // iOS decodes only a few videos at once and holds on to one until its source is cleared,
    // so a booth that made many live sheets would otherwise stop playing video.
    for (const video of holder.querySelectorAll('video')) {
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
    holder.remove();
  }
}
