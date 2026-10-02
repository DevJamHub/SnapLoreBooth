import { NextResponse } from 'next/server';
import { createSession, listSessions, updateSession } from '@/lib/db';
import { currentEvent, priceOf } from '@/lib/events';
import { EXTRA_PRINT, MAX_EXTRA_PRINTS, packageById } from '@/lib/packages';
import { paymentsEnabled } from '@/lib/payments';

export const dynamic = 'force-dynamic';

const ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function newSessionId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const code = Array.from(bytes, (b) => ID_ALPHABET[b % ID_ALPHABET.length]).join('');
  return `SB${code}`;
}

export function GET() {
  return NextResponse.json({ sessions: listSessions() });
}

export async function POST(request: Request) {
  let body: { packageId?: string; extraPrints?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'body must be JSON' }, { status: 400 });
  }

  const pkg = packageById(String(body.packageId ?? ''));
  if (!pkg) return NextResponse.json({ error: 'unknown packageId' }, { status: 400 });

  const extraPrints = body.extraPrints === undefined ? 0 : Number(body.extraPrints);
  if (!Number.isInteger(extraPrints) || extraPrints < 0 || extraPrints > MAX_EXTRA_PRINTS) {
    return NextResponse.json({ error: `extraPrints must be an integer between 0 and ${MAX_EXTRA_PRINTS}` }, { status: 400 });
  }

  // The price is always worked out here from the event's price list; the kiosk never sends one.
  const event = currentEvent();
  const priceIdr = priceOf(event, pkg.id) + extraPrints * priceOf(event, EXTRA_PRINT.id);

  const session = createSession({
    id: newSessionId(),
    packageId: pkg.id,
    packageLabel: pkg.label,
    format: pkg.format,
    shots: pkg.shots,
    priceIdr,
    addons: extraPrints > 0 ? [EXTRA_PRINT.id] : [],
    prints: 1 + extraPrints,
    eventId: event.id,
    // Nothing to collect on a zero total, even when the event takes QRIS.
    requiresPayment: paymentsEnabled() && priceIdr > 0,
  });

  // The guest styles the frame before paying, so a session opens on the Hias step.
  return NextResponse.json({ session: updateSession(session.id, { status: 'reviewing' }) }, { status: 201 });
}
