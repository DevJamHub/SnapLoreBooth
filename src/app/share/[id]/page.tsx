import { notFound } from 'next/navigation';
import QRCode from 'qrcode';
import ShareStage from '@/components/ShareStage';
import { getConfig, sheetText, videoBitrates } from '@/lib/config';
import { getSession, listPhotos } from '@/lib/db';
import { mediaUrl } from '@/lib/format';
import { publicBaseUrl } from '@/lib/publicUrl';
import { eventById } from '@/lib/events';
import { frameForSession } from '@/lib/frames';
import { retentionHours } from '@/lib/retention';

export const dynamic = 'force-dynamic';

export default async function SharePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = getSession(id);
  if (!session || !session.strip_file) notFound();

  // Somewhere guests' phones can reach: the domain, else the tunnel, else this address.
  const base = await publicBaseUrl();
  const downloadUrl = `${base}/d/${session.id}`;

  const qrDataUrl = await QRCode.toDataURL(downloadUrl, {
    margin: 1,
    width: 480,
    color: { dark: '#181816', light: '#ffffff' },
  });

  const stripUrl = mediaUrl(session.strip_file);
  const event = session.event_id ? eventById(session.event_id) : null;
  const liveSlots = listPhotos(id).map((p) => ({ clip: p.clip_file ? mediaUrl(p.clip_file) : null, still: mediaUrl(p.file) }));

  const config = getConfig();
  return (
    <ShareStage
      settings={{
        finishSeconds: config.flow.shareSeconds,
        qr: config.share.qr,
        galleryChoice: config.share.galleryChoice,
        liveBitrate: config.share.liveVideo ? videoBitrates(config).live : null,
      }}
      session={session}
      stripUrl={stripUrl}
      qrDataUrl={qrDataUrl}
      retentionHours={retentionHours()}
      payments={session.requires_payment}
      gallery={event?.gallery === true}
      printMode={event?.print_mode ?? 'simulated'}
      eventName={sheetText(event?.name ?? 'SnaploreBooth', config)}
      showDate={config.sheet.date}
      liveSlots={liveSlots}
      liveUrl={session.live_file ? mediaUrl(session.live_file) : null}
      frame={frameForSession(session)}
    />
  );
}
