import PackagePicker from '@/components/PackagePicker';
import { getConfig } from '@/lib/config';
import { currentEvent, priceOf } from '@/lib/events';
import { ADDONS, PACKAGES } from '@/lib/packages';
import { paymentsEnabled } from '@/lib/payments';
import { listVouchers } from '@/lib/vouchers';

export const dynamic = 'force-dynamic';

export default function PackagePage() {
  const config = getConfig();
  const event = currentEvent();
  const prices = Object.fromEntries([...PACKAGES, ...ADDONS].map((item) => [item.id, priceOf(event, item.id)]));
  return (
    <PackagePicker
      payments={paymentsEnabled()}
      prices={prices}
      enabled={config.packages.enabled}
      maxExtra={config.packages.extraPrints ? config.packages.maxExtra : 0}
      idleSeconds={config.flow.idleSeconds}
      // The promo button shows only while the operator has a code switched on.
      promo={listVouchers().some((v) => v.active)}
      english={config.standby.english}
    />
  );
}
