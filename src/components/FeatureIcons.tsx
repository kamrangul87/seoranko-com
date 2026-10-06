import type { ReactNode } from 'react'
import type { FeatureIconKey } from '@/lib/homepage-copy'

const stroke = '#FF6B2C'

function IconShell({ children }: { children: ReactNode }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke={stroke}
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export function FeatureIcon({ name }: { name: FeatureIconKey }) {
  switch (name) {
    case 'crawl':
      return (
        <IconShell>
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.3-4.3" />
        </IconShell>
      )
    case 'findings':
      return (
        <IconShell>
          <path d="M8 6h13M8 12h13M8 18h13" />
          <path d="M3 6h.01M3 12h.01M3 18h.01" />
        </IconShell>
      )
    case 'fix':
      return (
        <IconShell>
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.1-3.1a1 1 0 0 0 0-1.4l-1.6-1.6a1 1 0 0 0-1.4 0z" />
          <path d="M12 8L4 16v4h4l8-8" />
        </IconShell>
      )
    case 'verify':
      return (
        <IconShell>
          <path d="M20 6L9 17l-5-5" />
        </IconShell>
      )
    case 'monitor':
      return (
        <IconShell>
          <path d="M3 12a9 9 0 1 0 9-9" />
          <path d="M3 4v5h5" />
          <path d="M12 7v5l3 2" />
        </IconShell>
      )
    case 'refuse':
      return (
        <IconShell>
          <circle cx="12" cy="12" r="9" />
          <path d="M5 5l14 14" />
        </IconShell>
      )
    default:
      return null
  }
}
