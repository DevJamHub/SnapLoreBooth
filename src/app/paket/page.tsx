import PackagePicker from '@/components/PackagePicker';
import { paymentsEnabled } from '@/lib/payments';

export const dynamic = 'force-dynamic';

export default function PackagePage() {
  return <PackagePicker payments={paymentsEnabled()} />;
}
