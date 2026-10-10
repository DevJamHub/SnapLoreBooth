import fs from 'node:fs/promises';
import path from 'node:path';
import { deletePrefix } from './cloud';
import { getConfig } from './config';
import { db, UPLOAD_DIR } from './db';
import { currentEvent, eventById } from './events';
import { removeMotion } from './motion';
import { folderSize, removeStored } from './storage';

/**
 * Guest photos are personal data: the consent copy promises the booth forgets them. A week by
 * default (long enough to download from the QR after the party, short enough to forget), set
 * in Konsol → Pengaturan → Penyimpanan.
 */
export function retentionHours(): number {
  return getConfig().storage.photoHours;
}

const THROTTLE_MS = 10 * 60 * 1000;

let lastRun = 0;

export interface PurgeResult {
  sessions: number;
  /** Sessions whose videos went (the photos stay until their own window ends). */
  videos: number;
  skipped: boolean;
}

/**
 * Removes one session: its files (local and R2), then its rows. Files go first, so a crash
 * leaves an orphan row that is retried, never an orphan folder no row points at. False when
 * the R2 copy could not be deleted; the row stays so the next sweep tries again.
 */
async function deleteSession(id: string): Promise<boolean> {
  usageCache = null;
  await fs.rm(path.join(UPLOAD_DIR, id), { recursive: true, force: true });
  try {
    await deletePrefix(id);
  } catch (error) {
    console.error('[retention] R2 delete failed for', id, error instanceof Error ? error.message : error);
    return false;
  }
  db.prepare('DELETE FROM photos WHERE session_id = ?').run(id);
  // The settled record lives in the Xendit dashboard; the booth's copy goes with the session.
  db.prepare('DELETE FROM payments WHERE session_id = ?').run(id);
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  return true;
}

/**
 * Videos past their own window: the files go and the session forgets them, while the photos,
 * the sheet and the QR page stay. Videos take most of the space, so they may go first.
 */
export async function purgeVideos(cutoff: string): Promise<number> {
  const sessions = db
    .prepare(
      `SELECT s.id, s.live_file FROM sessions s
       WHERE s.created_at < ? AND (s.live_file IS NOT NULL OR EXISTS (SELECT 1 FROM photos p WHERE p.session_id = s.id AND p.clip_file IS NOT NULL))`,
    )
    .all(cutoff) as { id: string; live_file: string | null }[];
  const clipsOf = db.prepare('SELECT clip_file FROM photos WHERE session_id = ? AND clip_file IS NOT NULL');
  let purged = 0;
  for (const session of sessions) {
    const files = [session.live_file, ...(clipsOf.all(session.id) as { clip_file: string }[]).map((r) => r.clip_file)].filter(
      (f): f is string => !!f,
    );
    const removed = await Promise.all(files.map((f) => removeStored(f)));
    // A copy R2 would not delete keeps its row, so the next sweep tries again.
    if (removed.some((ok) => !ok)) continue;
    // The GIFs and boomerangs made from them go too.
    await removeMotion(session.id);
    db.prepare('UPDATE photos SET clip_file = NULL WHERE session_id = ?').run(session.id);
    db.prepare('UPDATE sessions SET live_file = NULL WHERE id = ?').run(session.id);
    purged++;
  }
  return purged;
}

/** Deletes sessions past the retention window along with their stored frames, and older videos. */
export async function purgeExpired(force = false): Promise<PurgeResult> {
  const now = Date.now();
  if (!force && now - lastRun < THROTTLE_MS) return { sessions: 0, videos: 0, skipped: true };
  lastRun = now;

  const { photoHours, videoHours } = getConfig().storage;
  const cutoff = new Date(now - photoHours * 3600_000).toISOString();
  const expired = db.prepare('SELECT id FROM sessions WHERE created_at < ?').all(cutoff) as { id: string }[];
  for (const { id } of expired) await deleteSession(id);
  const videos = videoHours < photoHours ? await purgeVideos(new Date(now - videoHours * 3600_000).toISOString()) : 0;

  return { sessions: expired.length, videos, skipped: false };
}

/**
 * A guest's "Hapus fotoku" on the page the QR opens: every photo, video and the sheet go, here
 * and in R2, and the session forgets them and leaves the gallery. The session and its payments
 * stay, so the day's revenue and counts still add up. False when R2 would not delete.
 */
