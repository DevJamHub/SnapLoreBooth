import { notFound, redirect } from 'next/navigation';
import PaymentStage from '@/components/PaymentStage';
import { getSession } from '@/lib/db';
import { sessionUnlocked } from '@/lib/payments';

export const dynamic = 'force-dynamic';

export default async function PayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) notFound();
  if (sessionUnlocked(id)) redirect(`/capture/${id}`);
  return <PaymentStage session={session} />;
}
