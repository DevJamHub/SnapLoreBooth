import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { NextResponse } from 'next/server';
import { InvalidImageError, readUpload } from '@/lib/storage';

export const dynamic = 'force-dynamic';

/** Bytes `start` to `end` (inclusive) of a file, read from disk as they are sent. */
function fileStream(file: string, start: number, end: number): ReadableStream<Uint8Array> {
  return Readable.toWeb(createReadStream(file, { start, end })) as unknown as ReadableStream<Uint8Array>;
}

/**
 * Serves stored photos and clips. Byte ranges are honoured because Safari will not play a
 * <video> from a server that ignores them; it asks for a clip in many small ranges, so only
 * the bytes asked for are read.
 */
export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  try {
    const upload = await readUpload(path.join('/'));
    if (upload.kind === 'redirect') return NextResponse.redirect(upload.url, 302);

    const { file, size } = upload;
    const headers = {
      'Content-Type': upload.contentType,
      'Cache-Control': 'private, max-age=3600',
      'Accept-Ranges': 'bytes',
    };

    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '');
    if (range && (range[1] || range[2])) {
      // "bytes=-500" asks for the last 500 bytes; "bytes=100-" for everything from 100.
      const start = range[1] ? Number(range[1]) : Math.max(size - Number(range[2]), 0);
      const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (start >= size || start > end) {
        return new NextResponse(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } });
      }
      return new NextResponse(fileStream(file, start, end), {
        status: 206,
        headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) },
      });
    }

    if (size === 0) return new NextResponse(null, { headers: { ...headers, 'Content-Length': '0' } });
    return new NextResponse(fileStream(file, 0, size - 1), { headers: { ...headers, 'Content-Length': String(size) } });
  } catch (error) {
    if (error instanceof InvalidImageError) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
}
