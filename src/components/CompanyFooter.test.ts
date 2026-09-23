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
  it('shows a Legal link and omits company disclosure', () => {
    const html = renderToStaticMarkup(createElement(CompanyFooter))
    expect(html).toContain('Legal')
    expect(html).toContain('href="/privacy"')
    expect(html).not.toContain('MINSO')
    expect(html).not.toContain('17098778')
    expect(html).not.toContain('PLACEHOLDER')
    expect(html).not.toContain('Registered office')
    expect(html).not.toContain('Companies House')
  })
})
