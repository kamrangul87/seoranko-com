import { describe, expect, it } from 'vitest'
import {
  stripSpaShellCanonicalAndOgUrl,
  verifySpaRoutesSetClientCanonical,
  planSpaShellCanonicalStrip,
} from './spa-shell-canonical'

const SHELL = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Autodun</title>
    <link rel="canonical" href="https://autodun.com" />
    <meta property="og:url" content="https://autodun.com" />
  </head>
  <body><div id="root"></div></body>
</html>`

describe('stripSpaShellCanonicalAndOgUrl', () => {
  it('removes hardcoded canonical and og:url from the shell only', () => {
    const { html, updated } = stripSpaShellCanonicalAndOgUrl(SHELL)
    expect(updated).toBeGreaterThanOrEqual(2)
    expect(html).not.toMatch(/rel=["']canonical["']/i)
    expect(html).not.toMatch(/property=["']og:url["']/i)
    expect(html).toContain('id="root"')
  })
})

describe('verifySpaRoutesSetClientCanonical', () => {
  it('passes when every route file calls setSEO/Helmet with canonical', () => {
    const files: Record<string, string> = {
      'src/pages/Privacy.tsx': `
        useEffect(() => { setSEO({ title: "P", canonical: "https://autodun.com/privacy" }) }, [])
      `,
      'src/pages/Contact.tsx': `
        setSEO({ canonical: "https://autodun.com/contact", title: "C" })
      `,
      'src/pages/Index.tsx': `
        setSEO({ canonical: "https://autodun.com", title: "Home" })
      `,
    }
    const r = verifySpaRoutesSetClientCanonical({
      routeFiles: Object.keys(files),
      readFile: (p) => files[p] ?? null,
    })
    expect(r.ok).toBe(true)
    expect(r.missing).toEqual([])
  })

  it('fails closed when any SPA route lacks a client canonical', () => {
    const files: Record<string, string> = {
      'src/pages/Privacy.tsx': `setSEO({ title: "P", canonical: "https://autodun.com/privacy" })`,
      'src/pages/About.tsx': `setSEO({ title: "About" })`, // no canonical
    }
    const r = verifySpaRoutesSetClientCanonical({
      routeFiles: Object.keys(files),
      readFile: (p) => files[p] ?? null,
    })
    expect(r.ok).toBe(false)
    expect(r.missing).toContain('src/pages/About.tsx')
  })
})

describe('planSpaShellCanonicalStrip', () => {
  it('plans shell strip when shell has homepage canonical and all routes set client canonical', () => {
    const plan = planSpaShellCanonicalStrip({
      shellPath: 'index.html',
      shellHtml: SHELL,
      brokenCanonical: 'https://autodun.com/',
      routeFiles: ['src/pages/Privacy.tsx'],
      readFile: (p) =>
        p === 'src/pages/Privacy.tsx'
          ? 'setSEO({ canonical: "https://autodun.com/privacy" })'
          : null,
    })
    expect(plan.action).toBe('strip-shell')
    expect(plan.shellPath).toBe('index.html')
  })

  it('returns human-review when a route is missing client canonical', () => {
    const plan = planSpaShellCanonicalStrip({
      shellPath: 'index.html',
      shellHtml: SHELL,
      brokenCanonical: 'https://autodun.com',
      routeFiles: ['src/pages/Privacy.tsx', 'src/pages/About.tsx'],
      readFile: (p) =>
        p === 'src/pages/Privacy.tsx'
          ? 'setSEO({ canonical: "https://x/privacy" })'
          : p === 'src/pages/About.tsx'
            ? 'export default function About(){ return null }'
            : null,
    })
    expect(plan.action).toBe('human-review')
  })
})
