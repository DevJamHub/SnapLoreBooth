import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { UPLOAD_DIR } from '@/lib/db';
import { guardRails } from './exposure';
import { FocusLockError, isFocusLocked, saveFocusLock } from './focusLock';
import { createJpegSplitter, multipartPart } from './mjpeg';
import type {
  AutoSetupStep,
  CameraChoices,
  CameraInfo,
  CameraSettings,
  CameraSource,
  CameraStatus,
  CaptureOptions,
  CaptureResult,
  LiveViewOptions,
  SettingName,
} from './types';

const run = promisify(execFile);
const BIN = process.env.GPHOTO2_BIN ?? 'gphoto2';
/** gphoto2 is translated; its messages are only parsed reliably in English. */
const GPHOTO_ENV = { ...process.env, LANG: 'C', LC_ALL: 'C' };

/**
 * The body streams live view as fast as USB allows: about 33 fps of 480x320 on an M50, each
 * frame around 80 KB (some 20 Mbit/s). A screen on this machine or the venue LAN takes it all;
 * a tunnel gets fewer (see the route).
 */
const LIVE_FPS = 30;
/** A guest moving from Hias to Foto, or a reload, reconnects within this; then live view stops. */
const LIVE_IDLE_MS = 15_000;
/** How soon live view is retried after the body drops it (asleep, cable knocked). */
const LIVE_RETRY_MS = 2000;
const SETTING_NAMES: SettingName[] = ['iso', 'aperture', 'shutterspeed'];
/**
 * A guest is mid-pose; past this a shot is not coming. Long enough for a retried autofocus
 * and a 1 s exposure, short enough to say "Coba lagi" while they are still there.
 */
const CAPTURE_TIMEOUT_MS = 20_000;
/**
 * How long a half-press gets to focus before the shot is taken anyway. A booth must never
 * refuse to fire: a guest in dim light is better slightly soft than not photographed at all.
 */
const FOCUS_WINDOW_MS = 700;
/** Time the one focus of a focus lock gets: longer than a shot's, nobody is waiting on it. */
const FOCUS_ONCE_MS = 1500;
/** gphoto2 can sit for 90 s after reporting a refusal; once it has said so, it is killed. */
const KILL_AFTER_ERROR_MS = 500;
/** How long live view gets to shut the camera's viewfinder down cleanly before it is killed. */
const LIVE_STOP_MS = 2500;

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

type FrameListener = (frame: Buffer) => void;

interface Target {
  model: string;
  port: string;
}

/** One `--get-config` answer: whether it can be set, its value, and the values it takes. */
interface ConfigField {
  readonly: boolean;
  current: string | null;
  choices: string[];
}

function parseConfig(block: string): ConfigField {
  const lines = block.split('\n').map((l) => l.trim());
  return {
    readonly: lines.some((l) => /^Readonly:\s*1/.test(l)),
    current: lines.find((l) => l.startsWith('Current:'))?.replace('Current:', '').trim() ?? null,
    choices: lines
      .filter((l) => l.startsWith('Choice:'))
      .map((l) => l.replace(/^Choice:\s*\d+\s*/, '').trim())
      .filter((v) => v.length > 0 && v !== 'Unknown value'),
  };
}

const isJpegOnly = (v: string | null) => !!v && /jpe?g/i.test(v) && !/raw/i.test(v);
const neverSleeps = (v: string | null) => !!v && (/^0+$/.test(v.trim()) || /disable|never|off/i.test(v));

/**
 * The lines gphoto2 prints under "*** Error ***", without its debugging boilerplate. It
 * exits 0 for many refusals (no focus, busy, bad value), so this is the only reliable signal.
 */
function gphotoError(output: string): string | null {
  const at = output.indexOf('*** Error');
  if (at === -1) return null;
  const lines = output
    .slice(at)
    .split(/\n\s*\n/)[0]
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('***'));
  return lines.join('\n') || 'gphoto2 reported an error';
}

/**
 * Rows of `gphoto2 --auto-detect`. An iPhone or iPad plugged in to charge shows up as a PTP
 * camera too, and gphoto2 would otherwise talk to whichever it finds first.
 */
function parseDetected(stdout: string): Target[] {
  return stdout
    .split('\n')
    .slice(2)
    .map((l) => l.trim())
    .filter((l) => /usb:/.test(l))
    .map((l) => ({ model: l.slice(0, l.search(/usb:/)).trim(), port: l.slice(l.search(/usb:/)).trim() }));
}

