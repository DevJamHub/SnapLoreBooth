import { NextResponse } from 'next/server';
import { camera } from '@/lib/camera';
import { MJPEG_BOUNDARY } from '@/lib/camera/types';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const source = camera();
  if (!source) return NextResponse.json({ error: 'this booth captures in the browser' }, { status: 409 });

  const stream = await source.liveView(request.signal);
  if (!stream) return NextResponse.json({ error: 'live view unavailable' }, { status: 503 });

  return new Response(stream, {
    headers: {
      'Content-Type': `multipart/x-mixed-replace; boundary=${MJPEG_BOUNDARY}`,
      'Cache-Control': 'no-store, no-transform',
      Connection: 'close',
    },
  });
}
