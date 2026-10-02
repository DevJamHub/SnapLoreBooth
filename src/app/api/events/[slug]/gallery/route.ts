import { NextResponse } from 'next/server';
import { eventBySlug } from '@/lib/events';
import { galleryFor } from '@/lib/gallery';

export const dynamic = 'force-dynamic';

/** What the live gallery polls. Gone entirely when the operator switches the gallery off. */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const event = eventBySlug(slug);
  if (!event || !event.gallery) return NextResponse.json({ error: 'gallery not found' }, { status: 404 });
  return NextResponse.json(
    { ended: event.ended_at !== null, items: galleryFor(event.id) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
