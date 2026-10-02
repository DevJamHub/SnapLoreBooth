import { FILTERS, TEMPLATES, filterCss, type FilterOp } from './packages';

export interface StripOptions {
  format: string;
  filterId: string;
  templateId: string;
  eventName: string;
  capturedAt: Date;
}

interface Layout {
  width: number;
  height: number;
  margin: number;
  gap: number;
  footer: number;
}

/** Print sizes at 300dpi: 2x6in strip, 4x6in postcard, 4x4in square. */
function layoutFor(format: string, border: number): Layout {
  const base =
    format === '2x6'
      ? { width: 600, height: 1800, margin: 36, gap: 18, footer: 170 }
      : format === '4x6'
        ? { width: 1200, height: 1800, margin: 56, gap: 24, footer: 210 }
        : { width: 1200, height: 1200, margin: 56, gap: 0, footer: 170 };
  return { ...base, margin: Math.round(base.margin * border) };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Foto tidak bisa dimuat'));
    img.src = src;
  });
}

/** Draws src into the box as a centre-cropped "cover" fit. */
function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const scale = Math.max(w / img.width, h / img.height);
  const sw = w / scale;
  const sh = h / scale;
  ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
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

/** Composes the captured frames into one printable board and returns a JPEG data URL. */
export async function composeStrip(sources: string[], options: StripOptions): Promise<string> {
  const images = await Promise.all(sources.map(loadImage));
  const template = TEMPLATES.find((t) => t.id === options.templateId) ?? TEMPLATES[0];
  const ops = FILTERS.find((f) => f.id === options.filterId)?.ops ?? [];
  const layout = layoutFor(options.format, template.border);
  const hasFooter = template.eventMark || template.date;
  const footer = hasFooter ? layout.footer : 0;

  const canvas = document.createElement('canvas');
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Browser ini tidak bisa menyusun foto');

  ctx.fillStyle = template.board;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const usableHeight = layout.height - layout.margin * 2 - footer;
  const cellHeight = (usableHeight - layout.gap * (images.length - 1)) / images.length;
  const cellWidth = layout.width - layout.margin * 2;
  const nativeFilter = ops.length > 0 && supportsCanvasFilter();

  images.forEach((img, i) => {
    const x = layout.margin;
    const y = Math.round(layout.margin + i * (cellHeight + layout.gap));
    const h = Math.round(cellHeight);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, cellWidth, h);
    ctx.clip();
    if (nativeFilter) ctx.filter = filterCss(options.filterId);
    drawCover(ctx, img, x, y, cellWidth, h);
    ctx.restore();

    if (ops.length > 0 && !nativeFilter) {
      const pixels = ctx.getImageData(x, y, cellWidth, h);
      applyOps(pixels.data, ops);
      ctx.putImageData(pixels, x, y);
    }
  });

  if (hasFooter) {
    const footerTop = layout.height - layout.margin - footer;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'center';
    const centre = layout.width / 2;
    let cursor = footerTop + footer * 0.22;

    if (template.eventMark) {
      ctx.fillStyle = template.ink;
      ctx.font = `500 ${Math.round(layout.width * 0.06)}px Georgia, serif`;
      ctx.fillText(options.eventName.slice(0, 32), centre, cursor, cellWidth);
      cursor += Math.round(layout.width * 0.085);
    }

    if (template.date) {
      ctx.fillStyle = template.muted;
      ctx.font = `400 ${Math.round(layout.width * 0.028)}px ui-monospace, monospace`;
      const stamp = options.capturedAt.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
      ctx.fillText(stamp.toUpperCase(), centre, cursor, cellWidth);
    }
  }

  return canvas.toDataURL('image/jpeg', 0.92);
}
