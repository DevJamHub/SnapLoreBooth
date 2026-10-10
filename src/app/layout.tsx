import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import { Caveat, JetBrains_Mono, Newsreader, Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';
import './guest.css';
import BoothBeacon from '@/components/BoothBeacon';
import { LangProvider } from '@/components/guest/lang';
import { LANG_COOKIE, langOf } from '@/lib/i18n';

const display = Newsreader({ subsets: ['latin'], variable: '--font-display', display: 'swap' });
const body = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-body', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap' });
/** Handwriting for what guests write on their sheet (Gaya → Tulisan). */
const hand = Caveat({ subsets: ['latin'], weight: ['700'], variable: '--font-hand', display: 'swap' });

export const metadata: Metadata = {
  title: 'SnaploreBooth',
  description: 'Photobooth — foto, hias, cetak, bawa pulang.',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'SnaploreBooth' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#181816',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = langOf((await cookies()).get(LANG_COOKIE)?.value);
  return (
    <html lang={lang} className={`${display.variable} ${body.variable} ${mono.variable} ${hand.variable}`}>
      <body>
        <LangProvider lang={lang}>{children}</LangProvider>
        <BoothBeacon />
      </body>
    </html>
  );
}
