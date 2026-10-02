import { notFound, redirect } from 'next/navigation';
import StyleStage from '@/components/StyleStage';
import { getSession, listPhotos } from '@/lib/db';
import { eventById } from '@/lib/events';

export const dynamic = 'force-dynamic';

/** Hias comes before payment: the guest designs the sheet, then pays, then shoots into it. */
export default async function StylePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) notFound();
  // Once shooting has started the design is locked to what the photos were framed for.
  if (listPhotos(id).length > 0) redirect(`/capture/${id}`);

  return (
    <StyleStage
      session={session}
      payments={session.requires_payment}
      eventName={(session.event_id && eventById(session.event_id)?.name) || 'SnaploreBooth'}
    />
  );
}
