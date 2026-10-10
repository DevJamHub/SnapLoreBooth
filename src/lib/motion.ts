import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { UPLOAD_DIR } from './db';

const run = promisify(execFile);

/** Where Homebrew and Linux packages put ffmpeg; FFMPEG_BIN names another. */
const FFMPEG = [process.env.FFMPEG_BIN, '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg'].find(
  (p): p is string => !!p && existsSync(p),
);

/**
 * GIFs and boomerangs are made on the server, from the clips the booth already has, the first
 * time a guest asks: a phone shares them as they are, and the booth tablet does none of the work.
 */
export function canMakeMotion(): boolean {
  return FFMPEG !== undefined;
}

/**
 * Made files are not in the database; they sit in the session's folder under this prefix, so
 * deleting the session's folder takes them, and the video sweep finds them by name.
 */
export const MOTION_PREFIX = 'fx-';

export type MotionKind = 'boomerang' | 'gif';

export class MotionError extends Error {}

/** Two at once at most: a queue of guests asking together must not starve the booth's own screen. */
const MAX_RUNNING = 2;
let running = 0;
const waiting: (() => void)[] = [];

async function slot<T>(job: () => Promise<T>): Promise<T> {
  if (running >= MAX_RUNNING) await new Promise<void>((resolve) => waiting.push(resolve));
  running++;
  try {
    return await job();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

/** A clip forwards then backwards, twice, so it loops smoothly even where it is not looped. */
function boomerangArgs(input: string, output: string, mirror: boolean): string[] {
  const flip = mirror ? 'hflip,' : '';
  return [
    '-y', '-i', input,
    '-filter_complex',
    `[0:v]${flip}scale=720:-2:flags=bicubic,setpts=PTS/2,fps=30,split=4[a][b][c][d];[b]reverse[br];[d]reverse[dr];[a][br][c][dr]concat=n=4:v=1:a=0,format=yuv420p[v]`,
    '-map', '[v]', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-movflags', '+faststart',
    output,
  ];
}

/** The live sheet as a GIF: small, with a palette of its own, looping forever. */
function gifArgs(input: string, output: string): string[] {
  return [
    '-y', '-i', input,
    '-vf', 'fps=12,scale=360:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4',
    '-loop', '0',
    output,
  ];
}

const making = new Map<string, Promise<string>>();

/**
 * The stored file for `source` made into `kind`, making it the first time. `name` tells the
 * outputs apart (one boomerang per photo); `mirror` flips a clip stored as the sensor saw it.
 * Returns the path relative to the upload folder.
 */
export function motionFile(sessionId: string, source: string, kind: MotionKind, name: string, mirror = false): Promise<string> {
  if (!FFMPEG) return Promise.reject(new MotionError('ffmpeg is not installed on this server'));
  const relative = path.join(sessionId, `${MOTION_PREFIX}${name}.${kind === 'gif' ? 'gif' : 'mp4'}`);
  const pending = making.get(relative);
  if (pending) return pending;

  const job = (async () => {
    const target = path.join(UPLOAD_DIR, relative);
    const input = path.join(UPLOAD_DIR, source);
    if (!target.startsWith(UPLOAD_DIR + path.sep) || !input.startsWith(UPLOAD_DIR + path.sep)) throw new MotionError('bad path');
    if (existsSync(target)) return relative;
    if (!existsSync(input)) throw new MotionError('the video is no longer stored');

    const temp = `${target}.part${path.extname(target)}`;
    try {
      await slot(() => run(FFMPEG, kind === 'gif' ? gifArgs(input, temp) : boomerangArgs(input, temp, mirror), { timeout: 60_000 }));
      await fs.rename(temp, target);
      return relative;
    } catch (error) {
      await fs.rm(temp, { force: true });
      console.error('[motion] ffmpeg failed for', relative, error instanceof Error ? error.message.slice(0, 300) : error);
      throw new MotionError('could not make it');
    }
  })().finally(() => making.delete(relative));
  making.set(relative, job);
  return job;
}

/** Deletes a session's made GIFs and boomerangs, with its videos. Returns how many went. */
export async function removeMotion(sessionId: string): Promise<number> {
  const dir = path.join(UPLOAD_DIR, sessionId);
  if (!dir.startsWith(UPLOAD_DIR + path.sep)) return 0;
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  const made = names.filter((n) => n.startsWith(MOTION_PREFIX));
  await Promise.all(made.map((n) => fs.rm(path.join(dir, n), { force: true })));
  return made.length;
}
