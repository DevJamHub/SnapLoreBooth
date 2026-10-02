import { ImageResponse } from 'next/og';

/** The booth's home-screen icon: a tilted polaroid on warm charcoal. */
export function appIcon(size: number): ImageResponse {
  const card = Math.round(size * 0.56);
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#181816' }}>
        <div
          style={{
            width: card,
            display: 'flex',
            flexDirection: 'column',
            padding: Math.round(card * 0.08),
            paddingBottom: Math.round(card * 0.26),
            background: '#f3eee8',
            borderRadius: Math.round(card * 0.04),
            transform: 'rotate(-7deg)',
          }}
        >
          <div
            style={{
              width: '100%',
              height: Math.round(card * 0.84),
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'linear-gradient(160deg, #cc785c, #6e6259)',
            }}
          >
            <div style={{ width: Math.round(card * 0.26), height: Math.round(card * 0.26), borderRadius: 9999, background: 'rgba(255,255,255,0.45)' }} />
          </div>
        </div>
      </div>
    ),
    { width: size, height: size },
  );
}