/**
 * Starts gphoto2 so its output arrives line by line. Over a pipe it holds every line until it
 * exits, and the moment the shutter fires ("New file is in location") would come too late
 * to flash on. A pseudo-terminal (macOS `script`) or `stdbuf` (Linux) unbuffers it. It runs
 * in its own process group so a timeout kills gphoto2, not just the wrapper.
 */
function spawnUnbuffered(args: string[]): ChildProcess {
  const options = { stdio: ['ignore', 'pipe', 'pipe'] as ('ignore' | 'pipe')[], detached: true, env: GPHOTO_ENV };
  if (process.platform === 'darwin' && existsSync('/usr/bin/script')) {
    return spawn('/usr/bin/script', ['-q', '/dev/null', BIN, ...args], options);
  }
  if (process.platform === 'linux' && existsSync('/usr/bin/stdbuf')) {
    return spawn('/usr/bin/stdbuf', ['-oL', '-eL', BIN, ...args], options);
  }
  return spawn(BIN, args, options);
}

function killGroup(child: ChildProcess) {
  try {
    if (child.pid) process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
}

const isClaimError = (error: unknown) => /could not claim/i.test(error instanceof Error ? error.message : String(error));

/**
 * macOS starts ptpcamerad whenever a camera is plugged in or wakes, and it takes the camera
 * gphoto2 needs. It runs as the logged-in user, so the booth can stop it without sudo; launchd
 * brings it back later, harmlessly. True when one was stopped.
 */
async function freeFromMacos(): Promise<boolean> {
  if (process.platform !== 'darwin') return false;
  try {
    await run('/usr/bin/pkill', ['-9', '-x', 'ptpcamerad'], { timeout: 3000 });
    return true;
  } catch {
    return false; // none running (pkill exits 1)
  }
}

/**
 * Everything live view holds open, let go when the server is asked to stop. An open viewfinder
 * stream keeps the server's graceful shutdown waiting forever, and its gphoto2 child, left
 * running, holds the camera: the next server then finds it taken.
 */
const liveChildren = new Set<ChildProcess>();
const liveStreams = new Set<() => void>();
let shutdownHooked = false;

function releaseLive() {
  for (const close of [...liveStreams]) close();
  for (const child of liveChildren) child.kill('SIGINT');
}

function hookShutdown() {
  if (shutdownHooked) return;
  shutdownHooked = true;
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      releaseLive();
      // Next.js exits once its connections close; should anything else hold it, it still goes.
      setTimeout(() => process.exit(0), 3000).unref();
    });
  }
  process.once('exit', releaseLive);
}

function trackLive(child: ChildProcess) {
  hookShutdown();
  liveChildren.add(child);
  child.once('exit', () => liveChildren.delete(child));
}

function pickCamera(rows: Target[]): Target | null {
  const wanted = process.env.GPHOTO2_CAMERA?.toLowerCase();
  if (wanted) return rows.find((r) => r.model.toLowerCase().includes(wanted)) ?? null;
  return rows.find((r) => !/apple|iphone|ipad/i.test(r.model)) ?? null;
}

export class Gphoto2Camera implements CameraSource {
  readonly backend = 'gphoto2' as const;
  private lock = new CameraLock();
  private liveProcess: ChildProcess | null = null;
  /** One per open viewfinder. Live view runs while any is listening. */
  private listeners = new Set<FrameListener>();
  private idleTimer: NodeJS.Timeout | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  /** The last good probe, answered while live view holds the camera. */
  private lastInfo: CameraInfo | null = null;
  /** The body every command is addressed to. Cleared on failure; the port changes on replug. */
  private target: Target | null = null;
  /** Whether the body takes Canon EOS remote-release commands; asked once, then remembered. */
  private eosRelease: boolean | null = null;

  private portArgs(): string[] {
    return this.target ? ['--port', this.target.port] : [];
  }

  /** One gphoto2 run; when macOS has taken the camera, it is made to let go and the run retried. */
  private async gphoto(args: string[], timeout = 20_000): Promise<string> {
    try {
      return await this.gphotoOnce(args, timeout);
    } catch (error) {
      if (isClaimError(error) && (await freeFromMacos())) return this.gphotoOnce(args, timeout);
      throw error;
    }
  }

