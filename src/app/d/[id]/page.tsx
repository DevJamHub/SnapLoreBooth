import { notFound } from 'next/navigation';
import LivePanel from '@/components/LivePanel';
import LoopVideo from '@/components/LoopVideo';
import { getSession, listPhotos } from '@/lib/db';

export const dynamic = 'force-dynamic';

const mediaUrl = (file: string) => `/api/media/${file.split('/').map(encodeURIComponent).join('/')}`;

/** What a guest's phone opens after scanning the booth QR code. */
export default async function DownloadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = getSession(id);
  if (!session || !session.strip_file) notFound();

  const photos = listPhotos(id);
  const clips = photos.filter((p) => p.clip_file);

  return (
    <main className="dl">
      <span className="g-logo">
        Snaplore<span>Booth</span>
      </span>
      <h1 className="g-title" style={{ fontSize: 40 }}>Fotomu sudah siap</h1>
      <p className="g-lead" style={{ fontSize: 17 }}>
        Tekan lama pada foto atau video lalu pilih <b>Simpan</b>, atau pakai tombol download.
      </p>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="dl-board" src={mediaUrl(session.strip_file)} alt="Hasil fotomu" />

      <a className="g-cta" href={mediaUrl(session.strip_file)} download={`snaplorebooth-${session.id}.jpeg`}>
        Download foto
      </a>

      {clips.length > 0 && <LivePanel sessionId={session.id} initialFile={session.live_file} poster={mediaUrl(session.strip_file)} />}

      {clips.length > 0 && (
        <>
          <p className="g-kicker" style={{ marginTop: 16 }}>Video per foto · {clips.length}</p>
          <div className="dl-clips">
            {clips.map((photo) => (
              <figure key={photo.id}>
                <LoopVideo src={mediaUrl(photo.clip_file!)} poster={mediaUrl(photo.file)} />
                <a href={mediaUrl(photo.clip_file!)} download={`snaplorebooth-${session.id}-${photo.idx}.${photo.clip_file!.split('.').pop()}`}>
                  Download video {photo.idx}
                </a>
              </figure>
            ))}
          </div>
        </>
      )}

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
