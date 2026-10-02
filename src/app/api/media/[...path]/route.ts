import { NextResponse } from 'next/server';
import { InvalidImageError, readUpload } from '@/lib/storage';

export const dynamic = 'force-dynamic';

/**
 * Serves stored photos and clips. Byte ranges are honoured because Safari will not play a
 * <video> from a server that ignores them.
 */
export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  try {
    const upload = await readUpload(path.join('/'));
    if (upload.kind === 'redirect') return NextResponse.redirect(upload.url, 302);

    const size = upload.body.byteLength;
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
      return new NextResponse(new Uint8Array(upload.body.subarray(start, end + 1)), {
        status: 206,
        headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) },
      });
    }

    return new NextResponse(new Uint8Array(upload.body), { headers: { ...headers, 'Content-Length': String(size) } });
  } catch (error) {
    if (error instanceof InvalidImageError) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
}
