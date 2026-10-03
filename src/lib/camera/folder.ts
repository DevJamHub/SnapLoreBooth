import fs from 'node:fs/promises';
import path from 'node:path';
import { UPLOAD_DIR } from '@/lib/db';
import type { CameraInfo, CameraSettings, CameraSource, CaptureResult } from './types';

const WATCH_DIR = process.env.CAMERA_WATCH_DIR ?? path.join(process.cwd(), 'data', 'tether-inbox');
const TIMEOUT_MS = Number(process.env.CAMERA_WATCH_TIMEOUT_MS ?? 20_000);
const SETTLE_MS = 400;
const IMAGE = /\.(jpe?g|png)$/i;

interface Seen {
  name: string;
  mtimeMs: number;
}

/**
 * Consumes stills dropped into a folder by whatever already owns the camera — Canon's EOS
 * Utility, Smart Shooter, Lightroom tethering. This sidesteps PTP entirely, which matters
 * on macOS where the system refuses to release the camera to gphoto2.
 *
 * The shutter is fired by the photographer or by the tethering app; this backend waits for
 * the resulting file to land.
 */
export class FolderCamera implements CameraSource {
  readonly backend = 'folder' as const;

  private async listImages(): Promise<Seen[]> {
    const entries = await fs.readdir(WATCH_DIR, { withFileTypes: true });
    const files = entries.filter((e) => e.isFile() && IMAGE.test(e.name));
    return Promise.all(
      files.map(async (e) => ({
        name: e.name,
        mtimeMs: (await fs.stat(path.join(WATCH_DIR, e.name))).mtimeMs,
      })),
    );
  }

  async info(): Promise<CameraInfo> {
    try {
      await fs.mkdir(WATCH_DIR, { recursive: true });
      const images = await this.listImages();
      return {
        backend: this.backend,
        ready: true,
        model: `Watch folder (${images.length} file${images.length === 1 ? '' : 's'} waiting)`,
        port: WATCH_DIR,
        serverLiveView: false,
        message:
          'Point your tethering app (EOS Utility, Smart Shooter, Lightroom) at this folder. Live view comes from the tablet camera or a capture device, not from here.',
        settings: null,
        choices: null,
        hint: null,
      };
    } catch (error) {
      return {
        backend: this.backend,
        ready: false,
        model: null,
        port: WATCH_DIR,
        serverLiveView: false,
        message: error instanceof Error ? error.message : 'watch folder unavailable',
        settings: null,
        choices: null,
        hint: null,
      };
    }
  }

  async applySettings(): Promise<CameraSettings> {
    // Exposure belongs to whichever app owns the camera; this backend only reads files.
    return { iso: null, aperture: null, shutterspeed: null };
  }

  /** Waits for a file newer than everything already present, then moves it into the session. */
  async capture(sessionId: string, index: number, onFired?: () => void): Promise<CaptureResult> {
    await fs.mkdir(WATCH_DIR, { recursive: true });
    const before = new Map((await this.listImages()).map((f) => [f.name, f.mtimeMs]));
    const deadline = Date.now() + TIMEOUT_MS;

    for (;;) {
      const current = await this.listImages();
      const fresh = current
        .filter((f) => !before.has(f.name) || before.get(f.name) !== f.mtimeMs)
        .sort((a, b) => b.mtimeMs - a.mtimeMs);

      if (fresh.length > 0) {
        if (onFired) {
          // A new file means the other app's shutter has fired.
          onFired();
          onFired = undefined;
        }
        const source = path.join(WATCH_DIR, fresh[0].name);
        // A camera writing a 6MB JPEG over USB appears in the directory before it is
        // complete, so wait for the size to stop changing before touching it.
        if (await settled(source)) {
          const relative = path.join(sessionId, `shot-${index}${path.extname(source).toLowerCase()}`);
          const target = path.join(UPLOAD_DIR, relative);
          await fs.mkdir(path.dirname(target), { recursive: true });
          await fs.copyFile(source, target);
          await fs.rm(source, { force: true });
          const stat = await fs.stat(target);
          return { file: relative, bytes: stat.size };
        }
      }

      if (Date.now() > deadline) {
        throw new Error(
          `No new photo appeared in ${WATCH_DIR} within ${Math.round(TIMEOUT_MS / 1000)}s. Check that the tethering app is downloading to that folder.`,
        );
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  async liveView(): Promise<null> {
    return null;
  }
}

async function settled(file: string): Promise<boolean> {
  const first = await fs.stat(file).catch(() => null);
  if (!first) return false;
  await new Promise((r) => setTimeout(r, SETTLE_MS));
  const second = await fs.stat(file).catch(() => null);
  return second !== null && second.size === first.size && second.size > 0;
}

export { WATCH_DIR };
