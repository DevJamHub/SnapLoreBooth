import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import type { BoothStatus, Payment, Photo, Session, SessionStatus } from './types';

const DATA_DIR = path.join(process.cwd(), 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Next dev reloads modules on every edit; keep one connection on globalThis.
const globalForDb = globalThis as unknown as { __boothDb?: Database.Database };

function open(): Database.Database {
  const db = new Database(path.join(DATA_DIR, 'booth.db'));
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id            TEXT PRIMARY KEY,
      created_at    TEXT NOT NULL,
      package_id    TEXT NOT NULL,
      package_label TEXT NOT NULL,
      format        TEXT NOT NULL,
      shots         INTEGER NOT NULL,
      price_idr   INTEGER NOT NULL,
      addons        TEXT NOT NULL DEFAULT '[]',
      status        TEXT NOT NULL DEFAULT 'capturing',
      filter        TEXT NOT NULL DEFAULT 'original',
      template      TEXT NOT NULL DEFAULT 'plain',
      prints        INTEGER NOT NULL DEFAULT 1,
      delivered_to  TEXT,
      strip_file    TEXT
    );
    CREATE TABLE IF NOT EXISTS photos (
      id         TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      idx        INTEGER NOT NULL,
      file       TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (session_id, idx)
    );
    CREATE INDEX IF NOT EXISTS idx_photos_session ON photos(session_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at DESC);
    CREATE TABLE IF NOT EXISTS payments (
      id          TEXT PRIMARY KEY,
      session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      amount_idr  INTEGER NOT NULL,
      qr_string   TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'pending',
      expires_at  TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      paid_at     TEXT,
      provider_payment_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_payments_session ON payments(session_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS events (
      id           TEXT PRIMARY KEY,
      slug         TEXT NOT NULL UNIQUE,
      name         TEXT NOT NULL,
      created_at   TEXT NOT NULL,
      payment_mode TEXT NOT NULL DEFAULT 'qris',
      gallery      INTEGER NOT NULL DEFAULT 1,
      print_mode   TEXT NOT NULL DEFAULT 'simulated',
      prices       TEXT NOT NULL DEFAULT '{}'
    );
  `);
  // `next build` opens the database from several workers at once. An IMMEDIATE transaction
  // takes the write lock before checking, so the others wait and then find the column there.
  db.transaction(() => {
    addColumn(db, 'sessions', 'event_id', 'event_id TEXT');
    addColumn(db, 'sessions', 'requires_payment', 'requires_payment INTEGER NOT NULL DEFAULT 1');
    addColumn(db, 'sessions', 'in_gallery', 'in_gallery INTEGER NOT NULL DEFAULT 1');
    addColumn(db, 'photos', 'clip_file', 'clip_file TEXT');
    addColumn(db, 'sessions', 'live_file', 'live_file TEXT');
    addColumn(db, 'events', 'ended_at', 'ended_at TEXT');
  }).immediate();
  db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_event ON sessions(event_id, created_at DESC)');
  return db;
}

/** SQLite has no ADD COLUMN IF NOT EXISTS; booths upgraded in place keep their data. */
function addColumn(db: Database.Database, table: string, column: string, ddl: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (columns.some((c) => c.name === column)) return;
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  } catch (error) {
    // Another process won the race between our check and the ALTER; the column is there.
    if (!(error instanceof Error && /duplicate column name/i.test(error.message))) throw error;
  }
}

export const db: Database.Database = globalForDb.__boothDb ?? open();
if (process.env.NODE_ENV !== 'production') globalForDb.__boothDb = db;

interface SessionRow extends Omit<Session, 'addons' | 'photo_count' | 'requires_payment' | 'in_gallery'> {
  addons: string;
  photo_count: number;
  requires_payment: number;
  in_gallery: number;
}

function hydrate(row: SessionRow | undefined): Session | null {
  if (!row) return null;
  return {
    ...row,
    addons: JSON.parse(row.addons) as string[],
    requires_payment: row.requires_payment === 1,
    in_gallery: row.in_gallery === 1,
  };
}

const SELECT_SESSION = `
  SELECT s.*, (SELECT COUNT(*) FROM photos p WHERE p.session_id = s.id) AS photo_count
  FROM sessions s
`;

export function createSession(input: {
  id: string;
  packageId: string;
  packageLabel: string;
  format: string;
  shots: number;
  priceIdr: number;
  addons: string[];
  prints: number;
  eventId: string;
  requiresPayment: boolean;
}): Session {
  db.prepare(
    `INSERT INTO sessions (id, created_at, package_id, package_label, format, shots, price_idr, addons, prints, event_id, requires_payment)
     VALUES (@id, @created_at, @package_id, @package_label, @format, @shots, @price_idr, @addons, @prints, @event_id, @requires_payment)`,
  ).run({
    id: input.id,
    created_at: new Date().toISOString(),
    package_id: input.packageId,
    package_label: input.packageLabel,
    format: input.format,
    shots: input.shots,
    price_idr: input.priceIdr,
    addons: JSON.stringify(input.addons),
    prints: input.prints,
    event_id: input.eventId,
    requires_payment: input.requiresPayment ? 1 : 0,
  });
  return getSession(input.id)!;
}

export function getSession(id: string): Session | null {
  return hydrate(db.prepare(`${SELECT_SESSION} WHERE s.id = ?`).get(id) as SessionRow | undefined);
}

export function listSessions(limit = 50): Session[] {
  const rows = db.prepare(`${SELECT_SESSION} ORDER BY s.created_at DESC LIMIT ?`).all(limit) as SessionRow[];
  return rows.map((r) => hydrate(r)!);
}

export function updateSession(
  id: string,
  patch: Partial<Pick<Session, 'status' | 'filter' | 'template' | 'prints' | 'delivered_to' | 'strip_file' | 'in_gallery' | 'live_file'>>,
): Session | null {
  const fields = Object.keys(patch) as (keyof typeof patch)[];
  if (fields.length === 0) return getSession(id);
  const assignments = fields.map((f) => `${f} = @${f}`).join(', ');
  // SQLite stores booleans as 0/1 and better-sqlite3 refuses to bind a JS boolean.
  const values = Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, typeof v === 'boolean' ? (v ? 1 : 0) : v]));
  db.prepare(`UPDATE sessions SET ${assignments} WHERE id = @id`).run({ id, ...values });
  return getSession(id);
}

/** Boards a guest agreed to show, newest first, for the event's live gallery. */
export function galleryItems(eventId: string, limit = 120): { id: string; strip_file: string; live_file: string | null; created_at: string }[] {
  return db
    .prepare(
      `SELECT id, strip_file, live_file, created_at FROM sessions
       WHERE event_id = ? AND in_gallery = 1 AND strip_file IS NOT NULL AND status IN ('printing', 'done')
       ORDER BY created_at DESC LIMIT ?`,
    )
    .all(eventId, limit) as { id: string; strip_file: string; live_file: string | null; created_at: string }[];
}

export function addPhoto(sessionId: string, idx: number, file: string): Photo {
  const id = `${sessionId}-${idx}`;
  db.prepare(
    `INSERT INTO photos (id, session_id, idx, file, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (session_id, idx) DO UPDATE SET file = excluded.file, created_at = excluded.created_at, clip_file = NULL`,
  ).run(id, sessionId, idx, file, new Date().toISOString());
  return db.prepare('SELECT * FROM photos WHERE session_id = ? AND idx = ?').get(sessionId, idx) as Photo;
}

/** Attaches the short video recorded during a shot's countdown. False when the still is missing. */
export function setClip(sessionId: string, idx: number, file: string): boolean {
  return db.prepare('UPDATE photos SET clip_file = ? WHERE session_id = ? AND idx = ?').run(file, sessionId, idx).changes > 0;
}

export function listPhotos(sessionId: string): Photo[] {
  return db.prepare('SELECT * FROM photos WHERE session_id = ? ORDER BY idx ASC').all(sessionId) as Photo[];
}

export function createPayment(input: {
  id: string;
  sessionId: string;
  amountIdr: number;
  qrString: string;
  expiresAt: string;
}): Payment {
  db.prepare(
    `INSERT INTO payments (id, session_id, amount_idr, qr_string, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(input.id, input.sessionId, input.amountIdr, input.qrString, input.expiresAt, new Date().toISOString());
  return getPayment(input.id)!;
}

export function getPayment(id: string): Payment | null {
  return (db.prepare('SELECT * FROM payments WHERE id = ?').get(id) as Payment | undefined) ?? null;
}

/** The newest QR issued for a session — the only one the kiosk is showing. */
export function latestPayment(sessionId: string): Payment | null {
  return (
    (db
      .prepare('SELECT * FROM payments WHERE session_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(sessionId) as Payment | undefined) ?? null
  );
}

export function isSessionPaid(sessionId: string): boolean {
  return db.prepare(`SELECT 1 FROM payments WHERE session_id = ? AND status = 'paid' LIMIT 1`).get(sessionId) !== undefined;
}

/** Idempotent: the webhook and the kiosk's poll may both report the same payment. */
export function markPaymentPaid(id: string, providerPaymentId: string): Payment | null {
  db.prepare(
    `UPDATE payments SET status = 'paid', paid_at = ?, provider_payment_id = ? WHERE id = ? AND status != 'paid'`,
  ).run(new Date().toISOString(), providerPaymentId, id);
  return getPayment(id);
}

const PAPER_ROLL_CAPACITY = 400;

function startOfToday(): string {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return start.toISOString();
}

/** Money that actually settled today — not sessions that merely reached the last screen. */
export function revenueToday(): { amountIdr: number; payments: number } {
  const row = db
    .prepare(`SELECT COALESCE(SUM(amount_idr), 0) AS amount, COUNT(*) AS n FROM payments WHERE status = 'paid' AND paid_at >= ?`)
    .get(startOfToday()) as { amount: number; n: number };
  return { amountIdr: row.amount, payments: row.n };
}

/** A print job older than this is a guest who walked away, not a printer still busy. */
const SPOOL_WINDOW_MS = 10 * 60 * 1000;

export function boothStatus(): BoothStatus {
  const today = startOfToday();

  const printsToday =
    (db.prepare(`SELECT COALESCE(SUM(prints), 0) AS n FROM sessions WHERE created_at >= ? AND status IN ('printing','done')`).get(today) as { n: number }).n;
  const sessionsToday =
    (db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE created_at >= ?').get(today) as { n: number }).n;

  const remaining = Math.max(PAPER_ROLL_CAPACITY - printsToday, 0);
  const paperPercent = Math.round((remaining / PAPER_ROLL_CAPACITY) * 100);

  const spoolSince = new Date(Date.now() - SPOOL_WINDOW_MS).toISOString();
  const spooling =
    (db.prepare(`SELECT COUNT(*) AS n FROM sessions WHERE status = 'printing' AND created_at >= ?`).get(spoolSince) as { n: number }).n > 0;

  return {
    paper_percent: paperPercent,
    prints_today: printsToday,
    prints_remaining: remaining,
    sessions_today: sessionsToday,
    printer: spooling ? 'spooling' : paperPercent < 15 ? 'low_media' : 'ready',
  };
}

export type { Session, SessionStatus };
