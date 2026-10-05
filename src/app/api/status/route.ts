import { NextResponse } from 'next/server';
import { boothStatus } from '@/lib/db';
import { purgeExpired, retentionHours } from '@/lib/retention';

export const dynamic = 'force-dynamic';

export async function GET() {
  // The standby screen polls this every minute, which makes it the booth's heartbeat — cheap
  // enough to hang the throttled retention sweep off it rather than run a separate scheduler.
  const purged = await purgeExpired();
  return NextResponse.json({ ...boothStatus(), retention_hours: retentionHours(), purged: purged.sessions });
}
