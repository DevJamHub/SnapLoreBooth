import { notFound, redirect } from 'next/navigation';
import CaptureStage from '@/components/CaptureStage';
import { getSession, listPhotos } from '@/lib/db';
import { eventById } from '@/lib/events';
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
    listPhotos(id).map((p) => [p.idx, `/api/media/${p.file.split('/').map(encodeURIComponent).join('/')}?v=${encodeURIComponent(p.created_at)}`]),
  );

  return (
    <CaptureStage
      session={session}
      payments={session.requires_payment}
      eventName={(session.event_id && eventById(session.event_id)?.name) || 'SnaploreBooth'}
      initialShots={initialShots}
    />
  );
}
