import { MJPEG_BOUNDARY } from './types';

const SOI = Buffer.from([0xff, 0xd8]);
const EOI = Buffer.from([0xff, 0xd9]);

/**
 * `gphoto2 --capture-movie --stdout` emits JPEGs back to back with no framing, so we split
 * on the SOI/EOI markers and re-emit each frame with a multipart boundary the browser
 * understands in an <img> tag.
 */
export function createMjpegFramer() {
  let buffer: Buffer<ArrayBuffer> = Buffer.alloc(0);

  return {
    push(chunk: Buffer<ArrayBuffer>): Buffer[] {
      buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk;
      const parts: Buffer[] = [];

      for (;;) {
        const start = buffer.indexOf(SOI);
        if (start === -1) {
          // Nothing usable yet; avoid growing the buffer without bound on a garbage stream.
          if (buffer.length > 4 * 1024 * 1024) buffer = Buffer.alloc(0);
          break;
        }
        const end = buffer.indexOf(EOI, start + 2);
        if (end === -1) {
          if (start > 0) buffer = buffer.subarray(start);
          break;
        }

        const frame = buffer.subarray(start, end + 2);
        buffer = buffer.subarray(end + 2);
        parts.push(
          Buffer.concat([
            Buffer.from(`--${MJPEG_BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`),
            frame,
            Buffer.from('\r\n'),
          ]),
        );
      }

      return parts;
    },
  };
}
