import { notFound } from 'next/navigation';
import ShareStage from '@/components/ShareStage';
import { getConfig, sheetText, videoBitrates } from '@/lib/config';
import { getSession, listPhotos } from '@/lib/db';
import { mediaUrl } from '@/lib/format';
import { downloadQr } from '@/lib/publicUrl';
import { eventById } from '@/lib/events';
import { frameForSession } from '@/lib/frames';
import { extraSheetPrice, paymentsEnabled } from '@/lib/payments';
import { slotOrder } from '@/lib/picks';
import { retentionHours } from '@/lib/retention';

export const dynamic = 'force-dynamic';

export default async function SharePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = getSession(id);
  if (!session || !session.strip_file) notFound();

  // Somewhere guests' phones can reach: the domain, else the tunnel, else this address.
  const { qr: qrDataUrl } = await downloadQr(session.id);

  const stripUrl = mediaUrl(session.strip_file);
  const event = session.event_id ? eventById(session.event_id) : null;
  // The photos in the sheet's holes, in order: bonus photos left out of it make no live video.
  const byIndex = new Map(listPhotos(id).map((p) => [p.idx, p]));
  const liveSlots = slotOrder(session)
    .map((n) => byIndex.get(n))
    .filter((p) => p !== undefined)
    .map((p) => ({ clip: p.clip_file ? mediaUrl(p.clip_file) : null, still: mediaUrl(p.file) }));

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
      printQr={config.sheet.qr && config.share.qr}
      upsell={
        paymentsEnabled() && config.share.upsell && extraSheetPrice(session) > 0
          ? { price: extraSheetPrice(session), max: config.packages.maxExtra }
          : null
      }
      liveSlots={liveSlots}
      liveUrl={session.live_file ? mediaUrl(session.live_file) : null}
      frame={frameForSession(session)}
    />
  );
}
