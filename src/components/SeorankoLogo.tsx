import type { CSSProperties } from 'react'

/**
 * Bold geometric capital S — white stroke on #FF6B2C rounded tile.
 * Stroke (no left stem) so it reads as S, not B, down to 16px.
 * Keep path in sync with src/app/icon.svg.
 */
export const SEORANKO_LOGO_S_STROKE =
  'M21.5 9.8c0-1.9-1.85-3.2-5.5-3.2S10.5 8.2 10.5 10.1c0 4.7 11 3.35 11 9.55 0 2.65-2.25 4.45-5.5 4.45s-5.5-1.75-5.5-4.15'

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
      <path
        d={SEORANKO_LOGO_S_STROKE}
        stroke="#FFFFFF"
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
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