  private async gphotoOnce(args: string[], timeout: number): Promise<string> {
    let stdout: string;
    let stderr: string;
    try {
      // SIGKILL on timeout: gphoto2 blocked on the camera ignores SIGTERM and holds the lock.
      ({ stdout, stderr } = await run(BIN, [...this.portArgs(), ...args], {
        timeout,
        killSignal: 'SIGKILL',
        maxBuffer: 8 * 1024 * 1024,
        env: GPHOTO_ENV,
      }));
    } catch (error) {
      const failed = error as { stdout?: string; stderr?: string };
      const printed = gphotoError(`${failed.stderr ?? ''}\n${failed.stdout ?? ''}`);
      throw new Error(printed ?? (error instanceof Error ? error.message.split('\n')[0] : String(error)));
    }
    const printed = gphotoError(`${stderr}\n${stdout}`);
    if (printed) throw new Error(printed);
    return stdout;
  }

  /** Finds the camera to drive. Call inside the lock. */
  private async detect(): Promise<Target | null> {
    const { stdout } = await run(BIN, ['--auto-detect'], { timeout: 8000, killSignal: 'SIGKILL', env: GPHOTO_ENV });
    const found = pickCamera(parseDetected(stdout));
    // Another body may have been plugged in; ask it again how it is fired.
    if (found?.model !== this.target?.model) this.eosRelease = null;
    this.target = found;
    return this.target;
  }

  async info(): Promise<CameraInfo> {
    return this.lock.run(async () => {
      // Live view holds the camera by design: probing now would fail and report the booth
      // broken to the guest who is looking at a working viewfinder.
      if (this.liveProcess) return { ...(this.lastInfo ?? this.busyInfo()), focusLocked: isFocusLocked() };
      const info = await this.probe();
      if (info.ready) this.lastInfo = info;
      return { ...info, focusLocked: isFocusLocked() };
    });
  }

  private busyInfo(): CameraInfo {
    return {
      backend: this.backend,
      ready: true,
      model: null,
      port: null,
      serverLiveView: true,
      message: null,
      settings: null,
      choices: null,
      hint: null,
    };
  }

