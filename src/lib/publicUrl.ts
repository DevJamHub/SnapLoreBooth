import { headers } from 'next/headers';
import QRCode from 'qrcode';
import { getConfig, type BoothConfig } from './config';

/** cloudflared serves its metrics on the first free port of these; a quick tunnel names itself there. */
const TUNNEL_METRICS_PORTS = [20241, 20242, 20243, 20244, 20245];
const TUNNEL_CACHE_MS = 15_000;

let tunnelCache: { at: number; url: string | null } | null = null;

/** Hosts a guest's phone outside the venue LAN can never open: this machine and private networks. */
export function isLocalHost(host: string): boolean {
  const name = host.toLowerCase().replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  return (
    name === 'localhost' ||
    name === '::1' ||
    name.endsWith('.local') ||
    /^127\./.test(name) ||
    /^10\./.test(name) ||
    /^192\.168\./.test(name) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(name) ||
    /^169\.254\./.test(name)
  );
}

/**
 * The address of a running `npm run tunnel` (a cloudflared quick tunnel), as cloudflared reports
 * it on its metrics server. Lets the booth screen open at localhost or the LAN address, where the
 * live view is smooth, while the guests' QR codes still point at the tunnel.
 */
export async function quickTunnelUrl(): Promise<string | null> {
  if (tunnelCache && Date.now() - tunnelCache.at < TUNNEL_CACHE_MS) return tunnelCache.url;
  let url: string | null = null;
  for (const port of TUNNEL_METRICS_PORTS) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/quicktunnel`, { signal: AbortSignal.timeout(500), cache: 'no-store' });
      if (!res.ok) continue;
      const { hostname } = (await res.json()) as { hostname?: string };
      if (hostname) {
        url = `https://${hostname}`;
        break;
      }
    } catch {
      // Nothing on this port, or not cloudflared.
    }
  }
  tunnelCache = { at: Date.now(), url };
  return url;
}

/**
 * Where guests' phones reach this booth: PUBLIC_BASE_URL when set; else the running tunnel when
 * the screen was opened locally; else the address the screen was opened at.
 */
export async function publicBaseUrl(): Promise<string> {
  const fixed = process.env.PUBLIC_BASE_URL?.replace(/\/$/, '');
  if (fixed) return fixed;
  const headerList = await headers();
  const host = headerList.get('host') ?? 'localhost:4300';
  if (isLocalHost(host)) {
    const tunnel = await quickTunnelUrl();
    if (tunnel) return tunnel;
  }
  return `${headerList.get('x-forwarded-proto') ?? 'http'}://${host}`;
}

/** The page a guest's QR opens, and the code itself as a PNG data URL. */
export async function downloadQr(sessionId: string): Promise<{ url: string; qr: string }> {
  const url = `${await publicBaseUrl()}/d/${sessionId}`;
  const qr = await QRCode.toDataURL(url, { margin: 1, width: 480, color: { dark: '#181816', light: '#ffffff' } });
  return { url, qr };
}

/**
 * The code a built-in frame prints in its footer, or null when the operator prints none — also
 * when guests get no QR at all (an event that only prints).
 */
export async function printedQr(sessionId: string, config: BoothConfig = getConfig()): Promise<string | null> {
  if (!config.sheet.qr || !config.share.qr) return null;
  return (await downloadQr(sessionId)).qr;
}
