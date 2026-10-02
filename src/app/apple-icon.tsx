import { appIcon } from '@/lib/appIcon';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

/** What iPadOS shows on the home screen after "Add to Home Screen". */
export default function AppleIcon() {
  return appIcon(180);
}
