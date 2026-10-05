import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { UPLOAD_DIR, db } from '@/lib/db';
import { eventById } from '@/lib/events';
import { rangeOf, sessionsCsv } from '@/lib/reports';
import { zipStream, type ZipEntry } from '@/lib/zip';

export const dynamic = 'force-dynamic';

const local = (relative: string) => async () => {
  const target = path.join(UPLOAD_DIR, relative);
  if (!target.startsWith(UPLOAD_DIR + path.sep)) return null;
  return fs.readFile(target);
};

const stamp = () => new Date().toISOString().slice(0, 10);

/**
 * Operator-only (see middleware).
 * `?kind=csv&r=7d` — the sessions in a range as a spreadsheet.
 * `?kind=zip&event=<id>&all=1` — an event's finished sheets as a ZIP; `all=1` adds every
 * photo and video, one folder per session. Only what is still on this server's disk.
 * `?kind=db` — a backup of the database: events, sessions, payments, frames, settings.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const kind = params.get('kind');

  if (kind === 'csv') {
    const range = rangeOf(params.get('r') ?? undefined);
    return new NextResponse(sessionsCsv(range), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="snaplorebooth-sesi-${range}-${stamp()}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  if (kind === 'zip') {
    const event = eventById(params.get('event') ?? '');
    if (!event) return NextResponse.json({ error: 'acara tidak ditemukan' }, { status: 404 });
    const everything = params.get('all') === '1';
    const sessions = db
      .prepare('SELECT id, created_at, strip_file, live_file FROM sessions WHERE event_id = ? AND strip_file IS NOT NULL ORDER BY created_at ASC')
      .all(event.id) as { id: string; created_at: string; strip_file: string; live_file: string | null }[];
    const photosOf = db.prepare('SELECT idx, file, clip_file FROM photos WHERE session_id = ? ORDER BY idx');

    const entries: ZipEntry[] = [];
    for (const s of sessions) {
      const at = new Date(s.created_at);
      const time = `${String(at.getHours()).padStart(2, '0')}${String(at.getMinutes()).padStart(2, '0')}`;
      const ext = (file: string) => path.extname(file) || '.jpeg';
      if (!everything) {
        entries.push({ name: `${time}-${s.id}${ext(s.strip_file)}`, read: local(s.strip_file), date: at });
        continue;
      }
      const folder = `${time}-${s.id}`;
      entries.push({ name: `${folder}/lembar${ext(s.strip_file)}`, read: local(s.strip_file), date: at });
      if (s.live_file) entries.push({ name: `${folder}/video-lembar${ext(s.live_file)}`, read: local(s.live_file), date: at });
      for (const p of photosOf.all(s.id) as { idx: number; file: string; clip_file: string | null }[]) {
        entries.push({ name: `${folder}/foto-${p.idx}${ext(p.file)}`, read: local(p.file), date: at });
        if (p.clip_file) entries.push({ name: `${folder}/video-${p.idx}${ext(p.clip_file)}`, read: local(p.clip_file), date: at });
      }
    }
    if (entries.length === 0) return NextResponse.json({ error: 'acara ini belum punya foto jadi' }, { status: 404 });

    const name = `${event.slug.replace(/-[a-z0-9]+$/, '')}-${everything ? 'semua' : 'lembar'}-${stamp()}.zip`;
    return new Response(zipStream(entries), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${name}"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  if (kind === 'db') {
    // A consistent copy taken by SQLite itself, safe while guests keep using the booth.
    const copy = path.join(os.tmpdir(), `snaplorebooth-backup-${Date.now()}.db`);
    try {
      await db.backup(copy);
      const bytes = await fs.readFile(copy);
      return new NextResponse(new Uint8Array(bytes), {
        headers: {
          'Content-Type': 'application/vnd.sqlite3',
          'Content-Disposition': `attachment; filename="snaplorebooth-database-${stamp()}.db"`,
          'Content-Length': String(bytes.byteLength),
          'Cache-Control': 'no-store',
        },
      });
    } finally {
      await fs.rm(copy, { force: true });
    }
  }

  return NextResponse.json({ error: 'kind harus csv, zip, atau db' }, { status: 400 });
}
