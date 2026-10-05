import { NextResponse } from 'next/server';
import { optimizeStorage, storageBreakdown } from '@/lib/housekeeping';

export const dynamic = 'force-dynamic';
// Shrinking a few hundred camera photos takes a while.
export const maxDuration = 120;

/** Operator-only (see middleware): where the disk goes, by kind. */
export async function GET() {
  return NextResponse.json(await storageBreakdown());
}

/** Operator-only: "Optimalkan sekarang". The console asks first. */
export async function POST() {
  return NextResponse.json(await optimizeStorage());
}
