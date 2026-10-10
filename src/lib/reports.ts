import { db } from './db';
import { currentEvent } from './events';
import { frameById } from './frames';
import { BEAUTY, FILTERS, TEMPLATES } from './packages';

export type RangeId = 'today' | '7d' | '30d' | 'event' | 'all';

export const RANGES: { id: RangeId; label: string }[] = [
  { id: 'today', label: 'Hari ini' },
  { id: '7d', label: '7 hari' },
  { id: '30d', label: '30 hari' },
  { id: 'event', label: 'Acara ini' },
  { id: 'all', label: 'Semua' },
];

export function rangeOf(value: string | undefined): RangeId {
  return RANGES.some((r) => r.id === value) ? (value as RangeId) : '7d';
}

/** The SQL condition on sessions (`s.`) for a range, with its parameters. */
function window(range: RangeId): { where: string; params: unknown[]; since: Date | null } {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (range === 'today') return { where: 's.created_at >= ?', params: [start.toISOString()], since: start };
  if (range === '7d' || range === '30d') {
    start.setDate(start.getDate() - (range === '7d' ? 6 : 29));
    return { where: 's.created_at >= ?', params: [start.toISOString()], since: start };
  }
  if (range === 'event') return { where: 's.event_id = ?', params: [currentEvent().id], since: null };
  return { where: '1 = 1', params: [], since: null };
}

export interface SessionRow {
  id: string;
  created_at: string;
  event_name: string | null;
  package_label: string;
  price_idr: number;
  requires_payment: number;
  prints: number;
  reprints: number;
  status: string;
  filter: string;
  beauty: string;
  template: string;
  in_gallery: number;
  mirror: number;
  photo_count: number;
  paid_idr: number;
  paid_at: string | null;
  done: number;
  voucher: string | null;
  discount_idr: number;
}

/** Every session in the range with what was paid for it, newest first. */
export function sessionsIn(range: RangeId): SessionRow[] {
  const { where, params } = window(range);
  return db
    .prepare(
      `SELECT s.id, s.created_at, e.name AS event_name, s.package_label, s.price_idr, s.requires_payment, s.prints, s.reprints, s.status,
              s.filter, s.beauty, s.template, s.in_gallery, s.mirror, s.voucher, s.discount_idr,
              (SELECT COUNT(*) FROM photos p WHERE p.session_id = s.id) AS photo_count,
              COALESCE((SELECT SUM(amount_idr) FROM payments p WHERE p.session_id = s.id AND p.status = 'paid'), 0) AS paid_idr,
              (SELECT MAX(paid_at) FROM payments p WHERE p.session_id = s.id AND p.status = 'paid') AS paid_at,
              (s.strip_file IS NOT NULL) AS done
       FROM sessions s LEFT JOIN events e ON e.id = s.event_id
       WHERE ${where} ORDER BY s.created_at DESC`,
    )
    .all(...params) as SessionRow[];
}

export interface Report {
  range: RangeId;
  revenue: number;
  sessions: number;
  /** Sessions that reached a printed sheet. */
  finished: number;
  paid: number;
  /** Paid sessions that never left the payment screen. */
  unpaid: number;
  free: number;
  prints: number;
  /** Revenue over paid sessions. */
  average: number;
  /** Day by day, oldest first; only for ranges measured in days. */
  days: { day: string; label: string; revenue: number; sessions: number }[];
  /** Sessions started in each hour of the day, 0–23. */
  hours: number[];
  packages: { label: string; sessions: number; revenue: number }[];
  frames: { label: string; count: number }[];
  filters: { label: string; count: number }[];
  beauty: { label: string; count: number }[];
  /** Promo codes on sessions that went ahead (paid, or made free by the code), most used first. */
  promos: { label: string; count: number; discount: number }[];
  /** What the codes took off those sessions. */
  discount: number;
}

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function tally<T>(rows: T[], key: (row: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(key(row), (counts.get(key(row)) ?? 0) + 1);
  return counts;
}

const ranked = (counts: Map<string, number>, label: (key: string) => string, limit = 6) =>
  [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, count]) => ({ label: label(key), count }));

function frameLabel(id: string): string {
  const builtIn = TEMPLATES.find((t) => t.id === id);
  if (builtIn) return builtIn.label;
  const frame = frameById(id);
  return frame ? (frame.theme ? `${frame.theme} · ${frame.name}` : frame.name) : 'Frame terhapus';
}

