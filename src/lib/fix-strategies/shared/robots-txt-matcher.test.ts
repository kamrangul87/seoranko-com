import { describe, expect, it } from 'vitest'
import {
  ROBOTS_TXT_MAX_BYTES,
  isPathAllowed,
} from './robots-txt-matcher'

describe('isPathAllowed', () => {
  it('equal-length Allow and Disallow → Allow wins', () => {
    const robots = `
User-agent: *
Disallow: /folder
Allow: /folder
`
    const result = isPathAllowed(robots, 'Googlebot', '/folder')
    expect(result.allowed).toBe(true)
    expect(result.matchedRule).toBe('Allow: /folder')
  })

  it('longer Disallow wins over shorter Allow', () => {
    const robots = `
User-agent: *
Allow: /fold
Disallow: /folder
`
    const result = isPathAllowed(robots, '*', '/folder')
    expect(result.allowed).toBe(false)
    expect(result.matchedRule).toBe('Disallow: /folder')
  })

  it('supports * wildcards and $ end anchors', () => {
    const robots = `
User-agent: *
Disallow: /*.pdf$
Allow: /private/*/ok
`
    expect(isPathAllowed(robots, 'Googlebot', '/docs/file.pdf').allowed).toBe(
      false,
    )
    expect(isPathAllowed(robots, 'Googlebot', '/docs/file.pdfx').allowed).toBe(
      true,
    )
    expect(isPathAllowed(robots, 'Googlebot', '/private/x/ok').allowed).toBe(
      true,
    )
  })

  it('path matching is case-sensitive', () => {
    const robots = `
User-agent: *
Disallow: /Private
`
    expect(isPathAllowed(robots, 'Googlebot', '/Private').allowed).toBe(false)
    expect(isPathAllowed(robots, 'Googlebot', '/private').allowed).toBe(true)
  })

  it('user-agent selection is case-insensitive with * fallback', () => {
    const robots = `
User-agent: Googlebot
Disallow: /secret

User-agent: *
Disallow: /other
`
    expect(isPathAllowed(robots, 'googlebot', '/secret').allowed).toBe(false)
    expect(isPathAllowed(robots, 'googlebot', '/other').allowed).toBe(true)

    const onlyStar = `
User-agent: *
Disallow: /blocked
`
    expect(isPathAllowed(onlyStar, 'Bingbot', '/blocked').allowed).toBe(false)
  })

  it('empty robots.txt → allowed (no match)', () => {
    const result = isPathAllowed('', 'Googlebot', '/anything')
    expect(result.allowed).toBe(true)
    expect(result.matchedRule).toBeNull()
  })

  it('truncates body above 500 KiB so later rules are ignored', () => {
    const pad = 'A'.repeat(ROBOTS_TXT_MAX_BYTES)
    const robots =
      `User-agent: *\nAllow: /\n#${pad}\nDisallow: /hidden\n`
    // The Disallow after the 500 KiB cut must not apply.
    const result = isPathAllowed(robots, 'Googlebot', '/hidden')
    expect(result.allowed).toBe(true)
  })
})