  private async probe(): Promise<CameraInfo> {
    try {
      const found = await this.detect();

      if (!found) {
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

      const { model, port } = found;
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

      const stillAspect = await this.readStillAspect();

      let settings: CameraSettings | null = null;
      let choices: CameraChoices | null = null;
      try {
        ({ settings, choices } = await this.readConfigs());
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
        stillAspect,
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

  /**
   * Reads every exposure setting in one gphoto2 run. Separate runs at once would fight over
   * the camera, and all but one would come back empty.
   */
  private async readConfigs(): Promise<{ settings: CameraSettings; choices: CameraChoices }> {
    const stdout = await this.gphoto(SETTING_NAMES.flatMap((name) => ['--get-config', name]), 15_000);
    // Each setting prints as a block ending in a line "END", in the order asked.
    const blocks = stdout.split(/^END$/m);
    const settings: CameraSettings = { iso: null, aperture: null, shutterspeed: null };
    const choices: CameraChoices = { iso: [], aperture: [], shutterspeed: [] };
    SETTING_NAMES.forEach((name, i) => {
      const field = parseConfig(blocks[i] ?? '');
      settings[name] = field.current;
      choices[name] = field.choices;
    });
    return { settings, choices };
  }

  async applySettings(patch: Partial<CameraSettings>): Promise<CameraSettings> {
    return this.lock.run(async () => {
      await this.stopLiveProcess();
      if (!this.target) await this.detect();
      try {
        const args = Object.entries(patch).flatMap(([name, value]) =>
          value == null || value === '' ? [] : ['--set-config', `${name}=${value}`],
        );
        if (args.length > 0) await this.gphoto(args, 10_000);
        const { settings, choices } = await this.readConfigs();
        if (this.lastInfo) this.lastInfo = { ...this.lastInfo, settings, choices };
        return settings;
      } finally {
        if (this.listeners.size > 0) await this.startLive();
      }
    });
  }

  /** Settings the calibration checklist judges, read in one pass. Pauses live view briefly. */
  async status(): Promise<CameraStatus> {
    const fields: [keyof Omit<CameraStatus, 'model'>, string][] = [
      ['battery', 'batterylevel'],
      ['mode', 'autoexposuremodedial'],
      ['aspect', 'aspectratio'],
      ['autoPowerOff', 'autopoweroff'],
      ['imageFormat', 'imageformat'],
      ['iso', 'iso'],
      ['aperture', 'aperture'],
      ['shutterspeed', 'shutterspeed'],
    ];
    return this.lock.run(async () => {
      await this.stopLiveProcess();
      try {
        if (!this.target && !(await this.detect())) throw new Error(describe(new Error('no camera')));
        const status: CameraStatus = {
          model: this.target?.model ?? null,
          battery: null,
          mode: null,
          aspect: null,
          autoPowerOff: null,
          imageFormat: null,
          iso: null,
          aperture: null,
          shutterspeed: null,
        };
        const current = (block: string) => /^Current:\s*(.*)$/m.exec(block)?.[1]?.trim() ?? null;
        try {
          // One run for all of them; a body missing one setting fails the run, so then ask singly.
          const blocks = (await this.gphoto(fields.flatMap(([, name]) => ['--get-config', name]), 15_000)).split(/^END$/m);
          fields.forEach(([key], i) => (status[key] = current(blocks[i] ?? '')));
        } catch {
          for (const [key, name] of fields) {
            status[key] = await this.gphoto(['--get-config', name], 8000).then(current, () => null);
          }
        }
        return status;
      } finally {
        if (this.listeners.size > 0) await this.startLive();
      }
    });
  }

  /**
   * Puts the body where a booth needs it, as far as USB allows: JPEG only (RAW would hand over
   * the wrong file), one frame per press, one-shot focus (manual focus is left alone: an
   * operator chose it), never sleeping, 3:2, and shutter and aperture inside a booth's range.
   * The mode dial is physical, so it is only reported. Each step says what it found and did.
   */
  async autoSetup(): Promise<AutoSetupStep[]> {
    return this.lock.run(async () => {
      await this.stopLiveProcess();
      try {
        if (!(await this.detect())) throw new Error(describe(new Error('no camera')));
        const steps: AutoSetupStep[] = [];
        const read = (name: string) => this.gphoto(['--get-config', name], 8000).then(parseConfig, () => null);

        /** Reads a setting, sets it to what `pick` wants when that differs, and records the outcome. */
        const tune = async (key: string, label: string, name: string, pick: (f: ConfigField) => string | null, manual: string) => {
          const field = await read(name);
          if (!field) return void steps.push({ key, label, before: null, after: null, result: 'missing' });
          const want = pick(field);
          if (!want || want === field.current) return void steps.push({ key, label, before: field.current, after: field.current, result: 'ok' });
          if (field.readonly) return void steps.push({ key, label, before: field.current, after: field.current, result: 'manual', note: manual });
          try {
            await this.gphoto(['--set-config', `${name}=${want}`], 10_000);
            const after = (await read(name))?.current ?? null;
            steps.push({ key, label, before: field.current, after, result: after === want ? 'changed' : 'manual', note: after === want ? undefined : manual });
          } catch {
            steps.push({ key, label, before: field.current, after: field.current, result: 'manual', note: manual });
          }
        };

        await tune(
          'format',
          'Format foto',
          'imageformat',
          (f) =>
            isJpegOnly(f.current)
              ? f.current
              : (f.choices.find((c) => /^medium fine jpeg$/i.test(c)) ??
                f.choices.find((c) => isJpegOnly(c) && /fine/i.test(c)) ??
                f.choices.find(isJpegOnly) ??
                null),
          'Menu kamera: Kualitas gambar → JPEG saja (tanpa RAW).',
        );
        await tune(
          'drive',
          'Mode drive',
          'drivemode',
          (f) => (/single/i.test(f.current ?? '') ? f.current : (f.choices.find((c) => /^single/i.test(c)) ?? null)),
          'Menu kamera: Mode drive → Satu foto.',
        );
        if (isFocusLocked()) {
          steps.push({ key: 'focus', label: 'Fokus', before: 'terkunci', after: 'terkunci', result: 'ok' });
        } else await tune(
          'focus',
          'Mode fokus',
          'focusmode',
          (f) =>
            /one ?shot|manual|mf/i.test(f.current ?? '') ? f.current : (f.choices.find((c) => /one ?shot/i.test(c)) ?? null),
          'Menu kamera: Operasi AF → One Shot.',
        );
        await tune(
          'sleep',
          'Mati otomatis',
          'autopoweroff',
          (f) => (neverSleeps(f.current) ? f.current : (f.choices.find((c) => neverSleeps(c)) ?? (f.choices.length === 0 ? '0' : null))),
          'Menu kamera: Hemat daya → Mati otomatis → Nonaktif.',
        );
        await tune(
          'aspect',
          'Rasio foto',
          'aspectratio',
          (f) => (f.current === '3:2' || !f.choices.includes('3:2') ? f.current : '3:2'),
          'Menu kamera: Rasio foto → 3:2 (bidang gambar paling luas).',
        );

        const mode = (await read('autoexposuremodedial'))?.current ?? null;
        const manualMode = /^manual$/i.test(mode ?? '');
        steps.push({
          key: 'mode',
          label: 'Kenop mode',
          before: mode,
          after: mode,
          result: manualMode ? 'ok' : 'manual',
          note: manualMode ? undefined : 'Putar kenop mode kamera ke M, supaya terang foto sama untuk semua tamu.',
        });

        const { settings, choices } = await this.readConfigs();
        const rails = guardRails(settings, choices, mode);
        for (const [name, label] of [
          ['shutterspeed', 'Kecepatan rana'],
          ['aperture', 'Bukaan'],
        ] as const) {
          const want = rails[name];
          if (!want) {
            steps.push({ key: name, label, before: settings[name], after: settings[name], result: settings[name] ? 'ok' : 'missing' });
            continue;
          }
          try {
            await this.gphoto(['--set-config', `${name}=${want}`], 10_000);
            steps.push({ key: name, label, before: settings[name], after: want, result: 'changed' });
          } catch {
            steps.push({ key: name, label, before: settings[name], after: settings[name], result: 'failed' });
          }
        }

        // Everything cached about the body (aspect, settings) is stale now.
        this.lastInfo = null;
        return steps;
      } finally {
        if (this.listeners.size > 0) await this.startLive();
      }
    });
  }

  async capture(sessionId: string, index: number, onFired?: () => void, options: CaptureOptions = {}): Promise<CaptureResult> {
    return this.lock.run(async () => {
      // The focus test is a plain capture that autofocuses: it would move a locked focus.
      if (options.requireFocus && isFocusLocked()) throw new FocusLockError('Fokus sedang dikunci; uji autofokus dilewati.');
      await this.stopLiveProcess();
      if (!this.target && !(await this.detect())) throw new Error(describe(new Error('no camera')));

      const relative = path.join(sessionId, `shot-${index}.jpeg`);
      const target = path.join(UPLOAD_DIR, relative);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.rm(target, { force: true });

      const fire = () => this.shoot(target, onFired, options.requireFocus === true);

      try {
        try {
          await fire();
        } catch (first) {
          // macOS took the camera: make it let go and shoot again at once. A refused autofocus
          // is the commonest miss at an event and usually succeeds on a second attempt once the
          // lens has settled. Anything else fails straight through, and the focus test reports
          // the first refusal as it is.
          const freed = isClaimError(first) && (await freeFromMacos());
          if (!freed && (options.requireFocus || !/focus/i.test(first instanceof Error ? first.message : String(first)))) throw first;
          await new Promise((r) => setTimeout(r, freed ? 100 : 600));
          await fire();
        }
      } catch (error) {
        // The next attempt finds the body afresh, in case it was replugged onto another port.
        this.target = null;
        throw new Error(describe(error));
      } finally {
        // Viewfinders stay connected through the shot; they just get frames again.
        if (this.listeners.size > 0) await this.startLive();
      }

      const stat = await fs.stat(target).catch(() => null);
      if (!stat) throw new Error('The camera fired but did not hand over the photo. Try again.');
      return { file: relative, bytes: stat.size };
    });
  }

  async setFocusLock(locked: boolean): Promise<void> {
    return this.lock.run(async () => {
      await this.stopLiveProcess();
      try {
        if (!this.target && !(await this.detect())) throw new Error(describe(new Error('no camera')));
        if (!(await this.supportsEosRelease())) {
          throw new FocusLockError('Kamera ini tidak bisa mengunci fokus lewat USB. Set lensa ke MF di kamera.');
        }
        try {
          // The body's own Continuous AF would move the lens between shots. It goes back on with
          // the lock lifted. Bodies without the setting skip it.
          await this.gphoto(['--set-config', `continuousaf=${locked ? 'Off' : 'On'}`], 10_000);
        } catch {
          // Not every body has it.
        }
        if (locked) {
          // One half-press at whoever stands at the guests' spot; the AF-assist lamp may light
          // this once. Released, the lens stays where it focused.
          await this.gphoto(
            ['--set-config', 'eosremoterelease=Press Half AF', `--wait-event=${FOCUS_ONCE_MS}ms`, '--set-config', 'eosremoterelease=Release'],
            15_000,
          );
        }
        saveFocusLock(locked);
      } catch (error) {
        if (error instanceof FocusLockError) throw error;
        this.target = null;
        throw new Error(describe(error));
      } finally {
        if (this.listeners.size > 0) await this.startLive();
      }
    });
  }

  /**
   * The stills' shape, from the body's aspect-ratio setting. It is read rather than set: an
   * M50 answers "Device Busy" to any change over USB, so it is the operator's to set (3:2
   * keeps the whole sensor) and the kiosk crops its preview to whatever it is.
   */
  private async readStillAspect(): Promise<number | null> {
    try {
      const out = await this.gphoto(['--get-config', 'aspectratio'], 8000);
      const match = /Current:\s*(\d+):(\d+)/.exec(out);
      return match ? Number(match[1]) / Number(match[2]) : null;
    } catch {
      return null;
    }
  }

  /** Canon EOS bodies expose `eosremoterelease`; others are driven by plain capture. */
  private async supportsEosRelease(): Promise<boolean> {
    // Only an answer is remembered. A body that cannot be asked right now (held by macOS,
    // asleep) throws, and is asked again next time instead of being fired the wrong way until
    // it is replugged.
    this.eosRelease ??= (await this.gphoto(['--get-config', 'eosremoterelease'], 8000)).includes('Press Full MF');
    return this.eosRelease;
  }

  /**
   * One capture-and-download, reporting the moment the shutter fires. Call inside the lock.
   *
   * On a Canon EOS body the shutter is pressed the way a photographer would: half-press to
   * focus, then a full press that fires whether or not focus locked. gphoto2's own capture
   * refuses to fire without focus ("Perhaps no focus?") and then hangs for 90 s; on an M50
   * in a dim room that was most shots.
   */
  private async shoot(target: string, onFired?: () => void, requireFocus = false): Promise<void> {
    // The focus test uses plain capture on purpose: it is the one that refuses without focus.
    const eos = !requireFocus && (await this.supportsEosRelease());
    // A locked focus is kept by never pressing halfway: no autofocus, no AF-assist lamp.
    const focus = eos && !isFocusLocked() ? ['--set-config', 'eosremoterelease=Press Half AF', `--wait-event=${FOCUS_WINDOW_MS}ms`] : [];
    const args = eos
      ? [
          ...focus,
          '--set-config', 'eosremoterelease=Press Full MF',
          // "Press Full MF" presses half and full in one go; "Release Full" lets go of the full
          // press only, and the half-press it left held kept the body focusing, AF-assist lamp
          // lit, after every shot. "Release" lets go of both (libgphoto2 2.5.34).
          '--set-config', 'eosremoterelease=Release',
          '--wait-event-and-download=FILEADDED',
          '--filename', target, '--force-overwrite',
        ]
      : ['--capture-image-and-download', '--filename', target, '--force-overwrite'];
    // Printed right after the shutter fired: the full press is done and the wait for the file
    // begins (EOS), or the body has reported the new picture (plain capture).
    const firedMarker = eos ? "Waiting for 'FILEADDED'" : 'New file is in location';

    return new Promise((resolve, reject) => {
      const child = spawnUnbuffered([...this.portArgs(), ...args]);
      let output = '';
      let fired = false;
      let killing: NodeJS.Timeout | null = null;
      const collect = (chunk: Buffer) => {
        output += chunk.toString();
        if (!fired && output.includes(firedMarker)) {
          fired = true;
          onFired?.();
        }
        if (!killing && output.includes('*** Error')) killing = setTimeout(() => killGroup(child), KILL_AFTER_ERROR_MS);
      };
      child.stdout?.on('data', collect);
      child.stderr?.on('data', collect);
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        killGroup(child);
      }, CAPTURE_TIMEOUT_MS);
      child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('exit', () => {
        clearTimeout(timer);
        if (killing) clearTimeout(killing);
        if (timedOut) return reject(new Error('The camera did not take the picture in time.'));
        const printed = gphotoError(output.replace(/\r/g, ''));
        if (printed) return reject(new Error(printed));
        // The moment never showed in the output (still buffered): flash now rather than never.
        // Whether a photo really arrived is checked on disk by the caller.
        if (!fired) onFired?.();
        resolve();
      });
    });
  }

  /** Call inside the lock. Frames go to every listener until the process is stopped. */
  private async startLive() {
    if (this.liveProcess) return;
    if (!this.target) await this.detect().catch(() => null);
    this.startLiveProcess();
  }

  /** Call inside the lock, with the target found. */
  private startLiveProcess() {
    if (this.liveProcess) return;
    const child = spawn(BIN, [...this.portArgs(), '--capture-movie', '--stdout'], { stdio: ['ignore', 'pipe', 'ignore'], env: GPHOTO_ENV });
    trackLive(child);
    const splitter = createJpegSplitter();
    child.stdout!.on('data', (chunk: Buffer<ArrayBuffer>) => {
      for (const frame of splitter.push(chunk)) for (const listener of this.listeners) listener(frame);
    });
    const ended = () => {
      if (this.liveProcess !== child) return; // stopped on purpose
      this.liveProcess = null;
      this.target = null;
      // The body slept or the cable moved: keep trying while someone is watching.
      if (this.listeners.size > 0) this.scheduleRetry();
    };
    child.once('exit', ended);
    child.once('error', ended);
    this.liveProcess = child;
  }

  /** Call inside the lock. */
  private async stopLiveProcess(): Promise<void> {
    const child = this.liveProcess;
    if (!child) return;
    this.liveProcess = null;
    // SIGINT is gphoto2's Ctrl-C: it ends live view and closes the session properly. Killed
    // outright, the body can be left in PC live view and hang the next capture.
    child.kill('SIGINT');
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve(null);
      }, LIVE_STOP_MS);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve(null);
      });
    });
  }

  private scheduleRetry() {
    if (this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.listeners.size === 0) return;
      // A live view that keeps dropping is usually macOS holding the camera.
      void this.lock.run(async () => {
        await freeFromMacos();
        await this.startLive();
      });
    }, LIVE_RETRY_MS);
  }

  /** Live view keeps the sensor on and drains the battery, so it stops when nobody watches. */
  private scheduleIdleStop() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.listeners.size === 0) void this.lock.run(() => this.stopLiveProcess());
    }, LIVE_IDLE_MS);
  }

  async liveView(signal: AbortSignal, options: LiveViewOptions = {}): Promise<ReadableStream<Uint8Array> | null> {
    if (signal.aborted) return null;
    const fps = Math.min(options.fps ?? LIVE_FPS, LIVE_FPS);
    let listener: FrameListener | null = null;

    const detach = () => {
      if (!listener) return;
      this.listeners.delete(listener);
      listener = null;
      if (this.listeners.size === 0) this.scheduleIdleStop();
    };

    let close = detach;
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        // Frames earn credit at the target rate and each one sent spends one. A plain "at least
        // 1/fps apart" gate would halve a body that runs a little faster than the target (33
        // fps capped at 24 came out as 16).
        let credit = 1;
        let last = Date.now();
        listener = (frame) => {
          const now = Date.now();
          credit = Math.min(credit + ((now - last) * fps) / 1000, 2);
          last = now;
          // Drop frames a slow client has not taken yet, so the screen always shows the
          // newest frame instead of falling seconds behind.
          if (credit < 1 || (controller.desiredSize ?? 1) <= 0) return;
          credit -= 1;
          try {
            controller.enqueue(new Uint8Array(multipartPart(frame)));
          } catch {
            detach();
          }
        };
        this.listeners.add(listener);
        close = () => {
          liveStreams.delete(close);
          detach();
          try {
            controller.close();
          } catch {
            // Already closed.
          }
        };
        liveStreams.add(close);
        hookShutdown();
        if (this.idleTimer) {
          clearTimeout(this.idleTimer);
          this.idleTimer = null;
        }
        signal.addEventListener(
          'abort',
          close,
          { once: true },
        );
      },
      cancel: () => close(),
    });

    await this.lock.run(() => this.startLive());
    return stream;
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
  if (/generic capture|unsupported operation/i.test(message)) {
    return 'The camera will not shoot right now. Set the dial to a photo mode (not video) and leave the playback screen.';
  }
  if (/could not claim|busy/i.test(message)) {
    return 'The camera is attached but macOS will not release it. Run `sudo killall ptpcamerad`, close Image Capture and Photos, then retry.';
  }
  return message.split('\n')[0];
}
