import { db } from './db';

/**
 * Guests who chose to leave their details on the page the QR opens, for the operator's next
 * promotions. Only with the consent box ticked, and kept apart from the photos: the photos are
 * forgotten on their schedule, these stay until the operator deletes them (or the guest asks).
 */
export interface Contact {
  id: string;
  session_id: string;
  event_id: string | null;
  name: string;
  phone: string;
  instagram: string;
  /** The guest's answer to the operator's one question; empty when none was asked or given. */
  answer: string;
  created_at: string;
}

/** A group of friends may each leave theirs; more than this from one sheet is not friends. */
export const MAX_CONTACTS_PER_SESSION = 8;

export class ContactInputError extends Error {}

/** Indonesian numbers as people type them: 08…, +62…, 62…, with spaces or dashes. */
function cleanPhone(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) return '';
  const digits = raw.replace(/[\s.-]/g, '');
  if (!/^\+?\d{8,15}$/.test(digits)) throw new ContactInputError('Nomor WhatsApp belum benar.');
  return digits;
}

function cleanInstagram(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) return '';
  const handle = raw.trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/\/.*$/, '');
  if (!/^[A-Za-z0-9._]{1,30}$/.test(handle)) throw new ContactInputError('Username Instagram belum benar.');
  return handle;
}

export function saveContact(
  session: { id: string; event_id: string | null },
  input: Record<string, unknown>,
  answers: string[],
): Contact {
  if (input.consent !== true) throw new ContactInputError('Centang persetujuan dulu, ya.');
  const name = typeof input.name === 'string' ? input.name.replace(/\s+/g, ' ').trim().slice(0, 40) : '';
  if (!name) throw new ContactInputError('Tulis namamu dulu, ya.');
  const phone = cleanPhone(input.phone);
  const instagram = cleanInstagram(input.instagram);
  if (!phone && !instagram) throw new ContactInputError('Isi nomor WhatsApp atau Instagram.');
  const answer = typeof input.answer === 'string' && answers.includes(input.answer) ? input.answer : '';

  const count = (db.prepare('SELECT COUNT(*) AS n FROM contacts WHERE session_id = ?').get(session.id) as { n: number }).n;
  if (count >= MAX_CONTACTS_PER_SESSION) throw new ContactInputError('Kontak dari foto ini sudah banyak. Terima kasih!');

  const id = `CT${Date.now().toString(36)}${Array.from(crypto.getRandomValues(new Uint8Array(3)), (b) => (b % 36).toString(36)).join('')}`.toUpperCase();
  db.prepare(
    'INSERT INTO contacts (id, session_id, event_id, name, phone, instagram, answer, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(id, session.id, session.event_id, name, phone, instagram, answer, new Date().toISOString());
  return db.prepare('SELECT * FROM contacts WHERE id = ?').get(id) as Contact;
}

export function listContacts(limit = 500): (Contact & { event_name: string | null })[] {
  return db
    .prepare('SELECT c.*, e.name AS event_name FROM contacts c LEFT JOIN events e ON e.id = c.event_id ORDER BY c.created_at DESC LIMIT ?')
    .all(limit) as (Contact & { event_name: string | null })[];
}

export function contactCount(): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM contacts').get() as { n: number }).n;
}

export function deleteContact(id: string): boolean {
  return db.prepare('DELETE FROM contacts WHERE id = ?').run(id).changes > 0;
}

export function deleteAllContacts(): number {
  return db.prepare('DELETE FROM contacts').run().changes;
}

const csvCell = (value: unknown) => {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** Every contact as CSV for Excel or Sheets; WhatsApp numbers stay text, not numbers. */
export function contactsCsv(): string {
  const header = ['Waktu', 'Acara', 'Nama', 'WhatsApp', 'Instagram', 'Jawaban', 'Kode sesi'];
  const lines = listContacts(100_000).map((c) =>
    [new Date(c.created_at).toLocaleString('id-ID'), c.event_name ?? '', c.name, c.phone ? `'${c.phone}` : '', c.instagram ? `@${c.instagram}` : '', c.answer, c.session_id]
      .map(csvCell)
      .join(','),
  );
  return '﻿' + [header.join(','), ...lines].join('\r\n') + '\r\n';
}
