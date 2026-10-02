import { NextResponse } from 'next/server';
import { createSession, listSessions } from '@/lib/db';
import { ADDONS, packageById } from '@/lib/packages';

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
  let body: { packageId?: string; addons?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'body must be JSON' }, { status: 400 });
  }

  const pkg = packageById(String(body.packageId ?? ''));
  if (!pkg) return NextResponse.json({ error: 'unknown packageId' }, { status: 400 });

  const known = new Set(ADDONS.map((a) => a.id));
  const requested = Array.isArray(body.addons) ? body.addons.map(String) : [];
  const unknown = requested.filter((a) => !known.has(a));
  if (unknown.length) return NextResponse.json({ error: `unknown addons: ${unknown.join(', ')}` }, { status: 400 });

  const addons = [...new Set(requested)];
  const chosen = ADDONS.filter((a) => addons.includes(a.id));
  const priceIdr = pkg.priceIdr + chosen.reduce((sum, a) => sum + a.priceIdr, 0);
  const prints = pkg.prints + chosen.reduce((sum, a) => sum + a.extraPrints, 0);

  const session = createSession({
    id: newSessionId(),
    packageId: pkg.id,
    packageLabel: pkg.label,
    format: pkg.format,
    shots: pkg.shots,
    priceIdr,
    addons,
    prints,
  });

  return NextResponse.json({ session }, { status: 201 });
}
