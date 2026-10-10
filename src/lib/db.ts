import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import type { BoothStatus, Payment, Photo, Session, SessionStatus } from './types';

/** BOOTH_DATA_DIR keeps a test run (or a second booth on one machine) out of the real data. */
export const DATA_DIR = process.env.BOOTH_DATA_DIR ? path.resolve(process.env.BOOTH_DATA_DIR) : path.join(process.cwd(), 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
/** Operator-uploaded frame PNGs. Not guest data, so retention and "hapus foto tamu" leave them. */
export const FRAME_DIR = path.join(DATA_DIR, 'frames');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(FRAME_DIR, { recursive: true });

// Next dev reloads modules on every edit; keep one connection on globalThis.
const globalForDb = globalThis as unknown as { __boothDb?: Database.Database };

function open(): Database.Database {
  const db = new Database(path.join(DATA_DIR, 'booth.db'));
  useWal(db);
  // `next build` opens the database from several workers at once. Schema changes run in one
  // IMMEDIATE transaction: it takes the write lock before reading anything, so the others wait
  // for it and then find everything there. Plain statements would each read first and then
  // ask for the write lock, and two doing that at once fail at once (SQLITE_BUSY) instead of
  // waiting, since neither could ever get it.
  db.transaction(() => {
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
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS vouchers (
      code       TEXT PRIMARY KEY,
      kind       TEXT NOT NULL,
      value      INTEGER NOT NULL DEFAULT 0,
      max_uses   INTEGER,
      expires_at TEXT,
      active     INTEGER NOT NULL DEFAULT 1,
      note       TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS contacts (
      id         TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      event_id   TEXT,
      name       TEXT NOT NULL,
      phone      TEXT NOT NULL DEFAULT '',
      instagram  TEXT NOT NULL DEFAULT '',
      answer     TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS frames (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      format     TEXT NOT NULL,
      file       TEXT NOT NULL,
      slots      TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    `);
    addColumn(db, 'sessions', 'event_id', 'event_id TEXT');
    addColumn(db, 'sessions', 'requires_payment', 'requires_payment INTEGER NOT NULL DEFAULT 1');
    addColumn(db, 'sessions', 'in_gallery', 'in_gallery INTEGER NOT NULL DEFAULT 1');
    addColumn(db, 'photos', 'clip_file', 'clip_file TEXT');
    addColumn(db, 'sessions', 'live_file', 'live_file TEXT');
    addColumn(db, 'events', 'ended_at', 'ended_at TEXT');
    addColumn(db, 'sessions', 'mirror', 'mirror INTEGER NOT NULL DEFAULT 0');
    addColumn(db, 'events', 'mirror', 'mirror INTEGER NOT NULL DEFAULT 0');
    addColumn(db, 'sessions', 'beauty', "beauty TEXT NOT NULL DEFAULT 'off'");
    addColumn(db, 'frames', 'theme', "theme TEXT NOT NULL DEFAULT ''");
    addColumn(db, 'sessions', 'reprints', 'reprints INTEGER NOT NULL DEFAULT 0');
    addColumn(db, 'frames', 'hidden', 'hidden INTEGER NOT NULL DEFAULT 0');
    addColumn(db, 'sessions', 'decor', 'decor TEXT');
    addColumn(db, 'sessions', 'voucher', 'voucher TEXT');
    addColumn(db, 'sessions', 'discount_idr', 'discount_idr INTEGER NOT NULL DEFAULT 0');
    addColumn(db, 'payments', 'purpose', "purpose TEXT NOT NULL DEFAULT 'session'");
    addColumn(db, 'sessions', 'bonus', 'bonus INTEGER NOT NULL DEFAULT 0');
    addColumn(db, 'sessions', 'picks', 'picks TEXT');
    addColumn(db, 'sessions', 'erased_at', 'erased_at TEXT');
    addColumn(db, 'sessions', 'background', "background TEXT NOT NULL DEFAULT 'none'");
    addColumn(db, 'sessions', 'lang', "lang TEXT NOT NULL DEFAULT 'id'");
    addColumn(db, 'payments', 'copies', 'copies INTEGER NOT NULL DEFAULT 0');
    // Guests now switch the mirror themselves, starting mirrored. Done once, so an operator
    // who turns the default off afterwards keeps it off.
    const mirrorDefault = db.prepare(`SELECT 1 FROM settings WHERE key = 'migration.mirror_default_on'`).get();
    if (!mirrorDefault) {
      db.exec(`UPDATE events SET mirror = 1 WHERE ended_at IS NULL`);
      db.exec(`INSERT OR IGNORE INTO settings (key, value) VALUES ('migration.mirror_default_on', '1')`);
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_event ON sessions(event_id, created_at DESC)');
  }).immediate();
  return db;
}

/**
 * Write-ahead logging lets screens read while a photo is being saved. Switching a new file to
 * it needs the file to itself, which another build worker may hold for a moment: then it waits
 * and tries again. Once switched the file stays in WAL, and asking again costs nothing.
 */
function useWal(db: Database.Database) {
  for (let attempt = 1; ; attempt++) {
    try {
      db.pragma('journal_mode = WAL');
      return;
    } catch (error) {
      if ((error as { code?: string }).code !== 'SQLITE_BUSY' || attempt >= 50) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
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

interface SessionRow extends Omit<Session, 'addons' | 'photo_count' | 'requires_payment' | 'in_gallery' | 'mirror' | 'decor' | 'picks'> {
  addons: string;
  decor: string | null;
  picks: string | null;
  photo_count: number;
  requires_payment: number;
  in_gallery: number;
  mirror: number;
}

function hydrate(row: SessionRow | undefined): Session | null {
  if (!row) return null;
  return {
    ...row,
    addons: JSON.parse(row.addons) as string[],
    requires_payment: row.requires_payment === 1,
    in_gallery: row.in_gallery === 1,
    mirror: row.mirror === 1,
    decor: row.decor ? (JSON.parse(row.decor) as Session['decor']) : [],
    picks: row.picks ? (JSON.parse(row.picks) as number[]) : null,
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
  mirror: boolean;
  /** The look and beauty Gaya opens on, and whether the sheet joins the gallery unasked. */
  filter: string;
  beauty: string;
  inGallery: boolean;
  /** A promo code and what it took off `priceIdr` (which is already the price after it). */
  voucher?: string | null;
  discountIdr?: number;
  /** Extra photos to pick the best from. */
  bonus?: number;
  /** The guest's language, for the page their QR opens. */
  lang?: string;
}): Session {
  db.prepare(
    `INSERT INTO sessions (id, created_at, package_id, package_label, format, shots, price_idr, addons, prints, event_id, requires_payment, mirror, filter, beauty, in_gallery, voucher, discount_idr, bonus, lang)
     VALUES (@id, @created_at, @package_id, @package_label, @format, @shots, @price_idr, @addons, @prints, @event_id, @requires_payment, @mirror, @filter, @beauty, @in_gallery, @voucher, @discount_idr, @bonus, @lang)`,
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
    mirror: input.mirror ? 1 : 0,
    filter: input.filter,
    beauty: input.beauty,
    in_gallery: input.inGallery ? 1 : 0,
    voucher: input.voucher ?? null,
    discount_idr: input.discountIdr ?? 0,
    bonus: input.bonus ?? 0,
    lang: input.lang ?? 'id',
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

/** One line of the operator's log: when, which guest, and what they paid. */
export interface SessionLogRow {
  id: string;
  created_at: string;
  status: SessionStatus;
  /** The sheet is made, so it can be printed again. */
  done: boolean;
  price_idr: number;
  requires_payment: boolean;
  paid: boolean;
  in_gallery: boolean;
}

/** The newest sessions, or those whose code contains `search` (any case). */
export function sessionLog(limit = 60, search = ''): SessionLogRow[] {
  const code = search.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const rows = db
    .prepare(
      `SELECT s.id, s.created_at, s.status, s.price_idr, s.requires_payment, s.in_gallery, (s.strip_file IS NOT NULL) AS done,
              EXISTS (SELECT 1 FROM payments p WHERE p.session_id = s.id AND p.status = 'paid') AS paid
       FROM sessions s WHERE s.id LIKE ? ORDER BY s.created_at DESC LIMIT ?`,
    )
    .all(`%${code}%`, limit) as (Omit<SessionLogRow, 'requires_payment' | 'paid' | 'in_gallery' | 'done'> & {
    requires_payment: number;
    paid: number;
    in_gallery: number;
    done: number;
  })[];
  return rows.map((r) => ({ ...r, requires_payment: r.requires_payment === 1, paid: r.paid === 1, in_gallery: r.in_gallery === 1, done: r.done === 1 }));
}

/**
 * A session the guest backed out of before paying or shooting (Ganti paket): nothing to keep,
 * and it would only inflate the day's count. Anything with a photo, a sheet or a QR stays.
 */
export function discardSession(id: string): boolean {
  return (
    db
      .prepare(
        `DELETE FROM sessions WHERE id = ? AND strip_file IS NULL
           AND NOT EXISTS (SELECT 1 FROM photos p WHERE p.session_id = sessions.id)
           AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.session_id = sessions.id)`,
      )
      .run(id).changes > 0
  );
}

/** Shows or hides many sessions in their event's gallery at once; returns how many changed. */
export function setInGallery(ids: string[], inGallery: boolean): number {
  const update = db.prepare('UPDATE sessions SET in_gallery = ? WHERE id = ?');
  return db.transaction(() => ids.reduce((n, id) => n + update.run(inGallery ? 1 : 0, id).changes, 0))();
}

/** Sessions per event, for the console's list of past events. */
export function sessionCounts(): Map<string, number> {
  const rows = db.prepare('SELECT event_id, COUNT(*) AS n FROM sessions WHERE event_id IS NOT NULL GROUP BY event_id').all() as {
    event_id: string;
    n: number;
  }[];
  return new Map(rows.map((r) => [r.event_id, r.n]));
}

export function updateSession(
  id: string,
  patch: Partial<
    Pick<Session, 'status' | 'filter' | 'template' | 'prints' | 'delivered_to' | 'strip_file' | 'in_gallery' | 'live_file' | 'mirror' | 'beauty' | 'decor' | 'picks' | 'background'>
  >,
): Session | null {
  const fields = Object.keys(patch) as (keyof typeof patch)[];
  if (fields.length === 0) return getSession(id);
  const assignments = fields.map((f) => `${f} = @${f}`).join(', ');
  // SQLite stores booleans as 0/1 and better-sqlite3 refuses to bind a JS boolean; lists go as JSON.
  const values = Object.fromEntries(
    Object.entries(patch).map(([k, v]) => [k, typeof v === 'boolean' ? (v ? 1 : 0) : Array.isArray(v) ? (v.length ? JSON.stringify(v) : null) : v]),
  );
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
  /** Extra sheets bought after the print, and how many; the session itself otherwise. */
  extraCopies?: number;
}): Payment {
  db.prepare(
    `INSERT INTO payments (id, session_id, amount_idr, qr_string, expires_at, created_at, purpose, copies)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.sessionId,
    input.amountIdr,
    input.qrString,
    input.expiresAt,
    new Date().toISOString(),
    input.extraCopies ? 'extra' : 'session',
    input.extraCopies ?? 0,
  );
  return getPayment(input.id)!;
}

export function getPayment(id: string): Payment | null {
  return (db.prepare('SELECT * FROM payments WHERE id = ?').get(id) as Payment | undefined) ?? null;
}

/** The newest QR issued for a session (or for its extra sheets) — the only one the kiosk is showing. */
export function latestPayment(sessionId: string, purpose: Payment['purpose'] = 'session'): Payment | null {
  return (
    (db
      .prepare('SELECT * FROM payments WHERE session_id = ? AND purpose = ? ORDER BY created_at DESC LIMIT 1')
      .get(sessionId, purpose) as Payment | undefined) ?? null
  );
}

export function isSessionPaid(sessionId: string): boolean {
  return db.prepare(`SELECT 1 FROM payments WHERE session_id = ? AND status = 'paid' AND purpose = 'session' LIMIT 1`).get(sessionId) !== undefined;
}

/**
 * The guest paid the operator in cash (QRIS failed, or no signal). Recorded as a settled
 * payment like any other, so the booth screen polling it moves on and the revenue counts it.
 */
export function recordCashPayment(sessionId: string, amountIdr: number): Payment {
  const now = new Date().toISOString();
  const id = `TUNAI-${sessionId}-${Date.now().toString(36)}`;
  db.prepare(
    `INSERT INTO payments (id, session_id, amount_idr, qr_string, status, expires_at, created_at, paid_at, provider_payment_id)
     VALUES (?, ?, ?, '', 'paid', ?, ?, ?, 'TUNAI')`,
  ).run(id, sessionId, amountIdr, now, now, now);
  return getPayment(id)!;
}

/** Sheets printed again from the console; the paper count includes them. */
export function addReprints(sessionId: string, copies: number): boolean {
  return db.prepare('UPDATE sessions SET reprints = reprints + ? WHERE id = ?').run(copies, sessionId).changes > 0;
}

/** Idempotent: the webhook and the kiosk's poll may both report the same payment. */
export function markPaymentPaid(id: string, providerPaymentId: string): Payment | null {
  // Settled once, whichever of the webhook and the kiosk's poll gets here first: extra sheets
  // are added to the session in the same step, so they can never be added twice.
  db.transaction(() => {
    const settled = db
      .prepare(`UPDATE payments SET status = 'paid', paid_at = ?, provider_payment_id = ? WHERE id = ? AND status != 'paid'`)
      .run(new Date().toISOString(), providerPaymentId, id).changes;
    const payment = getPayment(id);
    if (settled && payment?.purpose === 'extra' && payment.copies > 0) {
      db.prepare('UPDATE sessions SET prints = prints + ? WHERE id = ?').run(payment.copies, payment.session_id);
    }
  }).immediate();
  return getPayment(id);
}

/** Assumed until the operator records a refill: then the count runs from what they loaded. */
const PAPER_ROLL_CAPACITY = 400;

/** Booth-wide settings that belong to the hardware, not to an event: printer, paper. */
export function getSetting(key: string): string | null {
  return (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? null;
}

export function setSetting(key: string, value: string | null) {
  if (value === null) db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  else db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, value);
}

/** The operator loaded `sheets` sheets just now; the paper count starts again from there. */
export function recordPaperRefill(sheets: number) {
  setSetting('paper.capacity', String(sheets));
  setSetting('paper.loaded_at', new Date().toISOString());
}

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
    (db.prepare(`SELECT COALESCE(SUM(prints + reprints), 0) AS n FROM sessions WHERE created_at >= ? AND status IN ('printing','done')`).get(today) as { n: number }).n;
  const sessionsToday =
    (db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE created_at >= ?').get(today) as { n: number }).n;

  // Since the last refill when one was recorded; otherwise today's prints against a full roll.
  const loadedAt = getSetting('paper.loaded_at');
  const capacity = Number(getSetting('paper.capacity')) || PAPER_ROLL_CAPACITY;
  const printsSinceRefill = loadedAt
    ? (db.prepare(`SELECT COALESCE(SUM(prints + reprints), 0) AS n FROM sessions WHERE created_at >= ? AND status IN ('printing','done')`).get(loadedAt) as { n: number }).n
    : printsToday;
  const remaining = Math.max(capacity - printsSinceRefill, 0);
  const paperPercent = Math.round((remaining / capacity) * 100);

  const spoolSince = new Date(Date.now() - SPOOL_WINDOW_MS).toISOString();
  const spooling =
    (db.prepare(`SELECT COUNT(*) AS n FROM sessions WHERE status = 'printing' AND created_at >= ?`).get(spoolSince) as { n: number }).n > 0;

  return {
    paper_percent: paperPercent,
    prints_today: printsToday,
    prints_remaining: remaining,
    sessions_today: sessionsToday,
    paper_capacity: capacity,
    paper_loaded_at: loadedAt,
    printer: spooling ? 'spooling' : paperPercent < 15 ? 'low_media' : 'ready',
  };
}

export type { Session, SessionStatus };
