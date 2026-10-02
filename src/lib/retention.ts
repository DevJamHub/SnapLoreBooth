import fs from 'node:fs/promises';
import path from 'node:path';
import { db, UPLOAD_DIR } from './db';

/** Guest photos are personal data: the consent copy promises the booth forgets them. */
const RETENTION_HOURS = Number(process.env.RETENTION_HOURS ?? 24);
const THROTTLE_MS = 10 * 60 * 1000;

let lastRun = 0;

export interface PurgeResult {
  sessions: number;
  skipped: boolean;
}

/** Deletes sessions past the retention window along with their stored frames. */
export async function purgeExpired(force = false): Promise<PurgeResult> {
  const now = Date.now();
  if (!force && now - lastRun < THROTTLE_MS) return { sessions: 0, skipped: true };
  lastRun = now;

  const cutoff = new Date(now - RETENTION_HOURS * 3600_000).toISOString();
  const expired = db.prepare('SELECT id FROM sessions WHERE created_at < ?').all(cutoff) as { id: string }[];

  for (const { id } of expired) {
    // Remove the files first: a crash then leaves an orphan row we will retry, not an
    // orphan folder no row points at.
    await fs.rm(path.join(UPLOAD_DIR, id), { recursive: true, force: true });
    db.prepare('DELETE FROM photos WHERE session_id = ?').run(id);
    // The settled record lives in the Xendit dashboard; the booth's copy goes with the session.
    db.prepare('DELETE FROM payments WHERE session_id = ?').run(id);
    db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  }

  return { sessions: expired.length, skipped: false };
}

export { RETENTION_HOURS };
