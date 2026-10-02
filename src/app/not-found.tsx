import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="dl" style={{ justifyContent: 'center' }}>
      <span className="g-logo">
        Snaplore<span>Booth</span>
      </span>
      <h1 className="g-title">Sesi ini sudah berakhir</h1>
      <p className="g-lead">Link-nya sudah kedaluwarsa, atau booth sudah direset. Yuk mulai sesi baru di booth.</p>
      <Link className="g-cta" href="/">
        Kembali ke awal
      </Link>
    </main>
  );
}
