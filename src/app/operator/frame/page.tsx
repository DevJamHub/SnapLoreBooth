import FrameManager from '@/components/FrameManager';
import OperatorHeader from '@/components/OperatorHeader';
import { listFrames } from '@/lib/frames';

export const dynamic = 'force-dynamic';

export default function FramePage() {
  return (
    <main className="op">
      <OperatorHeader active="frame" />
      <FrameManager frames={listFrames()} />
    </main>
  );
}
