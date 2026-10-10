import Link from 'next/link';
import type { ReactNode } from 'react';

const PAGES = [
  { id: 'ringkasan', label: 'Ringkasan', href: '/operator' },
  { id: 'laporan', label: 'Laporan', href: '/operator/laporan' },
  { id: 'frame', label: 'Frame', href: '/operator/frame' },
  { id: 'kamera', label: 'Kamera', href: '/operator/camera' },
  { id: 'pengaturan', label: 'Pengaturan', href: '/operator/pengaturan' },
  // Wide tables are no use on a phone, and its tab bar has no room for a seventh tab.
  { id: 'data', label: 'Data', href: '/operator/data', wide: true },
  { id: 'sistem', label: 'Sistem', href: '/operator/sistem' },
] as const;

/** The same bar on every operator page: where you are, where else to go, and back to the booth. */
export default function OperatorHeader({ active, children }: { active: (typeof PAGES)[number]['id']; children?: ReactNode }) {
  return (
    <header className="op-top">
      <div className="op-brand">
        <strong>
          Snaplore<span>Booth</span>
        </strong>
        <span className="op-brand-tag">Konsol</span>
      </div>
      <nav className="op-nav" aria-label="Halaman operator">
        {PAGES.map((page) => (
          <Link
            key={page.id}
            href={page.href}
            aria-current={page.id === active ? 'page' : undefined}
            data-wide={'wide' in page ? 'true' : undefined}
          >
            {page.label}
          </Link>
        ))}
      </nav>
      <div className="op-top-end">
        {children}
        <Link className="pill pill-sm op-booth" href="/">
          Buka booth
        </Link>
      </div>
    </header>
  );
}
