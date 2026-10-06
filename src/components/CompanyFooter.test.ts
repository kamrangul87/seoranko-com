import { describe, expect, it, vi } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { CompanyFooter } from '@/components/CompanyFooter'

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

describe('CompanyFooter', () => {
  it('shows Privacy, Terms, Crawler info, Contact and omits company disclosure', () => {
    const html = renderToStaticMarkup(createElement(CompanyFooter))
    expect(html).toContain('SEORANKO')
    expect(html).toContain('Privacy')
    expect(html).toContain('href="/privacy"')
    expect(html).toContain('Terms')
    expect(html).toContain('href="/terms"')
    expect(html).toContain('Crawler info')
    expect(html).toContain('href="/bot"')
    expect(html).toContain('Contact')
    expect(html).toContain('mailto:hello@seoranko.com')
    expect(html).not.toContain('MINSO')
    expect(html).not.toContain('17098778')
    expect(html).not.toContain('PLACEHOLDER')
    expect(html).not.toContain('Registered office')
    expect(html).not.toContain('Companies House')
  })
})
