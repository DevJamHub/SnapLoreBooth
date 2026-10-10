import { notFound, redirect } from 'next/navigation';
import StyleStage from '@/components/StyleStage';
import { getConfig, sheetText } from '@/lib/config';
import { getSession, listPhotos } from '@/lib/db';
import { eventById } from '@/lib/events';
import { mediaUrl } from '@/lib/format';
import { frameForSession } from '@/lib/frames';
import { sessionUnlocked } from '@/lib/payments';
import { slotOrder } from '@/lib/picks';
import { printedQr } from '@/lib/publicUrl';

export const dynamic = 'force-dynamic';

/** Gaya comes after the photos: the guest picks a colour look and beauty on their own shots. */
export default async function StylePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) notFound();
  if (session.strip_file) redirect(`/share/${id}`);
  if (!sessionUnlocked(id)) redirect(`/pay/${id}`);

  const byIndex = new Map(listPhotos(id).map((p) => [p.idx, mediaUrl(p.file, p.created_at)]));
  // The guest's picks when they shot bonus photos, else the photos as shot.
  const photos = slotOrder(session).map((n) => byIndex.get(n) ?? null);
  // A missing shot is taken on the photo screen, never printed as a hole.
  if (photos.some((p) => p === null)) redirect(`/capture/${id}`);

  const config = getConfig();
  const { flow, style } = config;
  return (
    <StyleStage
      settings={{ seconds: flow.gayaSeconds, filters: style.filters, beauty: style.beauty, decor: style.decor, backgrounds: style.backgrounds }}
      session={session}
      payments={session.requires_payment}
      eventName={sheetText((session.event_id && eventById(session.event_id)?.name) || 'SnaploreBooth', config)}
      showDate={config.sheet.date}
      photos={photos as string[]}
      frame={frameForSession(session)}
      qr={await printedQr(id, config)}
    />
  );
}
