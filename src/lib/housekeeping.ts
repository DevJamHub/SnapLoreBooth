import fs from 'node:fs/promises';
import path from 'node:path';
import { getConfig } from './config';
import { DATA_DIR, FRAME_DIR, UPLOAD_DIR, db } from './db';
import { SESSION_ID, purgeExpired } from './retention';
import { canOptimizeStills, folderSize, mirrorFile, optimizeStill } from './storage';

/** Where the booth's disk goes, by kind, in bytes. */
export interface StorageBreakdown {
  photos: number;
  clips: number;
  live: number;
  sheets: number;
  /** Console test shots. */
  tests: number;
  /** Folders of sessions that no longer exist, and anything else unrecognised. */
  other: number;
  frames: number;
  database: number;
  total: number;
  /** Free space on the disk holding data/, when the OS says. */
  free: number | null;
  sessions: number;
}

const KIND: [RegExp, keyof StorageBreakdown][] = [
  [/^shot-\d+\./, 'photos'],
  [/^clip-\d+\./, 'clips'],
  [/^live\./, 'live'],
  [/^strip\./, 'sheets'],
  // GIFs and boomerangs made for the QR page go with the videos they came from.
  [/^fx-/, 'clips'],
];

function knownSessions(): Set<string> {
  return new Set((db.prepare('SELECT id FROM sessions').all() as { id: string }[]).map((r) => r.id));
}

export async function storageBreakdown(): Promise<StorageBreakdown> {
  const result: StorageBreakdown = {
    photos: 0,
    clips: 0,
    live: 0,
    sheets: 0,
    tests: 0,
    other: 0,
    frames: 0,
    database: 0,
    total: 0,
    free: null,
    sessions: 0,
  };
  const sessions = knownSessions();
  result.sessions = sessions.size;

  for (const folder of await fs.readdir(UPLOAD_DIR, { withFileTypes: true }).catch(() => [])) {
    const dir = path.join(UPLOAD_DIR, folder.name);
    if (!folder.isDirectory()) {
      result.other += await fs.stat(dir).then((s) => s.size, () => 0);
      continue;
    }
    if (folder.name === 'diagnostics') {
      result.tests += await folderSize(dir);
      continue;
    }
    if (!sessions.has(folder.name)) {
      result.other += await folderSize(dir);
      continue;
    }
    for (const file of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const size = await fs.stat(path.join(dir, file.name)).then((s) => (s.isFile() ? s.size : 0), () => 0);
      const kind = KIND.find(([pattern]) => pattern.test(file.name))?.[1] ?? 'other';
      result[kind] += size;
    }
  }

  result.frames = await folderSize(FRAME_DIR);
  result.database = (
    await Promise.all(['booth.db', 'booth.db-wal', 'booth.db-shm'].map((f) => fs.stat(path.join(DATA_DIR, f)).then((s) => s.size, () => 0)))
  ).reduce((a, b) => a + b, 0);
  result.total = result.photos + result.clips + result.live + result.sheets + result.tests + result.other + result.frames + result.database;
  const disk = await fs.statfs(DATA_DIR).catch(() => null);
  result.free = disk ? disk.bavail * disk.bsize : null;
  return result;
}

export interface OptimizeResult {
  /** Bytes freed in all. */
  freed: number;
  /** Camera photos made smaller, and what that saved. */
  stills: number;
  stillBytes: number;
  /** Photos not looked at this run (a run stops after a while); the next run carries on. */
  stillsUnchecked: number;
  sessionsExpired: number;
  videosExpired: number;
  /** Test shots, orphan folders and leftovers removed. */
  leftovers: number;
  databaseBytes: number;
}

/** One run looks at most at this many photos, so the request finishes well inside a tunnel's timeout. */
const STILLS_PER_RUN = 300;
/** Below this a JPEG is already about the size a 2400 px photo comes to, so it is not opened. */
const SMALL_ENOUGH_BYTES = 700_000;

/**
 * Everything the console's "Optimalkan sekarang" does, safest first: apply the retention
 * windows now, delete console test shots and folders no session owns, shrink camera photos
 * kept larger than the configured size, then fold the database's log back in and compact it.
 * Nothing a current guest needs is touched: sessions and sheets stay, photos only get smaller.
 */
export async function optimizeStorage(): Promise<OptimizeResult> {
  const before = await storageBreakdown();
  const result: OptimizeResult = {
    freed: 0,
    stills: 0,
    stillBytes: 0,
    stillsUnchecked: 0,
    sessionsExpired: 0,
    videosExpired: 0,
    leftovers: 0,
    databaseBytes: 0,
  };

  const purged = await purgeExpired(true);
  result.sessionsExpired = purged.sessions;
  result.videosExpired = purged.videos;

  const sessions = knownSessions();
  for (const folder of await fs.readdir(UPLOAD_DIR, { withFileTypes: true }).catch(() => [])) {
    const dir = path.join(UPLOAD_DIR, folder.name);
    const orphan = folder.isDirectory() && SESSION_ID.test(folder.name) && !sessions.has(folder.name);
    if (folder.name === 'diagnostics' || orphan) {
      await fs.rm(dir, { recursive: true, force: true });
      result.leftovers++;
    }
  }

  const { maxEdge, quality } = getConfig().storage;
  if (maxEdge > 0 && canOptimizeStills()) {
    const stills = (db.prepare('SELECT file FROM photos ORDER BY created_at ASC').all() as { file: string }[]).map((r) => r.file);
    let checked = 0;
    for (const file of stills) {
      // A shrink that failed half-way leaves its temporary file behind.
      await fs.rm(path.join(UPLOAD_DIR, `${file}.small.jpeg`), { force: true });
      const size = await fs.stat(path.join(UPLOAD_DIR, file)).then((s) => s.size, () => 0);
      if (size < SMALL_ENOUGH_BYTES) continue;
      if (checked >= STILLS_PER_RUN) {
        result.stillsUnchecked++;
        continue;
      }
      checked++;
      const saved = await optimizeStill(file, maxEdge, quality);
      if (saved > 0) {
        result.stills++;
        result.stillBytes += saved;
        await mirrorFile(file);
      }
    }
  }

  // Fold the write-ahead log into the database file and give back the pages deletions freed.
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.exec('VACUUM');

  const after = await storageBreakdown();
  result.databaseBytes = Math.max(before.database - after.database, 0);
  result.freed = Math.max(before.total - after.total, 0);
  return result;
}
