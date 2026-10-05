import fs from 'node:fs/promises';
import path from 'node:path';
import { UPLOAD_DIR } from '@/lib/db';
import { guardRails } from './exposure';
import { FocusLockError, isFocusLocked, saveFocusLock } from './focusLock';
import { MJPEG_BOUNDARY } from './types';
import type { AutoSetupStep, CameraInfo, CameraSettings, CameraSource, CameraStatus, CaptureOptions, CaptureResult } from './types';

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
  /** A body as it often arrives: wrong dial, 16:9, RAW, sleeping after a minute. */
  private body = { mode: 'AV', aspect: '16:9', autoPowerOff: '60', imageFormat: 'RAW + Large Fine JPEG' };
  private readonly choices = {
    iso: ['Auto', '100', '200', '400', '800', '1600', '3200'],
    aperture: ['1.8', '2.8', '4', '5.6', '8'],
    shutterspeed: ['1/60', '1/125', '1/160', '1/250', '1/500'],
  };

  async info(): Promise<CameraInfo> {
    return {
      backend: this.backend,
      ready: true,
      model: 'Simulated body (no hardware)',
      port: 'sim:000',
      serverLiveView: true,
      message: 'Simulated capture pipeline — set CAMERA_SOURCE=gphoto2 with a camera attached for real frames.',
      settings: this.settings,
      choices: this.choices,
      hint: null,
      focusLocked: isFocusLocked(),
    };
  }

  async setFocusLock(locked: boolean): Promise<void> {
    saveFocusLock(locked);
  }

  async applySettings(patch: Partial<CameraSettings>): Promise<CameraSettings> {
    this.settings = { ...this.settings, ...patch };
    return this.settings;
  }

  async status(): Promise<CameraStatus> {
    return { model: 'Simulated camera', battery: '75%', ...this.body, ...this.settings };
  }

  /** Plays the real setup on the pretend body: everything but the dial can be set. */
  async autoSetup(): Promise<AutoSetupStep[]> {
    const before = { ...this.body, ...this.settings };
    this.body = { ...this.body, aspect: '3:2', autoPowerOff: '0', imageFormat: 'Medium Fine JPEG' };
    const rails = guardRails(this.settings, this.choices, this.body.mode);
    this.settings = { ...this.settings, ...rails };
    const step = (key: string, label: string, from: string | null, to: string | null): AutoSetupStep => ({
      key,
      label,
      before: from,
      after: to,
      result: from === to ? 'ok' : 'changed',
    });
    return [
      step('format', 'Format foto', before.imageFormat, this.body.imageFormat),
      step('drive', 'Mode drive', 'Single', 'Single'),
      step('focus', 'Mode fokus', 'One Shot', 'One Shot'),
      step('sleep', 'Mati otomatis', before.autoPowerOff, this.body.autoPowerOff),
      step('aspect', 'Rasio foto', before.aspect, this.body.aspect),
      { key: 'mode', label: 'Kenop mode', before: 'AV', after: 'AV', result: 'manual', note: 'Putar kenop mode kamera ke M, supaya terang foto sama untuk semua tamu.' },
      step('shutterspeed', 'Kecepatan rana', before.shutterspeed, this.settings.shutterspeed),
      step('aperture', 'Bukaan', before.aperture, this.settings.aperture),
    ];
  }

  async capture(sessionId: string, index: number, onFired?: () => void, options: CaptureOptions = {}): Promise<CaptureResult> {
    if (options.requireFocus && isFocusLocked()) throw new FocusLockError('Fokus sedang dikunci; uji autofokus dilewati.');
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
