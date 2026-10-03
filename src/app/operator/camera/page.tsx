import CameraConsole from '@/components/CameraConsole';
import { currentEvent } from '@/lib/events';

export const dynamic = 'force-dynamic';

export default function CameraPage() {
  return <CameraConsole initialMirror={currentEvent().mirror} />;
}
