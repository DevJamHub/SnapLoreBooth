import fs from 'node:fs/promises';
import path from 'node:path';
import { db, FRAME_DIR } from './db';
import { PACKAGES } from './packages';
import { sheetSize } from './layout';
import type { CustomFrame, Session } from './types';

interface FrameRow {
  id: string;
  name: string;
  format: string;
  theme: string;
  hidden: number;
  file: string;
  slots: string;
  created_at: string;
}

const MAX_FRAME_BYTES = 10 * 1024 * 1024;
/** Half the sheet a frame is stored at (sheetSize): anything smaller prints blurry. */
const MIN_FRAME_SHARE = 0.5;
const MIN_HOLE = 40;
export const MAX_FRAME_NAME = 24;
export const MAX_THEME_NAME = 20;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export class FrameInputError extends Error {}

function hydrate(row: FrameRow | undefined): CustomFrame | null {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    format: row.format,
    theme: row.theme,
    hidden: row.hidden === 1,
    slots: JSON.parse(row.slots) as CustomFrame['slots'],
    src: `/api/frames/${row.id}`,
    created_at: row.created_at,
  };
}

/**
 * In upload order: guests see themes, and the frames in each, in the order the operator made
 * them (Bioskop's ticket, then its popcorn bill).
 */
export function listFrames(format?: string, { offered = false } = {}): CustomFrame[] {
  const rows = (
    format
      ? db.prepare('SELECT * FROM frames WHERE format = ? ORDER BY created_at ASC').all(format)
      : db.prepare('SELECT * FROM frames ORDER BY created_at ASC').all()
  ) as FrameRow[];
  const frames = rows.map((r) => hydrate(r)!);
  // Guests only see what the operator offers; the console sees everything.
  return offered ? frames.filter((f) => !f.hidden) : frames;
}

/** Every theme in use, in the order they first appeared. */
export function frameThemes(): string[] {
  return (db.prepare(`SELECT theme FROM frames WHERE theme != '' GROUP BY theme ORDER BY MIN(created_at) ASC`).all() as { theme: string }[]).map(
    (r) => r.theme,
  );
}

/** Spaces tidied, capped, and spelled like a theme already in use, so "bioskop" joins "Bioskop". */
function cleanTheme(raw: string): string {
  const theme = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_THEME_NAME);
  return frameThemes().find((t) => t.toLowerCase() === theme.toLowerCase()) ?? theme;
}

export function frameById(id: string): CustomFrame | null {
  return hydrate(db.prepare('SELECT * FROM frames WHERE id = ?').get(id) as FrameRow | undefined);
}

/** The uploaded frame a session was styled with, while it still exists and fits the package. */
export function frameForSession(session: Session): CustomFrame | null {
  const frame = frameById(session.template);
  return frame && frame.format === session.format ? frame : null;
}

/** Width and height from the IHDR chunk, which a PNG always opens with. */
function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24 || PNG_SIGNATURE.some((b, i) => bytes[i] !== b)) return null;
  if (String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR') return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** Holes are in the coordinates of the board the package is composed on (sheetSize). */
function validSlots(raw: unknown, shots: number, sheet: { width: number; height: number }): CustomFrame['slots'] {
  if (!Array.isArray(raw) || raw.length !== shots) {
    throw new FrameInputError(`frame untuk paket ini butuh ${shots} lubang foto`);
  }
  return raw.map((slot) => {
    const { x, y, w, h, angle } = (slot ?? {}) as Record<string, unknown>;
    const rect = { x: Number(x), y: Number(y), w: Number(w), h: Number(h), angle: Number(angle ?? 0) };
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    // A tilted hole's box can poke past the sheet edge, so only its centre must be on the sheet.
    const ok =
      Object.values(rect).every(Number.isFinite) &&
      rect.w >= MIN_HOLE &&
      rect.h >= MIN_HOLE &&
      rect.w <= sheet.height &&
      rect.h <= sheet.height &&
      cx >= 0 &&
      cx <= sheet.width &&
      cy >= 0 &&
      cy <= sheet.height &&
      Math.abs(rect.angle) <= 45;
    if (!ok) throw new FrameInputError('posisi lubang foto tidak valid');
    const tilt = Math.round(rect.angle * 10) / 10;
    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      w: Math.round(rect.w),
      h: Math.round(rect.h),
      ...(tilt ? { angle: tilt } : {}),
    };
  });
}

