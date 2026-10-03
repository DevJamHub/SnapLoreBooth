import { camera } from '@/lib/camera';

export const dynamic = 'force-dynamic';

const DIAGNOSTIC_FOLDER = 'diagnostics';

/**
 * Fires one frame with no guest session attached, so an operator can prove the tether and
 * measure the camera before doors open. Operator-only: it moves real hardware.
 *
 * Replies with the same event stream as a guest capture: `fired` with the milliseconds from
 * the request to the shutter, then `done` (or `error`). `?focus=1` is the calibration's focus
 * test: it fires only if autofocus locks.
 */
export async function POST(request: Request) {
  const source = camera();
  if (!source) {
    return Response.json({ error: 'this booth captures in the browser' }, { status: 409 });
  }
  const requireFocus = new URL(request.url).searchParams.get('focus') === '1';

  const encoder = new TextEncoder();
  const started = Date.now();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ ...event, ms: Date.now() - started })}\n\n`));
        } catch {
          // The console went away.
        }
      };
      try {
        const result = await source.capture(DIAGNOSTIC_FOLDER, requireFocus ? 2 : 1, () => send({ type: 'fired' }), { requireFocus });
        send({ type: 'done', file: result.file, bytes: result.bytes });
      } catch (error) {
        send({ type: 'error', error: error instanceof Error ? error.message.split('\n')[0] : 'capture failed' });
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
