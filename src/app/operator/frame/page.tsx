import Link from 'next/link';
import FrameManager from '@/components/FrameManager';
import { listFrames } from '@/lib/frames';

export const dynamic = 'force-dynamic';

export default function FramePage() {
  return (
    <main className="kiosk">
      <div className="topbar">
        <div className="brand">
          <strong>Frame</strong>
          <span className="mono">SNAPLOREBOOTH</span>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Link className="pill pill-ghost pill-sm" href="/operator" style={{ display: 'inline-flex', alignItems: 'center' }}>
            Konsol
          </Link>
          <Link className="pill pill-sm" href="/" style={{ display: 'inline-flex', alignItems: 'center' }}>
            Kembali ke Booth
          </Link>
        </div>
      </div>
      <FrameManager frames={listFrames()} />
    </main>
  );
}
