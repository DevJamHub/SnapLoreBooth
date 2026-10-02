import { NextResponse } from 'next/server';
import { boothStatus } from '@/lib/db';
import { RETENTION_HOURS, purgeExpired } from '@/lib/retention';

export const dynamic = 'force-dynamic';

export async function GET() {
  // The kiosk polls this every 15s, which makes it the booth's heartbeat — cheap enough
  // to hang the throttled retention sweep off it rather than run a separate scheduler.
  const purged = await purgeExpired();
  return NextResponse.json({ ...boothStatus(), retention_hours: RETENTION_HOURS, purged: purged.sessions });
}
