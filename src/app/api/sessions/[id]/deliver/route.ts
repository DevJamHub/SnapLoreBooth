import { NextResponse } from 'next/server';
import { getSession, updateSession } from '@/lib/db';

export const dynamic = 'force-dynamic';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[0-9][0-9\s-]{6,17}$/;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) return NextResponse.json({ error: 'session not found' }, { status: 404 });

  let body: { email?: unknown; phone?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'body must be JSON' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
  if (!email && !phone) return NextResponse.json({ error: 'provide an email or a phone number' }, { status: 400 });
  if (email && !EMAIL.test(email)) return NextResponse.json({ error: 'invalid email' }, { status: 400 });
  if (phone && !PHONE.test(phone)) return NextResponse.json({ error: 'invalid phone number' }, { status: 400 });

  // Delivery is recorded only; wiring a real mail/SMS provider is a deployment concern.
  const target = [email, phone].filter(Boolean).join(' · ');
  const updated = updateSession(id, { delivered_to: target });
  return NextResponse.json({ session: updated, queued: true });
}
