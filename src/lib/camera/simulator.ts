import fs from 'node:fs/promises';
import path from 'node:path';
import { UPLOAD_DIR } from '@/lib/db';
import { MJPEG_BOUNDARY } from './types';
import type { CameraInfo, CameraSettings, CameraSource, CameraStatus, CaptureResult } from './types';

/** A 16x16 grey baseline JPEG — enough to prove the transport, not to look at. */
const FRAME = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAAQABABAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64',
);

/** Pretend shutter lag, to rehearse the countdown's timing as a real body would play it. */
const SHUTTER_MS = Number(process.env.SIMULATOR_SHUTTER_MS ?? 0);
const DOWNLOAD_MS = SHUTTER_MS > 0 ? 400 : 0;

/**
 * Stands in for a tethered body so the capture pipeline can be exercised without hardware.
 * It proves the plumbing — routing, locking, file writes — never the optics.
 */
export class SimulatorCamera implements CameraSource {
  readonly backend = 'simulator' as const;
  private settings: CameraSettings = { iso: '400', aperture: '2.8', shutterspeed: '1/160' };

  async info(): Promise<CameraInfo> {
    return {
      backend: this.backend,
      ready: true,
      model: 'Simulated body (no hardware)',
      port: 'sim:000',
      serverLiveView: true,
      message: 'Simulated capture pipeline — set CAMERA_SOURCE=gphoto2 with a camera attached for real frames.',
      settings: this.settings,
      choices: {
        iso: ['100', '200', '400', '800', '1600', '3200'],
        aperture: ['1.8', '2.8', '4', '5.6', '8'],
        shutterspeed: ['1/60', '1/125', '1/160', '1/250', '1/500'],
      },
      hint: null,
    };
  }

  async applySettings(patch: Partial<CameraSettings>): Promise<CameraSettings> {
    this.settings = { ...this.settings, ...patch };
    return this.settings;
  }

  /** A body as it often arrives: wrong dial, 16:9, sleeping after a minute. */
  async status(): Promise<CameraStatus> {
    return {
      model: 'Simulated camera',
      battery: '75%',
      mode: 'AV',
      aspect: '16:9',
      autoPowerOff: '60',
      imageFormat: 'M',
      ...this.settings,
    };
  }

  async capture(sessionId: string, index: number, onFired?: () => void): Promise<CaptureResult> {
    if (SHUTTER_MS > 0) await new Promise((r) => setTimeout(r, SHUTTER_MS));
    onFired?.();
    if (DOWNLOAD_MS > 0) await new Promise((r) => setTimeout(r, DOWNLOAD_MS));
    const relative = path.join(sessionId, `shot-${index}.jpeg`);
    const target = path.join(UPLOAD_DIR, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, FRAME);
    return { file: relative, bytes: FRAME.length };
  }

  async liveView(signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
    return new ReadableStream<Uint8Array>({
      start: (controller) => {
        const timer = setInterval(() => {
          const part = Buffer.concat([
            Buffer.from(`--${MJPEG_BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${FRAME.length}\r\n\r\n`),
            FRAME,
            Buffer.from('\r\n'),
          ]);
          try {
            controller.enqueue(new Uint8Array(part));
          } catch {
            clearInterval(timer);
          }
        }, 100);

        signal.addEventListener(
          'abort',
          () => {
            clearInterval(timer);
            try {
              controller.close();
            } catch {
              // Already closed.
            }
          },
          { once: true },
        );
      },
    });
  }
}
