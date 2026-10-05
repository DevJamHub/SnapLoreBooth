import { notFound } from 'next/navigation';
import OperatorHeader from '@/components/OperatorHeader';
import ReprintPanel from '@/components/ReprintPanel';
import { getSession } from '@/lib/db';
import { mediaUrl } from '@/lib/format';

export const dynamic = 'force-dynamic';

/** Konsol: print a guest's sheet again (paper jam, a second copy), from any device with the printer. */
export default async function ReprintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = getSession(id);
  if (!session?.strip_file) notFound();
  const src = mediaUrl(session.strip_file);
  return (
    <main className="op">
      <div className="no-print">
        <OperatorHeader active="ringkasan" />
      </div>
      <ReprintPanel id={session.id} src={src} format={session.format} label={session.package_label} />
    </main>
  );
}
