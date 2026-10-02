import { notFound, redirect } from 'next/navigation';
import ReviewStage from '@/components/ReviewStage';
import { getSession, listPhotos } from '@/lib/db';
import { paymentsEnabled, sessionUnlocked } from '@/lib/payments';

export const dynamic = 'force-dynamic';

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) notFound();
  if (!sessionUnlocked(id)) redirect(`/pay/${id}`);

  const photos = listPhotos(id);
  if (photos.length === 0) redirect(`/capture/${id}`);

  return (
    <ReviewStage
      session={session}
      photos={photos}
      payments={paymentsEnabled()}
      eventName={process.env.EVENT_NAME ?? 'SnaploreBooth'}
    />
  );
}
