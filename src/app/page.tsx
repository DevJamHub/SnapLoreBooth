import Standby from '@/components/Standby';
import { getConfig } from '@/lib/config';
import { currentEvent, priceOf } from '@/lib/events';
import { galleryFor } from '@/lib/gallery';
import { PACKAGES } from '@/lib/packages';
import { paymentsEnabled } from '@/lib/payments';

export const dynamic = 'force-dynamic';

/** One per drifting polaroid. */
const SHOWCASE_COUNT = 5;

export default function StandbyPage() {
  const config = getConfig();
  const event = currentEvent();
  const paid = PACKAGES.filter((p) => config.packages.enabled.includes(p.id))
    .map((p) => priceOf(event, p.id))
    .filter((price) => price > 0);
  const fromPrice = paymentsEnabled() && paid.length > 0 ? Math.min(...paid) : null;
  // The default event is named after the product; showing that as a headline says nothing.
  const eventName = event.name === 'SnaploreBooth' ? null : event.name;
  // Only sheets guests let into the event gallery, and only while that gallery is on: a guest
  // never asked must not end up on the booth's own screen.
  const showcase = config.standby.showcase && event.gallery ? galleryFor(event.id).slice(0, SHOWCASE_COUNT).map((item) => item.src) : [];
  return <Standby fromPrice={fromPrice} eventName={eventName} text={config.standby} showcase={showcase} />;
}
