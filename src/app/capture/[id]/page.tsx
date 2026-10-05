import { notFound, redirect } from 'next/navigation';
import CaptureStage from '@/components/CaptureStage';
import { getConfig, sheetText, videoBitrates } from '@/lib/config';
import { getSession, listPhotos } from '@/lib/db';
import { eventById } from '@/lib/events';
import { mediaUrl } from '@/lib/format';
import { frameForSession } from '@/lib/frames';
import { sessionUnlocked } from '@/lib/payments';

export const dynamic = 'force-dynamic';

export default async function CapturePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) notFound();
  if (!sessionUnlocked(id)) redirect(`/pay/${id}`);
  if (session.strip_file) redirect(`/share/${id}`);

  // A reload mid-session picks up the shots already taken instead of starting over.
  const initialShots = Object.fromEntries(
    listPhotos(id).map((p) => [p.idx, mediaUrl(p.file, p.created_at)]),
  );

  const config = getConfig();
  return (
    <CaptureStage
      settings={{
        countdown: config.flow.countdown,
        sound: config.capture.sound,
        showMs: config.flow.showTenths * 100,
        sessionSeconds: config.flow.captureSeconds,
        retake: config.capture.retake,
        prompts: config.capture.prompts,
        clipBitrate: config.capture.clips ? videoBitrates(config).clip : null,
        maxEdge: config.storage.maxEdge,
        quality: config.storage.quality / 100,
      }}
      session={session}
      payments={session.requires_payment}
      eventName={sheetText((session.event_id && eventById(session.event_id)?.name) || 'SnaploreBooth', config)}
      showDate={config.sheet.date}
      initialShots={initialShots}
      frame={frameForSession(session)}
    />
  );
}
