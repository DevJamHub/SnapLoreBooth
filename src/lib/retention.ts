import fs from 'node:fs/promises';
import path from 'node:path';
import { deletePrefix } from './cloud';
import { db, UPLOAD_DIR } from './db';

/** Guest photos are personal data: the consent copy promises the booth forgets them. */
// A week by default: long enough to download from the QR after the party, short enough to forget.
const RETENTION_HOURS = Number(process.env.RETENTION_HOURS ?? 168);
const THROTTLE_MS = 10 * 60 * 1000;

let lastRun = 0;

export interface PurgeResult {
  sessions: number;
  skipped: boolean;
}

/**
 * Removes one session: its files (local and R2), then its rows. Files go first, so a crash
 * leaves an orphan row that is retried, never an orphan folder no row points at. False when
 * the R2 copy could not be deleted; the row stays so the next sweep tries again.
 */
async function deleteSession(id: string): Promise<boolean> {
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

/** Deletes sessions past the retention window along with their stored frames. */
export async function purgeExpired(force = false): Promise<PurgeResult> {
  const now = Date.now();
  if (!force && now - lastRun < THROTTLE_MS) return { sessions: 0, skipped: true };
  lastRun = now;

  const cutoff = new Date(now - RETENTION_HOURS * 3600_000).toISOString();
  const expired = db.prepare('SELECT id FROM sessions WHERE created_at < ?').all(cutoff) as { id: string }[];
  for (const { id } of expired) await deleteSession(id);

  return { sessions: expired.length, skipped: false };
}

/** What the operator types to confirm wiping every guest's photos. */
export const PURGE_CONFIRMATION = 'HAPUS';
/** No guest takes longer than this from Pilih to Cetak; younger unfinished sessions are live. */
const ACTIVE_SESSION_MS = 30 * 60 * 1000;
/** Session ids, as the kiosk mints them; anything else in uploads is not ours to delete. */
const SESSION_FOLDER = /^SB[A-Z0-9]{6}$/;

export interface PurgeAllResult {
  deleted: number;
  /** Guests at the booth right now; deleting them would lose a paid session mid-way. */
  kept: number;
  failed: number;
}

/** The console's "Hapus semua foto tamu". Events, prices and frames are left alone. */
export async function purgeAllSessions(): Promise<PurgeAllResult> {
  const activeSince = new Date(Date.now() - ACTIVE_SESSION_MS).toISOString();
  const sessions = db.prepare('SELECT id, status, created_at FROM sessions').all() as { id: string; status: string; created_at: string }[];
  const result: PurgeAllResult = { deleted: 0, kept: 0, failed: 0 };
  for (const s of sessions) {
    if (s.status !== 'done' && s.created_at >= activeSince) {
      result.kept++;
      continue;
    }
    if (await deleteSession(s.id)) result.deleted++;
    else result.failed++;
  }

  // Folders left by sessions whose rows are already gone would otherwise linger forever.
  const remaining = new Set((db.prepare('SELECT id FROM sessions').all() as { id: string }[]).map((r) => r.id));
  const folders = await fs.readdir(UPLOAD_DIR).catch(() => [] as string[]);
  for (const name of folders) {
    if (SESSION_FOLDER.test(name) && !remaining.has(name)) {
      await fs.rm(path.join(UPLOAD_DIR, name), { recursive: true, force: true });
    }
  }
  return result;
}


/** How many sessions the booth holds and the bytes their photos and videos take. */
export async function guestDataUsage(): Promise<{ sessions: number; bytes: number }> {
  const sessions = (db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n;
  let bytes = 0;
  try {
    const entries = await fs.readdir(UPLOAD_DIR, { recursive: true, withFileTypes: true });
    const sizes = await Promise.all(
      entries.filter((e) => e.isFile()).map((e) => fs.stat(path.join(e.parentPath, e.name)).then((s) => s.size, () => 0)),
    );
    bytes = sizes.reduce((sum, n) => sum + n, 0);
  } catch {
    // No uploads folder yet: nothing stored.
  }
  return { sessions, bytes };
}

export { RETENTION_HOURS };
