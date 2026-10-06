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
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: 16,
              background: '#FF6B2C',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontSize: 40,
              fontWeight: 800,
            }}
          >
            S
          </div>
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
