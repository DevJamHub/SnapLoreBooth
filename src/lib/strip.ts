import { FILTERS, TEMPLATES, filterCss, type FilterOp } from './packages';
import type { CustomFrame } from './types';

export interface StripOptions {
  format: string;
  filterId: string;
  templateId: string;
  eventName: string;
  capturedAt: Date;
  /** An uploaded frame; it is used when templateId is its id. */
  frame?: CustomFrame | null;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Degrees clockwise about the centre. Uploaded frames can hold tilted photos. */
  angle?: number;
}

export interface BoardLayout {
  width: number;
  height: number;
  slots: Rect[];
  /** Where the event name and date go; null when the frame prints neither. */
  footer: Rect | null;
}

/** 4R (4x6in) at 300dpi — every current package prints on one of these. */
const SHEET = { width: 1200, height: 1800 };

function grid(cols: number, rows: number, margin: number, gap: number, footer: number, size = SHEET): BoardLayout {
  const innerW = size.width - margin * 2;
  const innerH = size.height - margin * 2 - footer;
  const w = (innerW - gap * (cols - 1)) / cols;
  const h = (innerH - gap * (rows - 1)) / rows;
  const slots: Rect[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      slots.push({ x: Math.round(margin + c * (w + gap)), y: Math.round(margin + r * (h + gap)), w: Math.round(w), h: Math.round(h) });
    }
  }
  const footerRect = footer > 0 ? { x: margin, y: size.height - margin - footer, w: innerW, h: footer } : null;
  return { ...size, slots, footer: footerRect };
}

/**
 * Where every photo sits on the sheet. The capture screen sizes its viewfinder from the
 * same slots, so what the guest frames is exactly what prints.
 */
export function boardLayout(format: string, templateId: string, shots = 1, frame?: CustomFrame | null): BoardLayout {
  // An uploaded frame brings its own holes and prints its own text.
  if (frame && frame.id === templateId && frame.format === format) return { ...SHEET, slots: frame.slots, footer: null };

  const template = TEMPLATES.find((t) => t.id === templateId) ?? TEMPLATES[0];
  const footer = template.eventMark || template.date ? 180 : 0;
  const margin = Math.round(52 * template.border);

  switch (format) {
    case 'grid6':
      return grid(2, 3, margin, 20, footer);
    case 'grid4':
      return grid(2, 2, margin, 20, footer);
    case 'stack3':
      return grid(1, 3, margin, 22, footer);
    case 'single':
      return grid(1, 1, margin, 0, footer);
    // Boards from before the 4R-only packages, kept so old sessions still render.
    case '2x6':
      return grid(1, shots, Math.round(36 * template.border), 18, footer ? 170 : 0, { width: 600, height: 1800 });
    case '1x1':
      return grid(1, 1, margin, 0, footer ? 150 : 0, { width: 1200, height: 1200 });
    default:
      return grid(1, Math.max(shots, 1), margin, 22, footer);
  }
}

/** Width over height of one photo slot, for sizing the viewfinder. */
export function slotAspect(format: string, templateId: string): number {
  const slot = boardLayout(format, templateId).slots[0];
  return slot.w / slot.h;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Foto tidak bisa dimuat'));
    img.src = src;
  });
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

type Drawable = HTMLImageElement | HTMLCanvasElement | HTMLVideoElement;

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

/** The uploaded frame these options select, if any. */
function frameOf(options: StripOptions): CustomFrame | null {
  const { frame } = options;
  return frame && frame.id === options.templateId && frame.format === options.format ? frame : null;
}

/**
 * Makes the slot the box (0,0)-(w,h) on ctx, tilted as the frame tilts it, and clips to it.
 * Pair with ctx.restore().
 */
function enterSlot(ctx: CanvasRenderingContext2D, slot: Rect) {
  ctx.save();
  ctx.translate(slot.x + slot.w / 2, slot.y + slot.h / 2);
  if (slot.angle) ctx.rotate((slot.angle * Math.PI) / 180);
  ctx.translate(-slot.w / 2, -slot.h / 2);
  ctx.beginPath();
  ctx.rect(0, 0, slot.w, slot.h);
  ctx.clip();
}

/** The sheet without photos: board colour, event name and date. Shared by stills and video. */
function drawBoardBase(ctx: CanvasRenderingContext2D, layout: BoardLayout, options: StripOptions) {
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
    ctx.textBaseline = 'top';
    ctx.textAlign = 'center';
    const centre = x + w / 2;
    let cursor = y + h * 0.24;

    if (template.eventMark) {
      ctx.fillStyle = template.ink;
      ctx.font = `500 ${Math.round(layout.width * 0.056)}px Georgia, serif`;
      ctx.fillText(options.eventName.slice(0, 32), centre, cursor, w);
      cursor += Math.round(layout.width * 0.08);
    }

    if (template.date) {
      ctx.fillStyle = template.muted;
      ctx.font = `400 ${Math.round(layout.width * 0.026)}px ui-monospace, monospace`;
      const stamp = options.capturedAt.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
      ctx.fillText(stamp.toUpperCase(), centre, cursor, w);
    }
  }
}

