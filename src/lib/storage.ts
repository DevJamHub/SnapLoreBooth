import fs from 'node:fs/promises';
import path from 'node:path';
import { cloudEnabled, putObject, signedGetUrl } from './cloud';
import { UPLOAD_DIR } from './db';

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
  await mirrorFile(relative, bytes);
  return relative;
}

export { MAX_VIDEO_BYTES };

/** Storage keys always use forward slashes, whatever the host OS. */
function keyFor(relative: string): string {
  return relative.split(path.sep).join('/');
}

/**
 * Copies a stored photo to R2 when it is configured. A failed copy is logged, never thrown:
 * a guest mid-session must not lose their shot because the internet blinked.
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
  await mirrorFile(relative, new Uint8Array(buffer));
  return relative;
}

export type Upload = { kind: 'local'; body: Buffer; contentType: string } | { kind: 'redirect'; url: string };

/** Serves from the local disk, falling back to a signed R2 link for photos only the cloud still has. */
export async function readUpload(relative: string): Promise<Upload> {
  const target = path.join(UPLOAD_DIR, relative);
  // Reject anything that escaped the upload root via traversal in the URL.
  if (!target.startsWith(UPLOAD_DIR + path.sep)) throw new InvalidImageError('path outside upload root');
  try {
    return { kind: 'local', body: await fs.readFile(target), contentType: contentTypeFor(target) };
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
