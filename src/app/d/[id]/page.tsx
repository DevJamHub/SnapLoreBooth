import { notFound } from 'next/navigation';
import { getSession, listPhotos } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** What a guest's phone opens after scanning the booth QR code. */
export default async function DownloadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = getSession(id);
  if (!session || !session.strip_file) notFound();

  const mediaUrl = (file: string) => `/api/media/${file.split('/').map(encodeURIComponent).join('/')}`;
  const photos = listPhotos(id);

  return (
    <main className="dl">
      <span className="g-logo">
        Snaplore<span>Booth</span>
      </span>
      <h1 className="g-title" style={{ fontSize: 40 }}>Fotomu sudah siap</h1>
      <p className="g-lead" style={{ fontSize: 17 }}>
        Tekan lama pada foto lalu pilih <b>Simpan ke Foto</b>, atau pakai tombol di bawah.
      </p>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="dl-board" src={mediaUrl(session.strip_file)} alt="Hasil fotomu" />

      <a className="g-cta" href={mediaUrl(session.strip_file)} download={`snaplorebooth-${session.id}.jpeg`}>
        Download foto
      </a>

      {photos.length > 1 && (
        <>
          <p className="g-kicker" style={{ marginTop: 16 }}>Foto satuan</p>
          <div className="dl-frames">
            {photos.map((photo) => (
              <a key={photo.id} href={mediaUrl(photo.file)} download={`snaplorebooth-${session.id}-${photo.idx}.jpeg`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={mediaUrl(photo.file)} alt={`Foto ${photo.idx}`} />
              </a>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
