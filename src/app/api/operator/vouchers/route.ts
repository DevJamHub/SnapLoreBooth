import { NextResponse } from 'next/server';
import { VoucherError, createVoucher, listVouchers } from '@/lib/vouchers';

export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({ vouchers: listVouchers() });
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'body must be JSON' }, { status: 400 });
  }
  try {
    return NextResponse.json({ voucher: createVoucher(body) }, { status: 201 });
  } catch (error) {
    if (error instanceof VoucherError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
