import { NextResponse } from 'next/server';
import { boothStatus, recordPaperRefill } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Operator-only: "I just loaded N sheets". The paper count runs from here. */
export async function POST(request: Request) {
  let body: { sheets?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'body must be JSON' }, { status: 400 });
  }
  const sheets = Number(body.sheets);
  if (!Number.isInteger(sheets) || sheets < 1 || sheets > 2000) {
    return NextResponse.json({ error: 'jumlah lembar 1–2000' }, { status: 400 });
  }
  recordPaperRefill(sheets);
  return NextResponse.json({ status: boothStatus() });
}
