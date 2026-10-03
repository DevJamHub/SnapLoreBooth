'use client';

import { useEffect, useRef, type RefObject } from 'react';

const RETRY_MS = 1000;
/** Frames come at most this fast from the server; the clip recorder samples the canvas at it. */
export const TETHERED_FPS = 24;

const encoder = new TextEncoder();
const HEADER_END = encoder.encode('\r\n\r\n');

function indexOf(haystack: Uint8Array, needle: Uint8Array, from = 0): number {
  outer: for (let i = from; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

/** Splits the server's multipart live view (see lib/camera/mjpeg.ts) into JPEG frames. */
async function* jpegParts(body: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = body.getReader();
  let buffer = new Uint8Array(0);
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      const merged = new Uint8Array(buffer.length + value.length);
      merged.set(buffer);
      merged.set(value, buffer.length);
      buffer = merged;

      for (;;) {
        const headerEnd = indexOf(buffer, HEADER_END);
        if (headerEnd === -1) break;
        const header = new TextDecoder().decode(buffer.subarray(0, headerEnd));
        const length = Number(/content-length:\s*(\d+)/i.exec(header)?.[1]);
        if (!Number.isFinite(length)) {
          buffer = buffer.subarray(headerEnd + HEADER_END.length);
          continue;
        }
        const start = headerEnd + HEADER_END.length;
        if (buffer.length < start + length) break;
        yield buffer.slice(start, start + length);
        buffer = buffer.subarray(start + length);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function decode(jpeg: Uint8Array): Promise<ImageBitmap | HTMLImageElement> {
  const blob = new Blob([jpeg as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' });
  if (typeof createImageBitmap === 'function') return createImageBitmap(blob);
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Plays a tethered camera's live view into a canvas, reconnecting if the stream drops (the
 * body pauses it for every still). The canvas is both the guest's viewfinder and what the
 * live clip records, so a Canon gets the same few-second videos as a webcam.
 */
export function useTetheredFeed(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  enabled: boolean,
  /** Width over height of the stills; live view is cut to it, as the body cuts its stills. */
  stillAspect: number | null = null,
) {
  const aspectRef = useRef(stillAspect);
  aspectRef.current = stillAspect;

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let stopped = false;

    const draw = (frame: ImageBitmap | HTMLImageElement) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;
      const width = frame instanceof HTMLImageElement ? frame.naturalWidth : frame.width;
      const height = frame instanceof HTMLImageElement ? frame.naturalHeight : frame.height;
      // Live view shows the whole sensor; a body shooting 16:9 keeps only the middle of it, so
      // the frame is cut the same way. Past that it stays whole, like a webcam's: the sheet
      // crops each photo and clip to its slot.
      const aspect = aspectRef.current;
      let w = width;
      let h = height;
      if (aspect && Math.abs(width / height - aspect) > 0.01) {
        if (width / height > aspect) w = Math.round(height * aspect);
        else h = Math.round(width / aspect);
      }
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.drawImage(frame, (width - w) / 2, (height - h) / 2, w, h, 0, 0, w, h);
    };

    void (async () => {
      while (!stopped) {
        try {
          const res = await fetch('/api/camera/liveview', { signal: controller.signal, cache: 'no-store' });
          if (!res.ok || !res.body) throw new Error('no live view');
          for await (const jpeg of jpegParts(res.body)) {
            if (stopped) break;
            const frame = await decode(jpeg);
            draw(frame);
            if ('close' in frame) frame.close();
          }
        } catch {
          // Dropped or refused: try again shortly, unless the screen is gone.
        }
        if (!stopped) await new Promise((r) => setTimeout(r, RETRY_MS));
      }
    })();

    return () => {
      stopped = true;
      controller.abort();
    };
  }, [canvasRef, enabled]);
}
