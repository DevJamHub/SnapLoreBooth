import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { cloudEnabled, deleteObject, putObject, signedGetUrl } from './cloud';
import { UPLOAD_DIR } from './db';

const run = promisify(execFile);
/** macOS's own image tool: shrinks camera photos without adding an image library. */
const SIPS = '/usr/bin/sips';

const DATA_URL = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/;
const MAX_BYTES = 12 * 1024 * 1024;

export class InvalidImageError extends Error {}

const CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  webp: 'image/webp',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  mp4: 'video/mp4',
  webm: 'video/webm',
};

export function contentTypeFor(file: string): string {
  return CONTENT_TYPES[path.extname(file).slice(1)] ?? 'application/octet-stream';
}

/** Recorders differ: Safari writes MP4, older Chrome writes WebM. */
export const VIDEO_TYPES: Record<string, string> = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mp4' };
const MAX_VIDEO_BYTES = 15 * 1024 * 1024;

/** Stores a short countdown clip as uploaded, under data/uploads/<sessionId>/. */
export async function saveVideo(sessionId: string, filename: string, contentType: string, bytes: Uint8Array): Promise<string> {
  const ext = VIDEO_TYPES[contentType.split(';')[0].trim().toLowerCase()];
  if (!ext) throw new InvalidImageError('expected an mp4 or webm video');
  if (bytes.byteLength === 0) throw new InvalidImageError('empty video');
  if (bytes.byteLength > MAX_VIDEO_BYTES) throw new InvalidImageError('video exceeds 15MB');

  const relative = path.join(safeSegment(sessionId), `${safeSegment(filename)}.${ext}`);
  const target = path.join(UPLOAD_DIR, relative);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, bytes);
  void mirrorFile(relative, bytes);
  return relative;
}

export { MAX_VIDEO_BYTES };

/** Storage keys always use forward slashes, whatever the host OS. */
function keyFor(relative: string): string {
  return relative.split(path.sep).join('/');
}

/**
 * Copies a stored photo to R2 when it is configured. A failed copy is logged, never thrown:
 * a guest mid-session must not lose their shot because the internet blinked. Guest paths do
 * not wait for it either: the file is safe on disk, and a venue's upload is no reason for the
 * next countdown to wait.
 */
export async function mirrorFile(relative: string, body?: Uint8Array): Promise<void> {
  if (!cloudEnabled()) return;
  try {
    const bytes = body ?? new Uint8Array(await fs.readFile(path.join(UPLOAD_DIR, relative)));
    await putObject(keyFor(relative), bytes, contentTypeFor(relative));
  } catch (error) {
    console.error('[storage] R2 copy failed, keeping the local file only:', error instanceof Error ? error.message : error);
  }
}

/** Decodes a browser canvas data URL and writes it under data/uploads/<sessionId>/. */
export async function saveDataUrl(sessionId: string, filename: string, dataUrl: string): Promise<string> {
  const match = DATA_URL.exec(dataUrl);
  if (!match) throw new InvalidImageError('expected a base64 png/jpeg/webp data URL');

  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.byteLength > MAX_BYTES) throw new InvalidImageError('image exceeds 12MB');

  const ext = match[1] === 'jpg' ? 'jpeg' : match[1];
  const relative = path.join(safeSegment(sessionId), `${safeSegment(filename)}.${ext}`);
  const target = path.join(UPLOAD_DIR, relative);

  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, buffer);
  void mirrorFile(relative, new Uint8Array(buffer));
  return relative;
}

/** Whether camera photos can be made smaller on this server (macOS has sips; Linux keeps them as shot). */
export function canOptimizeStills(): boolean {
  return existsSync(SIPS);
}

