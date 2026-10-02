import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * The operator console and the session list expose guest email addresses and phone
 * numbers, so they are the one part of the booth that must not be readable by everyone on
 * the event WiFi. Guest-facing kiosk routes stay open — a tamper-proof lock on the booth's
 * own screen would only stop the guests using it.
 */
const REALM = 'SnaploreBooth operator console';

function unauthorized(): NextResponse {
  return new NextResponse('Authentication required.', {
    status: 401,
    headers: { 'WWW-Authenticate': `Basic realm="${REALM}", charset="UTF-8"` },
  });
}

/** Compares in constant time so the response latency does not leak the password. */
function matches(candidate: string, expected: string): boolean {
  if (candidate.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < candidate.length; i += 1) diff |= candidate.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export function middleware(request: NextRequest) {
  // Starting a session is the kiosk's own POST; only reading the list is sensitive.
  if (request.nextUrl.pathname === '/api/sessions' && request.method !== 'GET') return NextResponse.next();

  const expected = process.env.OPERATOR_PASSWORD;
  if (!expected) {
    return new NextResponse(
      'The operator console is disabled: set OPERATOR_PASSWORD before starting the booth.',
      { status: 503, headers: { 'Content-Type': 'text/plain' } },
    );
  }

  const header = request.headers.get('authorization');
  if (!header?.startsWith('Basic ')) return unauthorized();

  let decoded: string;
  try {
    decoded = atob(header.slice(6));
  } catch {
    return unauthorized();
  }

  const password = decoded.slice(decoded.indexOf(':') + 1);
  return matches(password, expected) ? NextResponse.next() : unauthorized();
}

export const config = {
  matcher: ['/operator', '/operator/:path*', '/api/sessions', '/api/camera/settings', '/api/camera/test'],
};
