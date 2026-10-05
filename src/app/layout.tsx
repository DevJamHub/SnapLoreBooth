import type { Metadata, Viewport } from 'next';
import { JetBrains_Mono, Newsreader, Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';
import './guest.css';
import BoothBeacon from '@/components/BoothBeacon';

const display = Newsreader({ subsets: ['latin'], variable: '--font-display', display: 'swap' });
const body = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-body', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap' });

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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>
        {children}
        <BoothBeacon />
      </body>
    </html>
  );
}
