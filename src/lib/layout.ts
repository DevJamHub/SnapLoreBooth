import { STRIP_FORMATS, TEMPLATES } from './packages';
import type { CustomFrame } from './types';

/**
 * Where the photos sit on each board. Kept apart from the drawing in strip.ts so the server can
 * check a sheet's coordinates without loading anything that draws.
 */

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
/** Half a 4R sheet: the retired strips, printed two-up. */
const STRIP = { width: 600, height: 1800 };

/** The board a format is composed on, and an uploaded frame for it is stored at. */
export function sheetSize(format: string): { width: number; height: number } {
  return STRIP_FORMATS.includes(format) ? STRIP : SHEET;
}

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
  if (frame && frame.id === templateId && frame.format === format) return { ...sheetSize(format), slots: frame.slots, footer: null };

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
    // Boards from packages no longer offered, kept so their sessions still render.
    case 'strip4':
      return grid(1, 4, Math.round(36 * template.border), 18, footer ? 170 : 0, STRIP);
    case '2x6':
      return grid(1, shots, Math.round(36 * template.border), 18, footer ? 170 : 0, STRIP);
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
