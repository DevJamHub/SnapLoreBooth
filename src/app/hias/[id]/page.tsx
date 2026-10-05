import { notFound, redirect } from 'next/navigation';
import FrameStage from '@/components/FrameStage';
import { getConfig, sheetText } from '@/lib/config';
import { getSession, listPhotos } from '@/lib/db';
import { eventById } from '@/lib/events';
import { listFrames } from '@/lib/frames';

export const dynamic = 'force-dynamic';

/** Hias comes before payment: the guest picks the frame, then pays, then shoots into it. */
export default async function FramePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) notFound();
  // Once shooting has started the frame is locked to what the photos were framed for.
  if (listPhotos(id).length > 0) redirect(`/capture/${id}`);

  const config = getConfig();
  return (
    <FrameStage
      seconds={config.flow.hiasSeconds}
      livePreview={config.flow.livePreview}
      session={session}
      payments={session.requires_payment}
      eventName={sheetText((session.event_id && eventById(session.event_id)?.name) || 'SnaploreBooth', config)}
      showDate={config.sheet.date}
      frames={listFrames(session.format, { offered: true })}
      builtin={config.sheet.builtin}
    />
  );
}
