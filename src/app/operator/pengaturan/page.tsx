import OperatorHeader from '@/components/OperatorHeader';
import SettingsPanel from '@/components/SettingsPanel';
import { defaultConfig, getConfig } from '@/lib/config';
import { storageBreakdown } from '@/lib/housekeeping';
import { canOptimizeStills } from '@/lib/storage';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  return (
    <main className="op">
      <OperatorHeader active="pengaturan" />
      <SettingsPanel initial={getConfig()} defaults={defaultConfig()} storage={await storageBreakdown()} canShrink={canOptimizeStills()} />
    </main>
  );
}