/**
 * Composes the frames into one printable board and returns a JPEG data URL. A null source
 * draws a placeholder, so the same function previews a frame before any photo exists.
 */
export async function composeStrip(sources: (string | null)[], options: StripOptions, quality = 0.92): Promise<string> {
  const frame = frameOf(options);
  const [images, overlay] = await Promise.all([
    Promise.all(sources.map((src, i): Promise<Drawable> => (src ? loadImage(src) : Promise.resolve(placeholderCanvas(i))))),
    frame ? loadImage(frame.src) : Promise.resolve(null),
  ]);
  const ops = FILTERS.find((f) => f.id === options.filterId)?.ops ?? [];
  const layout = boardLayout(options.format, options.templateId, images.length, frame);

  const canvas = document.createElement('canvas');
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Browser ini tidak bisa menyusun foto');

  drawBoardBase(ctx, layout, options);

  const nativeFilter = ops.length > 0 && supportsCanvasFilter();

  layout.slots.forEach((slot, i) => {
    const img = images[i];
    if (!img) return;
    let picture: Drawable = img;

    // Without canvas filters the look is applied to the cropped photo's own pixels first,
    // so a tilted slot never re-filters a neighbour it overlaps.
    if (ops.length > 0 && !nativeFilter) {
      const crop = document.createElement('canvas');
      crop.width = Math.round(slot.w);
      crop.height = Math.round(slot.h);
      const cropCtx = crop.getContext('2d')!;
      drawCover(cropCtx, img, 0, 0, crop.width, crop.height);
      const pixels = cropCtx.getImageData(0, 0, crop.width, crop.height);
      applyOps(pixels.data, ops);
      cropCtx.putImageData(pixels, 0, 0);
      picture = crop;
    }

    enterSlot(ctx, slot);
    if (nativeFilter) ctx.filter = filterCss(options.filterId);
    drawCover(ctx, picture, 0, 0, slot.w, slot.h);
    ctx.restore();
  });

  if (overlay) ctx.drawImage(overlay, 0, 0, layout.width, layout.height);

  return canvas.toDataURL('image/jpeg', quality);
}

export interface LiveSlot {
  /** The shot's countdown clip; null when it never uploaded, and the still stands in. */
  clip: string | null;
  still: string;
}

/** Recorders differ: Safari writes MP4, Chrome MP4 or WebM. */
function liveMimeType(): string | null {
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
export async function composeLive(slots: LiveSlot[], options: StripOptions, scale = 2 / 3): Promise<Blob | null> {
  const mimeType = liveMimeType();
  if (!mimeType || !slots.some((s) => s.clip)) return null;

  const frame = frameOf(options);
  const layout = boardLayout(options.format, options.templateId, slots.length, frame);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(layout.width * scale);
  canvas.height = Math.round(layout.height * scale);
  if (typeof canvas.captureStream !== 'function') return null;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // The frame itself never changes, so it is drawn once and stamped under every video frame.
  const base = document.createElement('canvas');
  base.width = layout.width;
  base.height = layout.height;
  drawBoardBase(base.getContext('2d')!, layout, options);

  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;overflow:hidden;pointer-events:none;';
  document.body.appendChild(holder);

  try {
    const [media, overlay] = await Promise.all([
      Promise.all(
        slots.map((slot): Promise<Drawable> => (slot.clip ? loadClip(slot.clip, holder).catch(() => loadImage(slot.still)) : loadImage(slot.still))),
      ),
      frame ? loadImage(frame.src) : Promise.resolve(null),
    ]);
    const videos = media.filter((m): m is HTMLVideoElement => m instanceof HTMLVideoElement);
    if (videos.length === 0) return null;

    const filter = filterCss(options.filterId);
    const useFilter = filter !== 'none' && supportsCanvasFilter();
    const seconds = Math.max(...videos.map((v) => (Number.isFinite(v.duration) && v.duration > 0 ? v.duration : LIVE_FALLBACK_SECONDS)));

    videos.forEach((v) => (v.currentTime = 0));
    await Promise.all(videos.map((v) => v.play().catch(() => undefined)));

    const recorder = new MediaRecorder(canvas.captureStream(30), { mimeType, videoBitsPerSecond: 5_000_000 });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
    const stopped = new Promise<void>((resolve) => (recorder.onstop = () => resolve()));

    const draw = () => {
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.drawImage(base, 0, 0);
      layout.slots.forEach((slot, i) => {
        const src = media[i];
        if (!src) return;
        enterSlot(ctx, slot);
        if (useFilter) ctx.filter = filter;
        drawCover(ctx, src, 0, 0, slot.w, slot.h);
        ctx.restore();
      });
      if (overlay) ctx.drawImage(overlay, 0, 0, layout.width, layout.height);
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
    holder.remove();
  }
}
