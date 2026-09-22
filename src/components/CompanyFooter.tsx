import Link from 'next/link'

/** UK Companies Act disclosure block — shown on marketing + legal pages. */
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
          alignItems: 'flex-start',
          maxWidth: 1040,
          margin: '0 auto',
        }}
      >
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>
            Seoranko
          </div>
          <p style={{ fontSize: 12, color: '#6B6B6B', lineHeight: 1.55, maxWidth: 420, margin: 0 }}>
            Operated by <strong>MINSO LTD</strong> (Companies House{' '}
            <strong>17098778</strong>), registered in England and Wales.
            Registered office:{' '}
            <span
              style={{
                background: '#FFFBEB',
                border: '1px solid #FCD34D',
                borderRadius: 4,
                padding: '1px 6px',
              }}
            >
              [PLACEHOLDER — owner to fill registered office address]
            </span>
          </p>
          <p style={{ fontSize: 12, color: '#9B9B9B', margin: '8px 0 0' }}>
            © {new Date().getFullYear()} MINSO LTD. All rights reserved.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <Link href="/privacy" style={{ fontSize: 12, color: '#9B9B9B', textDecoration: 'none' }}>
            Privacy
          </Link>
          <Link href="/terms" style={{ fontSize: 12, color: '#9B9B9B', textDecoration: 'none' }}>
            Terms
          </Link>
          <a href="mailto:hello@seoranko.com" style={{ fontSize: 12, color: '#9B9B9B', textDecoration: 'none' }}>
            Contact
          </a>
        </div>
      </div>
    </footer>
  )
}
