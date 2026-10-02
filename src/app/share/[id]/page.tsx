import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import QRCode from 'qrcode';
import ShareStage from '@/components/ShareStage';
import { getSession } from '@/lib/db';
import { paymentsEnabled } from '@/lib/payments';
import { RETENTION_HOURS } from '@/lib/retention';

export const dynamic = 'force-dynamic';

export default async function SharePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = getSession(id);
  if (!session || !session.strip_file) notFound();

  const headerList = await headers();
  const host = headerList.get('host') ?? 'localhost:4300';
  const proto = headerList.get('x-forwarded-proto') ?? 'http';
  // PUBLIC_BASE_URL points the QR somewhere guests' phones can reach (a tunnel or cloud host).
  const base = process.env.PUBLIC_BASE_URL?.replace(/\/$/, '') ?? `${proto}://${host}`;
  const downloadUrl = `${base}/d/${session.id}`;

  const qrDataUrl = await QRCode.toDataURL(downloadUrl, {
    margin: 1,
    width: 480,
    color: { dark: '#181816', light: '#ffffff' },
  });

  const stripUrl = `/api/media/${session.strip_file.split('/').map(encodeURIComponent).join('/')}`;

  return (
    <ShareStage
      session={session}
      stripUrl={stripUrl}
      qrDataUrl={qrDataUrl}
      retentionHours={RETENTION_HOURS}
      payments={paymentsEnabled()}
    />
  );
}
