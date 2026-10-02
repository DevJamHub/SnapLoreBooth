import Standby from '@/components/Standby';
import { currentEvent, priceOf } from '@/lib/events';
import { PACKAGES } from '@/lib/packages';
import { paymentsEnabled } from '@/lib/payments';

export const dynamic = 'force-dynamic';

export default function StandbyPage() {
  const event = currentEvent();
  const paid = PACKAGES.map((p) => priceOf(event, p.id)).filter((price) => price > 0);
  const fromPrice = paymentsEnabled() && paid.length > 0 ? Math.min(...paid) : null;
  // The default event is named after the product; showing that as a headline says nothing.
  const eventName = event.name === 'SnaploreBooth' ? null : event.name;
  return <Standby fromPrice={fromPrice} eventName={eventName} />;
}
