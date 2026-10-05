import { NextResponse } from 'next/server';
import { printerUri, readPrinter, setPrinterUri, validPrinterUri } from '@/lib/printer';

export const dynamic = 'force-dynamic';

/** Operator-only (see middleware): the chosen printer and what it reports right now. */
export async function GET() {
  const uri = printerUri();
  return NextResponse.json({ uri, status: uri ? await readPrinter(uri) : null });
}

/** Chooses the printer to watch (`{uri}`), or forgets it (`{uri: null}`). */
export async function POST(request: Request) {
  let body: { uri?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'body must be JSON' }, { status: 400 });
  }
  if (body.uri === null) {
    setPrinterUri(null);
    return NextResponse.json({ uri: null, status: null });
  }
  const uri = String(body.uri ?? '').trim();
  if (!validPrinterUri(uri)) return NextResponse.json({ error: 'alamat printer harus diawali ipp:// atau ipps://' }, { status: 400 });
  setPrinterUri(uri);
  return NextResponse.json({ uri, status: await readPrinter(uri) });
}