export function buildReport(range: RangeId): Report {
  const rows = sessionsIn(range);
  const finished = rows.filter((r) => r.done);
  const paidRows = rows.filter((r) => r.paid_idr > 0);
  const revenue = paidRows.reduce((sum, r) => sum + r.paid_idr, 0);

  const report: Report = {
    range,
    revenue,
    sessions: rows.length,
    finished: finished.length,
    paid: paidRows.length,
    unpaid: rows.filter((r) => r.requires_payment && r.paid_idr === 0).length,
    free: rows.filter((r) => !r.requires_payment).length,
    prints: finished.reduce((sum, r) => sum + r.prints + r.reprints, 0),
    average: paidRows.length ? Math.round(revenue / paidRows.length) : 0,
    days: [],
    hours: Array.from({ length: 24 }, () => 0),
    packages: [],
    frames: ranked(tally(finished, (r) => r.template), frameLabel),
    filters: ranked(tally(finished, (r) => r.filter), (id) => FILTERS.find((f) => f.id === id)?.label ?? id),
    beauty: ranked(tally(finished, (r) => r.beauty), (id) => BEAUTY.find((b) => b.id === id)?.label ?? id),
    promos: [],
    discount: 0,
  };

  // A code typed by a guest who then walked away at QRIS took nothing off anything.
  const promoted = rows.filter((r) => r.voucher && (r.paid_idr > 0 || !r.requires_payment));
  const promos = new Map<string, { count: number; discount: number }>();
  for (const row of promoted) {
    const entry = promos.get(row.voucher!) ?? { count: 0, discount: 0 };
    entry.count++;
    entry.discount += row.discount_idr;
    promos.set(row.voucher!, entry);
    report.discount += row.discount_idr;
  }
  report.promos = [...promos.entries()].map(([label, v]) => ({ label, ...v })).sort((a, b) => b.count - a.count);

  for (const row of rows) report.hours[new Date(row.created_at).getHours()]++;

  const packages = new Map<string, { sessions: number; revenue: number }>();
  for (const row of rows) {
    const entry = packages.get(row.package_label) ?? { sessions: 0, revenue: 0 };
    entry.sessions++;
    entry.revenue += row.paid_idr;
    packages.set(row.package_label, entry);
  }
  report.packages = [...packages.entries()].map(([label, v]) => ({ label, ...v })).sort((a, b) => b.sessions - a.sessions);

  const { since } = window(range);
  if (since && range !== 'today') {
    const byDay = new Map<string, { revenue: number; sessions: number }>();
    for (const row of rows) {
      const key = dayKey(new Date(row.created_at));
      const entry = byDay.get(key) ?? { revenue: 0, sessions: 0 };
      entry.sessions++;
      entry.revenue += row.paid_idr;
      byDay.set(key, entry);
    }
    for (const d = new Date(since); d <= new Date(); d.setDate(d.getDate() + 1)) {
      const key = dayKey(d);
      report.days.push({
        day: key,
        label: d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }),
        ...(byDay.get(key) ?? { revenue: 0, sessions: 0 }),
      });
    }
  }
  return report;
}

const csvCell = (value: unknown) => {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** The range's sessions as CSV (Excel and Google Sheets open it; the BOM keeps the accents). */
export function sessionsCsv(range: RangeId): string {
  const header = ['Kode', 'Waktu', 'Acara', 'Paket', 'Harga (Rp)', 'Dibayar (Rp)', 'Status bayar', 'Dibayar pada', 'Lembar', 'Cetak ulang', 'Selesai', 'Bingkai', 'Gaya warna', 'Beauty', 'Cermin', 'Di galeri', 'Jumlah foto', 'Kode promo', 'Diskon (Rp)'];
  const lines = sessionsIn(range).map((r) =>
    [
      r.id,
      new Date(r.created_at).toLocaleString('id-ID'),
      r.event_name ?? '',
      r.package_label,
      r.requires_payment ? r.price_idr : 0,
      r.paid_idr,
      !r.requires_payment ? 'Gratis' : r.paid_idr > 0 ? 'Lunas' : 'Belum bayar',
      r.paid_at ? new Date(r.paid_at).toLocaleString('id-ID') : '',
      r.prints,
      r.reprints,
      r.done ? 'Ya' : 'Tidak',
      frameLabel(r.template),
      FILTERS.find((f) => f.id === r.filter)?.label ?? r.filter,
      BEAUTY.find((b) => b.id === r.beauty)?.label ?? r.beauty,
      r.mirror ? 'Ya' : 'Tidak',
      r.in_gallery ? 'Ya' : 'Tidak',
      r.photo_count,
      r.voucher ?? '',
      r.discount_idr,
    ]
      .map(csvCell)
      .join(','),
  );
  return '﻿' + [header.join(','), ...lines].join('\r\n') + '\r\n';
}