/**
 * Stores an uploaded frame. The holes are found in the operator's browser (it can decode the
 * PNG); the server checks the file really is a 4R portrait PNG and the holes fit the package.
 */
export async function saveFrame(input: { name: string; theme: string; format: string; slots: unknown; bytes: Uint8Array }): Promise<CustomFrame> {
  const name = input.name.trim().slice(0, MAX_FRAME_NAME);
  if (!name) throw new FrameInputError('nama frame wajib diisi');
  const theme = cleanTheme(input.theme);

  const pkg = PACKAGES.find((p) => p.format === input.format);
  if (!pkg) throw new FrameInputError('paket frame tidak dikenal');

  if (input.bytes.byteLength > MAX_FRAME_BYTES) throw new FrameInputError('file frame maksimal 10 MB');
  const size = pngSize(input.bytes);
  if (!size) throw new FrameInputError('file harus PNG');
  const sheet = sheetSize(pkg.format);
  if (size.width < sheet.width * MIN_FRAME_SHARE || Math.abs(size.width / size.height - sheet.width / sheet.height) > 0.02) {
    throw new FrameInputError(`ukuran harus ${sheet.width}×${sheet.height} px (atau rasio yang sama) — file ini ${size.width}×${size.height} px`);
  }

  const slots = validSlots(input.slots, pkg.shots, sheet);
  const suffix = Array.from(crypto.getRandomValues(new Uint8Array(3)), (b) => (b % 36).toString(36)).join('');
  // Upper case keeps frame ids apart from the built-in frames' lower-case ids.
  const id = `FR${Date.now().toString(36)}${suffix}`.toUpperCase();
  const file = `${id}.png`;

  await fs.writeFile(path.join(FRAME_DIR, file), input.bytes);
  db.prepare('INSERT INTO frames (id, name, format, theme, file, slots, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    id,
    name,
    pkg.format,
    theme,
    file,
    JSON.stringify(slots),
    new Date().toISOString(),
  );
  return frameById(id)!;
}

/** Renames a frame, moves it to another theme, or hides it from guests; the picture and its holes stay. */
export function updateFrame(id: string, input: { name?: unknown; theme?: unknown; hidden?: unknown }): CustomFrame | null {
  const frame = frameById(id);
  if (!frame) return null;
  const name = input.name === undefined ? frame.name : String(input.name).trim().slice(0, MAX_FRAME_NAME);
  if (!name) throw new FrameInputError('nama frame wajib diisi');
  const theme = input.theme === undefined ? frame.theme : cleanTheme(String(input.theme));
  if (input.hidden !== undefined && typeof input.hidden !== 'boolean') throw new FrameInputError('hidden harus true/false');
  const hidden = input.hidden === undefined ? frame.hidden : input.hidden;
  db.prepare('UPDATE frames SET name = ?, theme = ?, hidden = ? WHERE id = ?').run(name, theme, hidden ? 1 : 0, id);
  return frameById(id);
}

/** Finished sheets keep their frame: it is already printed into them. */
export async function deleteFrame(id: string): Promise<boolean> {
  const row = db.prepare('SELECT * FROM frames WHERE id = ?').get(id) as FrameRow | undefined;
  if (!row) return false;
  db.prepare('DELETE FROM frames WHERE id = ?').run(id);
  await fs.rm(path.join(FRAME_DIR, path.basename(row.file)), { force: true });
  return true;
}

export async function readFrameFile(id: string): Promise<Buffer | null> {
  const row = db.prepare('SELECT file FROM frames WHERE id = ?').get(id) as { file: string } | undefined;
  if (!row) return null;
  try {
    return await fs.readFile(path.join(FRAME_DIR, path.basename(row.file)));
  } catch {
    return null;
  }
}
