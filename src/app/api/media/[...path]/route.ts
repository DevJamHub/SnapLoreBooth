import { NextResponse } from 'next/server';
import { InvalidImageError, readUpload } from '@/lib/storage';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  try {
    const { body, contentType } = await readUpload(path.join('/'));
    return new NextResponse(new Uint8Array(body), {
      headers: { 'Content-Type': contentType, 'Cache-Control': 'private, max-age=3600' },
    });
  } catch (error) {
    if (error instanceof InvalidImageError) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
}
