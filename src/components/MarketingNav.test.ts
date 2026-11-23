import { describe, expect, it, vi } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MARKETING_NAV_LINKS, MarketingNav } from '@/components/MarketingNav'

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string
    children?: ReactNode
    style?: React.CSSProperties
  }) => createElement('a', { href, ...rest }, children),
}))

describe('MarketingNav', () => {
  it('links pricing, about, and the autodun case study from the header', () => {
    expect(MARKETING_NAV_LINKS.map((l) => l.href)).toEqual(
      expect.arrayContaining(['/pricing', '/about', '/case-studies/autodun']),
    )
    const html = renderToStaticMarkup(createElement(MarketingNav))
    expect(html).toContain('href="/pricing"')
    expect(html).toContain('href="/about"')
    expect(html).toContain('href="/case-studies/autodun"')
    expect(html).toContain('href="/#features"')
    expect(html).not.toContain('/dashboard')
  })
})
