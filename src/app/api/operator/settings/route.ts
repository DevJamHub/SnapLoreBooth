import { NextResponse } from 'next/server';
import { ConfigInputError, defaultConfig, getConfig, resetConfig, updateConfig } from '@/lib/config';

export const dynamic = 'force-dynamic';

/** Operator-only (see middleware): the booth's settings and what they would be by default. */
export function GET() {
  return NextResponse.json({ config: getConfig(), defaults: defaultConfig() });
}

/** Any subset of sections and fields; a value the console would not offer is refused with why. */
export async function PATCH(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'body must be JSON' }, { status: 400 });
  }
  try {
    return NextResponse.json({ config: updateConfig(body) });
  } catch (error) {
    if (error instanceof ConfigInputError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

/** Back to the defaults. Events, prices, frames and guest data are not settings and stay. */
export function DELETE() {
  return NextResponse.json({ config: resetConfig() });
}
