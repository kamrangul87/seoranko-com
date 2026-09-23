import Link from 'next/link'

/**
 * Global site footer. Company / Companies House disclosure lives only on
 * /privacy and /terms — not here.
 */
export function CompanyFooter() {
  return (
    <footer
      style={{
        background: '#fff',
        borderTop: '1px solid #E8E8E4',
        padding: '28px 48px',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '16px 32px',
          justifyContent: 'space-between',
          alignItems: 'center',
          maxWidth: 1040,
          margin: '0 auto',
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 700 }}>Seoranko</div>
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <Link href="/privacy" style={{ fontSize: 12, color: '#9B9B9B', textDecoration: 'none' }}>
            Legal
          </Link>
          <a href="mailto:hello@seoranko.com" style={{ fontSize: 12, color: '#9B9B9B', textDecoration: 'none' }}>
            Contact
          </a>
        </div>
      </div>
    </footer>
  )
}
