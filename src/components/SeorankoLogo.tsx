import type { CSSProperties } from 'react'

/** Orange “S” tile — matches existing brand mark (#FF6B2C). */
export const SEORANKO_LOGO_MARK_PATH =
  'M18 8.2c0-2.4-1.7-3.7-4.6-3.7H8.2v4.1h4.8c1.1 0 1.7.5 1.7 1.3 0 .9-.6 1.4-1.7 1.4H8.2V24h5.6c3.2 0 5.2-1.5 5.2-4.1 0-1.7-.9-2.8-2.5-3.4 1.8-.6 2.7-2 2.7-4.1z'

type LogoProps = {
  size?: number
  className?: string
  title?: string
}

export function SeorankoLogoMark({ size = 32, className, title = 'SEORANKO' }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label={title}
    >
      <rect width="32" height="32" rx="7" fill="#FF6B2C" />
      <path d={SEORANKO_LOGO_MARK_PATH} fill="#FFFFFF" />
    </svg>
  )
}

export function SeorankoWordmark({
  size = 32,
  gap = 10,
  textStyle,
}: {
  size?: number
  gap?: number
  textStyle?: CSSProperties
}) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap }}>
      <SeorankoLogoMark size={size} />
      <span
        style={{
          fontWeight: 700,
          fontSize: size >= 32 ? 18 : 16,
          letterSpacing: '-0.3px',
          color: '#0F0F0F',
          ...textStyle,
        }}
      >
        SEORANKO
      </span>
    </span>
  )
}
