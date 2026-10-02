import { NextResponse } from 'next/server';
import { readFrameFile } from '@/lib/frames';

export const dynamic = 'force-dynamic';

/** Guests' screens load the frame PNG from here. A frame's file never changes under its id. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const file = await readFrameFile(id);
  if (!file) return NextResponse.json({ error: 'frame not found' }, { status: 404 });
  return new NextResponse(new Uint8Array(file), {
    headers: {
      'Content-Type': 'image/png',
      'Content-Length': String(file.byteLength),
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
