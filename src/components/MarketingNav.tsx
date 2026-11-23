import Link from 'next/link'
import { SeorankoWordmark } from '@/components/SeorankoLogo'
import { HOMEPAGE_COPY } from '@/lib/homepage-copy'

export const MARKETING_NAV_LINKS = [
  { href: '/#features', label: 'Features' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/about', label: 'About' },
  { href: '/case-studies/autodun', label: 'Case study' },
  { href: '/tools/index-diagnosis', label: HOMEPAGE_COPY.navFreeIndexCheck },
] as const

const linkStyle = { fontSize: 14, color: '#6B6B6B', textDecoration: 'none' as const }

export function MarketingNav() {
  return (
    <nav style={{ background: '#fff', borderBottom: '1px solid #E8E8E4', position: 'sticky', top: 0, zIndex: 50 }}>
      <style>{`
        .hp-nav-inner { display: flex; align-items: center; justify-content: space-between; padding: 0 48px; min-height: 64px; gap: 16px; flex-wrap: wrap; }
        @media (max-width: 900px) {
          .hp-nav-inner { padding: 10px 20px; }
        }
      `}</style>
      <div className="hp-nav-inner">
        <Link href="/" style={{ textDecoration: 'none' }}>
          <SeorankoWordmark size={32} />
        </Link>
        <div style={{ display: 'flex', gap: 28, alignItems: 'center', flexWrap: 'wrap' }}>
          {MARKETING_NAV_LINKS.map((item) => (
            <Link key={item.href} href={item.href} style={linkStyle}>
              {item.label}
            </Link>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <Link
            href="/login"
            style={{
              fontSize: 13,
              color: '#333',
              textDecoration: 'none',
              padding: '7px 16px',
              border: '1px solid #E8E8E4',
              borderRadius: 7,
              background: '#fff',
            }}
          >
            Log in
          </Link>
          <Link
            href="/signup"
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: '#fff',
              textDecoration: 'none',
              padding: '8px 18px',
              background: '#FF6B2C',
              borderRadius: 7,
            }}
          >
            Start free →
          </Link>
        </div>
      </div>
    </nav>
  )
}
