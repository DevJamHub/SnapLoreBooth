import PackagePicker from '@/components/PackagePicker';
import { currentEvent, priceOf } from '@/lib/events';
import { ADDONS, PACKAGES } from '@/lib/packages';
import { paymentsEnabled } from '@/lib/payments';

export const dynamic = 'force-dynamic';

export default function PackagePage() {
  const event = currentEvent();
  const prices = Object.fromEntries([...PACKAGES, ...ADDONS].map((item) => [item.id, priceOf(event, item.id)]));
  return <PackagePicker payments={paymentsEnabled()} prices={prices} />;
}
