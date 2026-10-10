import { db } from './db';
import { mediaUrl } from './format';

/**
 * Konsol → Data: every table, read-only, a page at a time. Table and column names are
 * spliced into SQL, so they only ever come from the database's own catalogue, never the URL.
 */

export const DATA_PAGE_SIZE = 50;

export interface DataTable {
  name: string;
  rows: number;
}

export interface DataColumn {
  name: string;
  type: string;
  pk: boolean;
}

export type DataRow = Record<string, unknown>;

export interface DataPage {
  table: string;
  columns: DataColumn[];
  rows: DataRow[];
  /** Rows matching the search, across every page. */
  total: number;
  /** 1-based, clamped to the pages there are. */
  page: number;
  pages: number;
  q: string;
  sort: string;
  dir: 'asc' | 'desc';
}

const TABLES = `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`;

export function listTables(): DataTable[] {
  const names = db.prepare(`${TABLES} ORDER BY name`).pluck().all() as string[];
  return names.map((name) => ({ name, rows: db.prepare(`SELECT COUNT(*) FROM "${name}"`).pluck().get() as number }));
}

/** One page of a table, searched in every column. Null when there is no such table. */
export function readTable(table: string, opts: { q?: string; sort?: string; dir?: string; page?: number }): DataPage | null {
  if (!db.prepare(`${TABLES} AND name = ?`).get(table)) return null;

  const columns = (db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string; type: string; pk: number }[]).map((c) => ({
    name: c.name,
    type: c.type,
    pk: c.pk > 0,
  }));
  const names = columns.map((c) => c.name);
  const sort = opts.sort && names.includes(opts.sort) ? opts.sort : names.includes('created_at') ? 'created_at' : (columns.find((c) => c.pk)?.name ?? names[0]);
  // Newest first unless asked otherwise: what an operator looks for is usually the last guest.
  const dir = opts.dir === 'asc' || opts.dir === 'desc' ? opts.dir : sort === 'created_at' ? 'desc' : 'asc';

  const q = opts.q?.trim() ?? '';
  const where = q ? `WHERE ${names.map((n) => `CAST("${n}" AS TEXT) LIKE @q ESCAPE '\\'`).join(' OR ')}` : '';
  const args = q ? [{ q: `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` }] : [];

  const total = db.prepare(`SELECT COUNT(*) FROM "${table}" ${where}`).pluck().get(...args) as number;
  const pages = Math.max(1, Math.ceil(total / DATA_PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.floor(opts.page ?? 1) || 1), pages);
  const rows = db
    .prepare(`SELECT * FROM "${table}" ${where} ORDER BY "${sort}" ${dir}, rowid ${dir} LIMIT ${DATA_PAGE_SIZE} OFFSET ${(page - 1) * DATA_PAGE_SIZE}`)
    .all(...args) as DataRow[];

  return { table, columns, rows, total, page, pages, q, sort, dir };
}

const STORED_FILE = /^[\w-]+\/[\w.-]+\.(jpe?g|png|webp|gif|mp4|webm|mov)$/i;

/** Where a cell's stored photo or clip can be seen, when the cell names one. */
export function cellMedia(table: string, column: string, value: unknown, row: DataRow): { kind: 'image' | 'video'; src: string } | null {
  if (typeof value !== 'string') return null;
  // Frame PNGs live outside the guests' uploads and are served by id.
  if (table === 'frames' && column === 'file') return { kind: 'image', src: `/api/frames/${encodeURIComponent(String(row.id))}` };
  const match = STORED_FILE.exec(value);
  if (!match) return null;
  return { kind: /^(mp4|webm|mov)$/i.test(match[1]) ? 'video' : 'image', src: mediaUrl(value) };
}
