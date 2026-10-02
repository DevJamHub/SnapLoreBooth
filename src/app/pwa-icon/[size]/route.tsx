import { appIcon } from '@/lib/appIcon';

const SIZES = new Set([192, 512]);

export async function GET(_request: Request, { params }: { params: Promise<{ size: string }> }) {
  const size = Number((await params).size);
  if (!SIZES.has(size)) return new Response('not found', { status: 404 });
  return appIcon(size);
}
