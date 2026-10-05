import { appIcon } from '@/lib/appIcon';

export const size = { width: 64, height: 64 };
export const contentType = 'image/png';

/** The browser-tab icon: the same polaroid as the home-screen icon. */
export default function Icon() {
  return appIcon(64);
}
