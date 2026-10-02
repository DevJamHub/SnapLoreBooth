import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { UPLOAD_DIR } from '@/lib/db';
import { createMjpegFramer } from './mjpeg';
import type { CameraChoices, CameraInfo, CameraSettings, CameraSource, CaptureResult } from './types';

const run = promisify(execFile);
const BIN = process.env.GPHOTO2_BIN ?? 'gphoto2';

/**
 * Only one process may hold the camera over PTP at a time, so live view has to be torn
 * down before a still capture and brought back afterwards. Every camera operation is
 * serialised through this queue.
 */
class CameraLock {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.tail.then(task, task);
    this.tail = next.catch(() => undefined);
    return next;
  }
}

export class Gphoto2Camera implements CameraSource {
  readonly backend = 'gphoto2' as const;
  private lock = new CameraLock();
  private liveProcess: ReturnType<typeof spawn> | null = null;

  private async gphoto(args: string[], timeout = 20_000): Promise<string> {
    const { stdout } = await run(BIN, args, { timeout, maxBuffer: 8 * 1024 * 1024 });
    return stdout;
  }

  async info(): Promise<CameraInfo> {
    try {
      const stdout = await this.gphoto(['--auto-detect'], 8000);
      // Rows look like: "Canon EOS M50    usb:020,011"
      const line = stdout
        .split('\n')
        .slice(2)
        .map((l) => l.trim())
        .find((l) => l.length > 0 && /usb:/.test(l));

      if (!line) {
        return {
          backend: this.backend,
          ready: false,
          model: null,
          port: null,
          serverLiveView: true,
          message: 'No camera detected. Check the USB cable and that the camera is powered on.',
          settings: null,
          choices: null,
          hint: await macosClaimHint(),
        };
      }

      const port = line.slice(line.search(/usb:/)).trim();
      const model = line.slice(0, line.search(/usb:/)).trim();
      // Enumeration is not readiness: on macOS the device shows up in --auto-detect while
      // ptpcamerad still owns interface 0, and every capture then fails. Probe by actually
      // claiming it.
      try {
        await this.gphoto(['--summary'], 12_000);
      } catch (error) {
        return {
          backend: this.backend,
          ready: false,
          model,
          port,
          serverLiveView: true,
          message: describe(error),
          settings: null,
          choices: null,
          hint: await macosClaimHint(),
        };
      }

      let settings: CameraSettings | null = null;
      let choices: CameraChoices | null = null;
      try {
        [settings, choices] = await Promise.all([this.readSettings(), this.readAllChoices()]);
      } catch {
        // A body that claims fine but will not describe its config is still usable for stills.
      }

      return {
        backend: this.backend,
        ready: true,
        model,
        port,
        serverLiveView: true,
        message: null,
        settings,
        choices,
        hint: await macosClaimHint(),
      };
    } catch (error) {
      return {
        backend: this.backend,
        ready: false,
        model: null,
        port: null,
        serverLiveView: true,
        message: describe(error),
        settings: null,
        choices: null,
        hint: await macosClaimHint(),
      };
    }
  }

  private async readConfig(name: string): Promise<string | null> {
    try {
      const stdout = await this.gphoto(['--get-config', name], 8000);
      const current = stdout.split('\n').find((l) => l.startsWith('Current:'));
      return current ? current.replace('Current:', '').trim() : null;
    } catch {
      return null;
    }
  }

  private async readChoices(name: string): Promise<string[]> {
    try {
      const stdout = await this.gphoto(['--get-config', name], 8000);
      return stdout
        .split('\n')
        .filter((l) => l.startsWith('Choice:'))
        // "Choice: 3 400" -> "400"
        .map((l) => l.replace(/^Choice:\s*\d+\s*/, '').trim())
        .filter((v) => v.length > 0 && v !== 'Unknown value');
    } catch {
      return [];
    }
  }

  private async readAllChoices(): Promise<CameraChoices> {
    const [iso, aperture, shutterspeed] = await Promise.all([
      this.readChoices('iso'),
      this.readChoices('aperture'),
      this.readChoices('shutterspeed'),
    ]);
    return { iso, aperture, shutterspeed };
  }

  private async readSettings(): Promise<CameraSettings> {
    const [iso, aperture, shutterspeed] = await Promise.all([
      this.readConfig('iso'),
      this.readConfig('aperture'),
      this.readConfig('shutterspeed'),
    ]);
    return { iso, aperture, shutterspeed };
  }

