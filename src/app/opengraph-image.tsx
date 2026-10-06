import { ImageResponse } from 'next/og'

export const runtime = 'edge'
export const alt = 'SEORANKO — Find, fix and verify the technical problems blocking Google indexing'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '72px 80px',
          background: '#FAFAF8',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 48 }}>
          <svg width="72" height="72" viewBox="0 0 32 32" fill="none">
            <rect width="32" height="32" rx="7" fill="#FF6B2C" />
            <path
              d="M21.5 9.8c0-1.9-1.85-3.2-5.5-3.2S10.5 8.2 10.5 10.1c0 4.7 11 3.35 11 9.55 0 2.65-2.25 4.45-5.5 4.45s-5.5-1.75-5.5-4.15"
              stroke="#FFFFFF"
              strokeWidth="3.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </svg>
          <div style={{ fontSize: 42, fontWeight: 800, color: '#0F0F0F', letterSpacing: '-1px' }}>
            SEORANKO
          </div>
        </div>
        <div
          style={{
            fontSize: 44,
            fontWeight: 700,
            color: '#0F0F0F',
            lineHeight: 1.25,
            letterSpacing: '-1px',
            maxWidth: 920,
          }}
        >
          Finds the technical problems that stop Google indexing your site properly, fixes them in
          your code, and proves the fix is live.
        </div>
      </div>
    ),
    { ...size },
  )
}
