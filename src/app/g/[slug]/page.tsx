import { notFound } from 'next/navigation';
import QRCode from 'qrcode';
import LiveGallery from '@/components/LiveGallery';
import { eventBySlug } from '@/lib/events';
import { galleryFor } from '@/lib/gallery';
import { publicBaseUrl } from '@/lib/publicUrl';

export const dynamic = 'force-dynamic';

export default async function GalleryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tv?: string }>;
}) {
  const { slug } = await params;
  // Older links carried ?tv=1; the page now decides from the event's state alone.
  await searchParams;
  const event = eventBySlug(slug);
  if (!event || !event.gallery) notFound();

  const base = await publicBaseUrl();
  const galleryUrl = `${base}/g/${event.slug}`;
  const qrDataUrl = await QRCode.toDataURL(galleryUrl, { margin: 1, width: 360, color: { dark: '#181816', light: '#ffffff' } });

  return (
    <LiveGallery
      slug={event.slug}
      eventName={event.name}
      initial={galleryFor(event.id)}
      initialEnded={event.ended_at !== null}
      qrDataUrl={qrDataUrl}
    />
  );
}
