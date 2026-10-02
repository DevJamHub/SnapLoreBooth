import { NextResponse } from 'next/server';
import { browserInfo, camera } from '@/lib/camera';

export const dynamic = 'force-dynamic';

export async function GET() {
  const source = camera();
  if (!source) return NextResponse.json(browserInfo);
  return NextResponse.json(await source.info());
}
