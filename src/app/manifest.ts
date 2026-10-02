import type { MetadataRoute } from 'next';

/** Lets the booth be installed from Safari: Share → Add to Home Screen opens it full screen. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'SnaploreBooth',
    short_name: 'Booth',
    description: 'Photobooth — foto, hias, cetak, bawa pulang.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'landscape',
    background_color: '#181816',
    theme_color: '#181816',
    icons: [
      { src: '/pwa-icon/192', sizes: '192x192', type: 'image/png' },
      { src: '/pwa-icon/512', sizes: '512x512', type: 'image/png' },
    ],
  };
}
