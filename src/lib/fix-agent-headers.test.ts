import { describe, expect, it } from 'vitest'
import {
  IMMEDIATE_SECURITY_HEADERS,
  mergeNextConfigHeaders,
  mergeVercelJsonHeaders,
} from './fix-agent-headers'

describe('security header merges', () => {
  it('adds X-Frame and nosniff to empty vercel.json', () => {
    const r = mergeVercelJsonHeaders('{}', IMMEDIATE_SECURITY_HEADERS)
    expect(r.changed).toBe(true)
    const parsed = JSON.parse(r.content)
    const headers = parsed.headers[0].headers
    expect(headers).toEqual(
      expect.arrayContaining([
        { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
      ]),
    )
  })

  it('is idempotent when vercel.json already has the headers', () => {
    const first = mergeVercelJsonHeaders('{}', IMMEDIATE_SECURITY_HEADERS)
    const second = mergeVercelJsonHeaders(first.content, IMMEDIATE_SECURITY_HEADERS)
    expect(second.changed).toBe(false)
  })

  it('adds headers() to a bare next.config', () => {
    const r = mergeNextConfigHeaders(
      `const nextConfig = {\n  reactStrictMode: true,\n}\nmodule.exports = nextConfig\n`,
      IMMEDIATE_SECURITY_HEADERS,
    )
    expect(r.changed).toBe(true)
    expect(r.content).toMatch(/async headers\(\)/)
    expect(r.content).toMatch(/X-Frame-Options/)
    expect(r.content).toMatch(/nosniff/)
  })

  it('can append CSP-Report-Only to vercel.json', () => {
    const base = mergeVercelJsonHeaders('{}', IMMEDIATE_SECURITY_HEADERS)
    const withCsp = mergeVercelJsonHeaders(base.content, [
      {
        key: 'Content-Security-Policy-Report-Only',
        value: "default-src 'self'; script-src 'self' https://www.googletagmanager.com",
      },
    ])
    expect(withCsp.changed).toBe(true)
    expect(withCsp.content).toMatch(/Content-Security-Policy-Report-Only/)
  })
})
