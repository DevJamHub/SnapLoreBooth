import fs from 'node:fs/promises';
import path from 'node:path';
import { UPLOAD_DIR } from './db';

const DATA_URL = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/;
const MAX_BYTES = 12 * 1024 * 1024;

export class InvalidImageError extends Error {}

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
  return relative;
}

export async function readUpload(relative: string): Promise<{ body: Buffer; contentType: string }> {
  const target = path.join(UPLOAD_DIR, relative);
  // Reject anything that escaped the upload root via traversal in the URL.
  if (!target.startsWith(UPLOAD_DIR + path.sep)) throw new InvalidImageError('path outside upload root');
  const body = await fs.readFile(target);
  const ext = path.extname(target).slice(1);
  return { body, contentType: ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg' };
}

function safeSegment(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!cleaned) throw new InvalidImageError('invalid path segment');
  return cleaned;
}
