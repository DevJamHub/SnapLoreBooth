import { notFound, redirect } from 'next/navigation';
import CaptureStage from '@/components/CaptureStage';
import { getSession } from '@/lib/db';
import { paymentsEnabled, sessionUnlocked } from '@/lib/payments';

export const dynamic = 'force-dynamic';

export default async function CapturePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) notFound();
  if (!sessionUnlocked(id)) redirect(`/pay/${id}`);
  return <CaptureStage session={session} payments={paymentsEnabled()} />;
}
