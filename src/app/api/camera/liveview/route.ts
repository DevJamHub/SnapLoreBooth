import { NextResponse } from 'next/server';
import { camera } from '@/lib/camera';
import { MJPEG_BOUNDARY } from '@/lib/camera/types';

export const dynamic = 'force-dynamic';

/**
 * Through a Cloudflare tunnel every frame leaves the building and comes back, on the venue's
 * upload: fewer frames keep it from piling up. On this machine or the LAN the body's full rate.
 */
const TUNNEL_FPS = 12;

export async function GET(request: Request) {
  const source = camera();
  if (!source) return NextResponse.json({ error: 'this booth captures in the browser' }, { status: 409 });

  const tunneled = request.headers.has('cf-ray') || request.headers.has('cf-connecting-ip');
  const stream = await source.liveView(request.signal, tunneled ? { fps: TUNNEL_FPS } : {});
  if (!stream) return NextResponse.json({ error: 'live view unavailable' }, { status: 503 });

  return new Response(stream, {
    headers: {
      'Content-Type': `multipart/x-mixed-replace; boundary=${MJPEG_BOUNDARY}`,
      'Cache-Control': 'no-store, no-transform',
      Connection: 'close',
    },
  });
}
