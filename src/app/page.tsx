import Standby from '@/components/Standby';
import { getConfig } from '@/lib/config';
import { currentEvent, priceOf } from '@/lib/events';
import { PACKAGES } from '@/lib/packages';
import { paymentsEnabled } from '@/lib/payments';

export const dynamic = 'force-dynamic';

export default function StandbyPage() {
  const config = getConfig();
  const event = currentEvent();
  const paid = PACKAGES.filter((p) => config.packages.enabled.includes(p.id))
    .map((p) => priceOf(event, p.id))
    .filter((price) => price > 0);
  const fromPrice = paymentsEnabled() && paid.length > 0 ? Math.min(...paid) : null;
  // The default event is named after the product; showing that as a headline says nothing.
  const eventName = event.name === 'SnaploreBooth' ? null : event.name;
  return <Standby fromPrice={fromPrice} eventName={eventName} text={config.standby} />;
}
