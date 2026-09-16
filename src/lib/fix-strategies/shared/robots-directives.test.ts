import { describe, expect, it } from 'vitest'
import {
  expandRobotsDirectives,
  extractPageRobotsDirectives,
  effectiveRobotsTokens,
  setHasNoindex,
  tokenSetsEqual,
} from './robots-directives'

describe('expandRobotsDirectives', () => {
  it('expands none to noindex + nofollow case-insensitively', () => {
    expect([...expandRobotsDirectives('NONE')].sort()).toEqual([
      'nofollow',
      'noindex',
    ])
    expect([...expandRobotsDirectives('None')].sort()).toEqual([
      'nofollow',
      'noindex',
    ])
  })

  it('tokenises case-insensitively and splits commas', () => {
    const t = expandRobotsDirectives('Index, NoFollow')
    expect(t.has('index')).toBe(true)
    expect(t.has('nofollow')).toBe(true)
  })
})

describe('extractPageRobotsDirectives', () => {
  it('reads meta in body (R8) and X-Robots-Tag', () => {
    const html = `<!doctype html><html><head><title>t</title></head>
      <body><meta name="ROBOTS" content="none"><p>x</p></body></html>`
    const dirs = extractPageRobotsDirectives(
      new Headers({ 'x-robots-tag': 'noarchive' }),
      html,
      'text/html',
    )
    expect(setHasNoindex(dirs.metaRobots!.tokens)).toBe(true)
    expect(dirs.xRobotsTags[0]!.tokens.has('noarchive')).toBe(true)
  })

  it('treats robots vs googlebot as separate sets', () => {
    const html = `<!doctype html><html><head>
      <meta name="robots" content="index">
      <meta name="googlebot" content="noindex">
    </head><body></body></html>`
    const dirs = extractPageRobotsDirectives(new Headers(), html, 'text/html')
    expect(dirs.metaRobots!.tokens.has('index')).toBe(true)
    expect(dirs.metaGooglebot!.tokens.has('noindex')).toBe(true)
    expect(tokenSetsEqual(dirs.metaRobots!.tokens, dirs.metaGooglebot!.tokens)).toBe(
      false,
    )
  })
})

describe('effectiveRobotsTokens', () => {
  it('restrictive wins (R6)', () => {
    const e = effectiveRobotsTokens([
      expandRobotsDirectives('index,follow'),
      expandRobotsDirectives('noindex'),
    ])
    expect(e.has('noindex')).toBe(true)
    expect(e.has('index')).toBe(false)
  })
})