async function pixelSize(file: string): Promise<{ width: number; height: number } | null> {
  try {
    const { stdout } = await run(SIPS, ['-g', 'pixelWidth', '-g', 'pixelHeight', file], { timeout: 10_000 });
    const width = Number(/pixelWidth: (\d+)/.exec(stdout)?.[1]);
    const height = Number(/pixelHeight: (\d+)/.exec(stdout)?.[1]);
    return width && height ? { width, height } : null;
  } catch {
    return null;
  }
}

/**
 * Shrinks a stored JPEG in place to `maxEdge` on its long side at `quality`. A camera's full
 * 24-megapixel file is several MB; the sheet prints each photo at about a megapixel and phones
 * show less, so 2400 px keeps every use sharp at a fraction of the size. Leaves the file alone
 * when it is already small enough, when `maxEdge` is 0 (keep as shot), or without sips.
 * Returns the bytes saved.
 */
export async function optimizeStill(relative: string, maxEdge: number, quality: number): Promise<number> {
  if (!maxEdge || !canOptimizeStills() || !/\.jpe?g$/i.test(relative)) return 0;
  const target = path.join(UPLOAD_DIR, relative);
  if (!target.startsWith(UPLOAD_DIR + path.sep)) return 0;
  const size = await pixelSize(target);
  if (!size || Math.max(size.width, size.height) <= maxEdge) return 0;

  const before = (await fs.stat(target)).size;
  const temp = `${target}.small.jpeg`;
  try {
    await run(SIPS, ['-Z', String(maxEdge), '-s', 'format', 'jpeg', '-s', 'formatOptions', String(quality), target, '--out', temp], {
      timeout: 30_000,
    });
    const after = (await fs.stat(temp)).size;
    if (after >= before) {
      await fs.rm(temp, { force: true });
      return 0;
    }
    await fs.rename(temp, target);
    return before - after;
  } catch (error) {
    await fs.rm(temp, { force: true });
    console.error('[storage] could not shrink', relative, error instanceof Error ? error.message : error);
    return 0;
  }
}

/** Bytes of every file under `dir`; 0 when it does not exist. */
export async function folderSize(dir: string): Promise<number> {
  const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true }).catch(() => []);
  const sizes = await Promise.all(
    entries.filter((e) => e.isFile()).map((e) => fs.stat(path.join(e.parentPath, e.name)).then((s) => s.size, () => 0)),
  );
  return sizes.reduce((a, b) => a + b, 0);
}

/** Deletes one stored file here and in R2. False when the R2 copy could not be deleted. */
export async function removeStored(relative: string): Promise<boolean> {
  const target = path.join(UPLOAD_DIR, relative);
  if (!target.startsWith(UPLOAD_DIR + path.sep)) return false;
  await fs.rm(target, { force: true });
  try {
    await deleteObject(keyFor(relative));
    return true;
  } catch (error) {
    console.error('[storage] R2 delete failed for', relative, error instanceof Error ? error.message : error);
    return false;
  }
}

export type Upload = { kind: 'local'; file: string; size: number; contentType: string } | { kind: 'redirect'; url: string };

/**
 * Finds a stored file on the local disk (the caller streams it, so a video is never held in
 * memory whole), falling back to a signed R2 link for photos only the cloud still has.
 */
export async function readUpload(relative: string): Promise<Upload> {
  const target = path.join(UPLOAD_DIR, relative);
  // Reject anything that escaped the upload root via traversal in the URL.
  if (!target.startsWith(UPLOAD_DIR + path.sep)) throw new InvalidImageError('path outside upload root');
  try {
    const stat = await fs.stat(target);
    if (!stat.isFile()) throw new Error('not a file');
    return { kind: 'local', file: target, size: stat.size, contentType: contentTypeFor(target) };
  } catch (error) {
    const url = (error as NodeJS.ErrnoException).code === 'ENOENT' ? await signedGetUrl(keyFor(relative)) : null;
    if (url) return { kind: 'redirect', url };
    throw error;
  }
}

function safeSegment(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!cleaned) throw new InvalidImageError('invalid path segment');
  return cleaned;
}
