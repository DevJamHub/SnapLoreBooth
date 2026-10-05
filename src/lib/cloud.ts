import { AwsClient } from 'aws4fetch';

/**
 * Optional off-site copy of every photo in Cloudflare R2 (S3-compatible, no egress fees).
 * The booth always writes locally first; R2 is the copy that survives a dead disk or a move
 * to a new server, and serves photos the local disk no longer has.
 */
interface R2Config {
  client: AwsClient;
  base: string;
}

let cached: R2Config | null | undefined;

function r2(): R2Config | null {
  if (cached !== undefined) return cached;
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
  cached =
    R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET
      ? {
          client: new AwsClient({ accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY, service: 's3', region: 'auto' }),
          base: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}`,
        }
      : null;
  return cached;
}

/** A photo or clip over a venue's upload can take a while; a hung connection must still end. */
const UPLOAD_TIMEOUT_MS = 120_000;
const REQUEST_TIMEOUT_MS = 20_000;

export function cloudEnabled(): boolean {
  return r2() !== null;
}

function objectUrl(config: R2Config, key: string): string {
  return `${config.base}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

export async function putObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
  const config = r2();
  if (!config) return;
  const res = await config.client.fetch(objectUrl(config, key), {
    method: 'PUT',
    // slice() yields an ArrayBuffer-backed copy, which is what fetch's body type accepts.
    body: body.slice(),
    headers: { 'Content-Type': contentType },
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`R2 PUT ${key} answered ${res.status}`);
}

/** A short-lived link the browser can fetch directly, so photos never stream through the booth. */
export async function signedGetUrl(key: string, seconds = 300): Promise<string | null> {
  const config = r2();
  if (!config) return null;
  const url = new URL(objectUrl(config, key));
  url.searchParams.set('X-Amz-Expires', String(seconds));
  const signed = await config.client.sign(url.toString(), { method: 'GET', aws: { signQuery: true } });
  return signed.url;
}

/** Deletes one stored object; a missing one counts as deleted. */
export async function deleteObject(key: string): Promise<void> {
  const config = r2();
  if (!config) return;
  const res = await config.client.fetch(objectUrl(config, key), { method: 'DELETE', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok && res.status !== 404) throw new Error(`R2 DELETE ${key} answered ${res.status}`);
}

/** Deletes every object under `prefix/` — one guest session's photos. */
export async function deletePrefix(prefix: string): Promise<number> {
  const config = r2();
  if (!config) return 0;
  const list = await config.client.fetch(`${config.base}?list-type=2&prefix=${encodeURIComponent(`${prefix}/`)}`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!list.ok) throw new Error(`R2 list ${prefix} answered ${list.status}`);
  const keys = [...(await list.text()).matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]);
  for (const key of keys) {
    const res = await config.client.fetch(objectUrl(config, decodeXml(key)), { method: 'DELETE', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!res.ok && res.status !== 404) throw new Error(`R2 DELETE ${key} answered ${res.status}`);
  }
  return keys.length;
}

function decodeXml(value: string): string {
  return value.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}
