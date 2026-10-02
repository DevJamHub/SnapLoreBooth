import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import QRCode from 'qrcode';
import ShareStage from '@/components/ShareStage';
import { getSession, listPhotos } from '@/lib/db';
import { eventById } from '@/lib/events';
import { frameForSession } from '@/lib/frames';
import { RETENTION_HOURS } from '@/lib/retention';

export const dynamic = 'force-dynamic';

export default async function SharePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = getSession(id);
  if (!session || !session.strip_file) notFound();

  const headerList = await headers();
  const host = headerList.get('host') ?? 'localhost:4300';
  const proto = headerList.get('x-forwarded-proto') ?? 'http';
  // PUBLIC_BASE_URL points the QR somewhere guests' phones can reach (the VPS domain).
  const base = process.env.PUBLIC_BASE_URL?.replace(/\/$/, '') ?? `${proto}://${host}`;
  const downloadUrl = `${base}/d/${session.id}`;

  const qrDataUrl = await QRCode.toDataURL(downloadUrl, {
    margin: 1,
    width: 480,
    color: { dark: '#181816', light: '#ffffff' },
  });

  const media = (file: string) => `/api/media/${file.split('/').map(encodeURIComponent).join('/')}`;
  const stripUrl = media(session.strip_file);
  const event = session.event_id ? eventById(session.event_id) : null;
  const liveSlots = listPhotos(id).map((p) => ({ clip: p.clip_file ? media(p.clip_file) : null, still: media(p.file) }));

  return (
    <ShareStage
      session={session}
      stripUrl={stripUrl}
      qrDataUrl={qrDataUrl}
      retentionHours={RETENTION_HOURS}
      payments={session.requires_payment}
      gallery={event?.gallery === true}
      printMode={event?.print_mode ?? 'simulated'}
      eventName={event?.name ?? 'SnaploreBooth'}
      liveSlots={liveSlots}
      liveUrl={session.live_file ? media(session.live_file) : null}
      frame={frameForSession(session)}
    />
  );
}