  async applySettings(patch: Partial<CameraSettings>): Promise<CameraSettings> {
    return this.lock.run(async () => {
      const wasLive = this.liveProcess !== null;
      await this.stopLiveView();

      for (const [name, value] of Object.entries(patch)) {
        if (value == null || value === '') continue;
        await this.gphoto(['--set-config', `${name}=${value}`], 10_000);
      }

      const settings = await this.readSettings();
      if (wasLive) this.startLiveProcess();
      return settings;
    });
  }

  async capture(sessionId: string, index: number): Promise<CaptureResult> {
    return this.lock.run(async () => {
      const wasLive = this.liveProcess !== null;
      await this.stopLiveView();

      const relative = path.join(sessionId, `shot-${index}.jpeg`);
      const target = path.join(UPLOAD_DIR, relative);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.rm(target, { force: true });

      const fire = () =>
        this.gphoto(['--capture-image-and-download', '--filename', target, '--force-overwrite'], 45_000);

      try {
        try {
          await fire();
        } catch (first) {
          // A refused autofocus is the commonest miss at an event and usually succeeds on a
          // second attempt once the lens has settled. Anything else fails straight through.
          if (!/focus/i.test(first instanceof Error ? first.message : String(first))) throw first;
          await new Promise((r) => setTimeout(r, 600));
          await fire();
        }
      } catch (error) {
        throw new Error(describe(error));
      } finally {
        if (wasLive) this.startLiveProcess();
      }

      const stat = await fs.stat(target);
      return { file: relative, bytes: stat.size };
    });
  }

  private startLiveProcess() {
    if (this.liveProcess) return;
    const child = spawn(BIN, ['--capture-movie', '--stdout'], { stdio: ['ignore', 'pipe', 'pipe'] });
    child.on('exit', () => {
      if (this.liveProcess === child) this.liveProcess = null;
    });
    this.liveProcess = child;
  }

  private async stopLiveView(): Promise<void> {
    const child = this.liveProcess;
    if (!child) return;
    this.liveProcess = null;
    child.kill('SIGTERM');
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve(null);
      }, 2000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve(null);
      });
    });
  }

  async liveView(signal: AbortSignal): Promise<ReadableStream<Uint8Array> | null> {
    this.startLiveProcess();
    const child = this.liveProcess;
    if (!child?.stdout) return null;

    const framer = createMjpegFramer();

    return new ReadableStream<Uint8Array>({
      start: (controller) => {
        const stdout = child.stdout!;
        const onData = (chunk: Buffer<ArrayBuffer>) => {
          for (const part of framer.push(chunk)) controller.enqueue(new Uint8Array(part));
        };
        const finish = () => {
          stdout.off('data', onData);
          try {
            controller.close();
          } catch {
            // Already closed by an earlier abort.
          }
        };

        stdout.on('data', onData);
        child.once('exit', finish);
        signal.addEventListener('abort', finish, { once: true });
      },
      cancel: () => {
        void this.stopLiveView();
      },
    });
  }
}

/** macOS auto-launches ptpcamerad and grabs the camera; gphoto2 then cannot claim it. */
async function macosClaimHint(): Promise<string | null> {
  if (process.platform !== 'darwin') return null;
  try {
    const { stdout } = await run('/bin/sh', ['-c', 'pgrep -x ptpcamerad || true'], { timeout: 3000 });
    return stdout.trim()
      ? 'macOS is holding the camera (ptpcamerad). Run `sudo killall ptpcamerad` in a terminal, then re-detect — without sudo the kill silently fails.'
      : null;
  } catch {
    return null;
  }
}

function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('ENOENT')) return 'gphoto2 is not installed on this host.';
  if (/no camera|could not detect/i.test(message)) {
    return 'No camera responded. Check the USB cable, power and that the body is not asleep.';
  }
  if (/out of focus|focus/i.test(message)) return 'The camera refused to fire: it could not focus.';
  if (/card|storage/i.test(message)) return 'The camera reported a card problem. Check the SD card.';
  if (/could not claim|busy/i.test(message)) {
    return 'The camera is attached but macOS will not release it. Run `sudo killall ptpcamerad`, close Image Capture and Photos, then retry.';
  }
  return message.split('\n')[0];
}