export async function eraseSessionMedia(id: string): Promise<boolean> {
  usageCache = null;
  await fs.rm(path.join(UPLOAD_DIR, id), { recursive: true, force: true });
  try {
    await deletePrefix(id);
  } catch (error) {
    console.error('[retention] R2 delete failed for', id, error instanceof Error ? error.message : error);
    return false;
  }
  db.prepare('DELETE FROM photos WHERE session_id = ?').run(id);
  db.prepare(
    `UPDATE sessions SET strip_file = NULL, live_file = NULL, decor = NULL, picks = NULL, in_gallery = 0, erased_at = ? WHERE id = ?`,
  ).run(new Date().toISOString(), id);
  return true;
}

/** What the operator types to confirm wiping every guest's photos, or many at once. */
export const PURGE_CONFIRMATION = 'HAPUS';
/** Deleting this many chosen sessions at once also asks for the typed word. */
export const BULK_CONFIRM_FROM = 10;
/** No guest takes longer than this from Pilih to Cetak; younger unfinished sessions are live. */
const ACTIVE_SESSION_MS = 30 * 60 * 1000;
/** Session ids, as the kiosk mints them; anything else in uploads is not ours to delete. */
export const SESSION_ID = /^SB[A-Z0-9]{6}$/;

/** A guest may still be at the booth with it: unfinished and started within the last half hour. */
export function isSessionActive(session: { status: string; created_at: string }): boolean {
  return session.status !== 'done' && Date.now() - new Date(session.created_at).getTime() < ACTIVE_SESSION_MS;
}

export interface PurgeAllResult {
  deleted: number;
  /** Guests at the booth right now; deleting them would lose a paid session mid-way. */
  kept: number;
  failed: number;
}

type SessionBrief = { id: string; status: string; created_at: string };

async function deleteAll(sessions: SessionBrief[], includeActive: boolean): Promise<PurgeAllResult> {
  const result: PurgeAllResult = { deleted: 0, kept: 0, failed: 0 };
  for (const s of sessions) {
    if (!includeActive && isSessionActive(s)) {
      result.kept++;
      continue;
    }
    if (await deleteSession(s.id)) result.deleted++;
    else result.failed++;
  }
  return result;
}

/**
 * The sessions the operator ticked in the console. Guests still at the booth are left alone
 * unless the operator said to take them too.
 */
export async function deleteSessions(ids: string[], includeActive = false): Promise<PurgeAllResult> {
  const find = db.prepare('SELECT id, status, created_at FROM sessions WHERE id = ?');
  const sessions = [...new Set(ids)].map((id) => find.get(id) as SessionBrief | undefined).filter((s): s is SessionBrief => !!s);
  return deleteAll(sessions, includeActive);
}

export class EventDeleteError extends Error {}

/**
 * A past event and every session in it. The running event cannot go: new guests join it.
 * The event row stays while any of its sessions could not be deleted, so it can be retried.
 */
export async function deleteEvent(id: string): Promise<PurgeAllResult> {
  const event = eventById(id);
  if (!event) throw new EventDeleteError('acara tidak ditemukan');
  if (event.id === currentEvent().id) throw new EventDeleteError('acara yang sedang berjalan tidak bisa dihapus; mulai acara baru dulu');
  const sessions = db.prepare('SELECT id, status, created_at FROM sessions WHERE event_id = ?').all(id) as SessionBrief[];
  const result = await deleteAll(sessions, true);
  if (result.failed === 0) db.prepare('DELETE FROM events WHERE id = ?').run(id);
  return result;
}

/** The console's "Hapus semua foto tamu". Events, prices and frames are left alone. */
export async function purgeAllSessions(): Promise<PurgeAllResult> {
  const sessions = db.prepare('SELECT id, status, created_at FROM sessions').all() as SessionBrief[];
  const result = await deleteAll(sessions, false);

  // Folders left by sessions whose rows are already gone would otherwise linger forever.
  const remaining = new Set((db.prepare('SELECT id FROM sessions').all() as { id: string }[]).map((r) => r.id));
  const folders = await fs.readdir(UPLOAD_DIR).catch(() => [] as string[]);
  for (const name of folders) {
    if (SESSION_ID.test(name) && !remaining.has(name)) {
      await fs.rm(path.join(UPLOAD_DIR, name), { recursive: true, force: true });
    }
  }
  return result;
}

/** Walking every stored file is slow on a full disk; the console refreshes every 15 s. */
const USAGE_TTL_MS = 60_000;
let usageCache: { at: number; bytes: number } | null = null;

/** How many sessions the booth holds and the bytes their photos and videos take (measured at most once a minute). */
export async function guestDataUsage(): Promise<{ sessions: number; bytes: number }> {
  const sessions = (db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n;
  if (usageCache && Date.now() - usageCache.at < USAGE_TTL_MS) return { sessions, bytes: usageCache.bytes };
  const bytes = await folderSize(UPLOAD_DIR);
  usageCache = { at: Date.now(), bytes };
  return { sessions, bytes };
}
