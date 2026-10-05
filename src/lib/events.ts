import { db } from './db';
import { ADDONS, PACKAGES } from './packages';
import type { BoothEvent, PaymentMode, PrintMode } from './types';

interface EventRow extends Omit<BoothEvent, 'gallery' | 'prices' | 'mirror'> {
  gallery: number;
  mirror: number;
  prices: string;
}

const PAYMENT_MODES: PaymentMode[] = ['qris', 'free'];
const PRINT_MODES: PrintMode[] = ['simulated', 'airprint'];
const MAX_PRICE_IDR = 10_000_000;

function hydrate(row: EventRow | undefined): BoothEvent | null {
  if (!row) return null;
  return { ...row, gallery: row.gallery === 1, mirror: row.mirror === 1, prices: JSON.parse(row.prices) as Record<string, number> };
}

/** Slugs end in random characters: a gallery link should not be guessable from the event name. */
function makeSlug(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const suffix = Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => alphabet[b % alphabet.length]).join('');
  return `${base || 'acara'}-${suffix}`;
}

export function defaultPrices(): Record<string, number> {
  return Object.fromEntries([...PACKAGES.map((p) => [p.id, p.priceIdr]), ...ADDONS.map((a) => [a.id, a.priceIdr])]);
}

export function priceOf(event: BoothEvent, id: string): number {
  return event.prices[id] ?? defaultPrices()[id] ?? 0;
}

export function eventBySlug(slug: string): BoothEvent | null {
  return hydrate(db.prepare('SELECT * FROM events WHERE slug = ?').get(slug) as EventRow | undefined);
}

export function eventById(id: string): BoothEvent | null {
  return hydrate(db.prepare('SELECT * FROM events WHERE id = ?').get(id) as EventRow | undefined);
}

export function listEvents(limit = 20): BoothEvent[] {
  return (db.prepare('SELECT * FROM events ORDER BY created_at DESC LIMIT ?').all(limit) as EventRow[]).map((r) => hydrate(r)!);
}

export function startEvent(input: { name: string; paymentMode?: PaymentMode; gallery?: boolean; printMode?: PrintMode }): BoothEvent {
  const id = `EV${Date.now().toString(36).toUpperCase()}`;
  const previous = latest();
  // Only one event runs at a time: starting the next one ends the last, opening its gallery.
  db.prepare('UPDATE events SET ended_at = ? WHERE ended_at IS NULL').run(new Date().toISOString());
  db.prepare(
    `INSERT INTO events (id, slug, name, created_at, payment_mode, gallery, print_mode, prices, mirror)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    makeSlug(input.name),
    input.name,
    new Date().toISOString(),
    input.paymentMode ?? previous?.payment_mode ?? (process.env.PAYMENT === 'off' ? 'free' : 'qris'),
    (input.gallery ?? previous?.gallery ?? true) ? 1 : 0,
    input.printMode ?? previous?.print_mode ?? 'simulated',
    // A new gig starts from the last one's prices; the operator rarely changes them.
    JSON.stringify(previous?.prices ?? defaultPrices()),
    // Guests see themselves as in a mirror unless the operator chose otherwise.
    (previous?.mirror ?? true) ? 1 : 0,
  );
  return eventById(id)!;
}

function latest(): BoothEvent | null {
  return hydrate(db.prepare('SELECT * FROM events ORDER BY created_at DESC LIMIT 1').get() as EventRow | undefined);
}

/** The event new sessions join. A fresh booth gets one named after EVENT_NAME. */
export function currentEvent(): BoothEvent {
  return latest() ?? startEvent({ name: process.env.EVENT_NAME ?? 'SnaploreBooth' });
}

export class EventInputError extends Error {}

/** Validates an operator's edit; anything not recognised is rejected rather than ignored. */
export function updateEvent(id: string, body: Record<string, unknown>): BoothEvent {
  const event = eventById(id);
  if (!event) throw new EventInputError('acara tidak ditemukan');

  const name = body.name === undefined ? event.name : String(body.name).trim().slice(0, 40);
  if (!name) throw new EventInputError('nama acara wajib diisi');

  const paymentMode = (body.payment_mode ?? event.payment_mode) as PaymentMode;
  if (!PAYMENT_MODES.includes(paymentMode)) throw new EventInputError('mode pembayaran tidak dikenal');

  const printMode = (body.print_mode ?? event.print_mode) as PrintMode;
  if (!PRINT_MODES.includes(printMode)) throw new EventInputError('mode cetak tidak dikenal');

  const gallery = body.gallery === undefined ? event.gallery : body.gallery === true;
  if (body.mirror !== undefined && typeof body.mirror !== 'boolean') throw new EventInputError('mirror harus true/false');
  const mirror = body.mirror === undefined ? event.mirror : body.mirror === true;
  // `ended: true` closes the event and opens its gallery; `false` reopens one ended by mistake.
  const endedAt =
    body.ended === undefined ? event.ended_at : body.ended === true ? (event.ended_at ?? new Date().toISOString()) : null;

  const prices = { ...event.prices };
  if (body.prices !== undefined) {
    if (typeof body.prices !== 'object' || body.prices === null) throw new EventInputError('harga tidak valid');
    const known = new Set(Object.keys(defaultPrices()));
    for (const [key, raw] of Object.entries(body.prices as Record<string, unknown>)) {
      if (!known.has(key)) throw new EventInputError(`harga untuk "${key}" tidak dikenal`);
      const value = Number(raw);
      if (!Number.isInteger(value) || value < 0 || value > MAX_PRICE_IDR) {
        throw new EventInputError('harga harus bilangan bulat Rupiah');
      }
      // QRIS refuses amounts under Rp1.500, so a package priced below that could never be paid.
      if (PACKAGES.some((p) => p.id === key) && value > 0 && value < 1500) {
        throw new EventInputError('harga paket minimal Rp1.500 (batas QRIS), atau 0 untuk gratis');
      }
      prices[key] = value;
    }
  }

  db.prepare(
    `UPDATE events SET name = ?, payment_mode = ?, gallery = ?, print_mode = ?, prices = ?, ended_at = ?, mirror = ? WHERE id = ?`,
  ).run(name, paymentMode, gallery ? 1 : 0, printMode, JSON.stringify(prices), endedAt, mirror ? 1 : 0, id);
  return eventById(id)!;
}

export { PAYMENT_MODES, PRINT_MODES };
