import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/** MediaPipe's runtime, served from the installed package so the booth needs no CDN (lib/segment.ts). */
const FILES = new Set([
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_nosimd_internal.js',
  'vision_wasm_nosimd_internal.wasm',
  'vision_wasm_module_internal.js',
  'vision_wasm_module_internal.wasm',
]);
const DIR = path.join(process.cwd(), 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  if (!FILES.has(file)) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const target = path.join(DIR, file);
  const info = await stat(target).catch(() => null);
  if (!info) return NextResponse.json({ error: 'MediaPipe is not installed' }, { status: 404 });
  return new NextResponse(Readable.toWeb(createReadStream(target)) as unknown as ReadableStream<Uint8Array>, {
    headers: {
      'Content-Type': file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript; charset=utf-8',
      'Content-Length': String(info.size),
      // The version is pinned in package.json; a new one comes with a new deploy.
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
