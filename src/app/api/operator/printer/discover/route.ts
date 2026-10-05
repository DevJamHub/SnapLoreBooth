import { NextResponse } from 'next/server';
import { discoverPrinters } from '@/lib/printer';

export const dynamic = 'force-dynamic';

/** Operator-only: AirPrint printers on the network and the server's own printers. */
export async function GET() {
  return NextResponse.json({ printers: await discoverPrinters() });
}
