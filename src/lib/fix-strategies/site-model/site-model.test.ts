import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  declaresNoindex,
  detectRouteRoots,
  inspectNoindexSource,
  resolvePath,
} from './index'

const temps: string[] = []

function makeApp(structure: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'site-model-'))
  temps.push(root)
  const appDir = path.join(root, 'app')
  fs.mkdirSync(appDir, { recursive: true })
  for (const [rel, contents] of Object.entries(structure)) {
    const full = path.join(root, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, contents)
  }
  return appDir
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('resolvePath', () => {
  it('resolves a static route', () => {
    const appDir = makeApp({
      'app/about/page.tsx': 'export default function Page(){return null}',
    })
    const result = resolvePath(appDir, '/about')
    expect(result.kind).toBe('static-route')
    expect(result.routeFile?.endsWith(`${path.sep}about${path.sep}page.tsx`)).toBe(
      true,
    )
  })

  it('strips route groups from the URL', () => {
    const appDir = makeApp({
      'app/(marketing)/pricing/page.tsx':
        'export default function Page(){return null}',
    })
    const result = resolvePath(appDir, '/pricing')
    expect(result.kind).toBe('static-route')
    expect(result.routeFile).toContain(`${path.sep}pricing${path.sep}page.tsx`)
  })

  it('ignores parallel @slot folders', () => {
    const appDir = makeApp({
      'app/dashboard/page.tsx': 'export default function Page(){return null}',
      'app/dashboard/@modal/page.tsx':
        'export default function Page(){return null}',
    })
    const result = resolvePath(appDir, '/dashboard')
    expect(result.kind).toBe('static-route')
    expect(result.routeFile?.endsWith(`${path.sep}dashboard${path.sep}page.tsx`)).toBe(
      true,
    )
  })

  it('matches [param] as dynamic-route', () => {
    const appDir = makeApp({
      'app/blog/[slug]/page.tsx': 'export default function Page(){return null}',
    })
    const result = resolvePath(appDir, '/blog/hello')
    expect(result.kind).toBe('dynamic-route')
    expect(result.routeFile).toContain(`${path.sep}[slug]${path.sep}page.tsx`)
  })

  it('does not let [...slug] match the parent root', () => {
    const appDir = makeApp({
      'app/shop/[...slug]/page.tsx':
        'export default function Page(){return null}',
    })
    expect(resolvePath(appDir, '/shop').kind).toBe('no-route')
    expect(resolvePath(appDir, '/shop/a').kind).toBe('dynamic-route')
  })

  it('lets [[...slug]] match the parent root', () => {
    const appDir = makeApp({
      'app/docs/[[...slug]]/page.tsx':
        'export default function Page(){return null}',
    })
    expect(resolvePath(appDir, '/docs').kind).toBe('dynamic-route')
    expect(resolvePath(appDir, '/docs/a/b').kind).toBe('dynamic-route')
  })

  it('prefers the most specific match', () => {
    const appDir = makeApp({
      'app/blog/[slug]/page.tsx': 'export default function Page(){return null}',
      'app/blog/about/page.tsx': 'export default function Page(){return null}',
    })
    const result = resolvePath(appDir, '/blog/about')
    expect(result.kind).toBe('static-route')
    expect(result.routeFile).toContain(`${path.sep}about${path.sep}page.tsx`)
  })

  it('returns indeterminate when middleware rewrites exist', () => {
    const appDir = makeApp({
      'app/page.tsx': 'export default function Page(){return null}',
      'middleware.ts':
        'import { NextResponse } from "next/server"; export function middleware(req){ return NextResponse.rewrite(new URL("/other", req.url)) }',
    })
    expect(resolvePath(appDir, '/').kind).toBe('indeterminate')
  })

  it('does not treat middleware presence alone as indeterminate (no rewrite)', () => {
    // Autodun / SEORANKO pattern: next() / redirect / headers only.
    const appDir = makeApp({
      'app/about/page.tsx': 'export default function Page(){return null}',
      'middleware.ts':
        'import { NextResponse } from "next/server"; export function middleware(){ return NextResponse.next() }',
    })
    expect(resolvePath(appDir, '/about').kind).toBe('static-route')
  })
})

describe('declaresNoindex', () => {
  it('detects static metadata robots index:false on the page', () => {
    const appDir = makeApp({
      'app/hidden/page.tsx':
        'export const metadata = { robots: { index: false } }\nexport default function Page(){return null}',
    })
    const resolved = resolvePath(appDir, '/hidden')
    expect(resolved.routeFile).toBeTruthy()
    expect(declaresNoindex(resolved.routeFile!, appDir)).toBe('true')
  })

  it('detects noindex cascading from a parent layout', () => {
    const appDir = makeApp({
      'app/layout.tsx':
        'export const metadata = { robots: { index: false } }\nexport default function Layout({children}){return children}',
      'app/visible/page.tsx': 'export default function Page(){return null}',
    })
    const resolved = resolvePath(appDir, '/visible')
    expect(declaresNoindex(resolved.routeFile!, appDir)).toBe('true')
  })

  it('returns indeterminate when generateMetadata sets robots conditionally', () => {
    const source = `
      export async function generateMetadata({ searchParams }) {
        if (searchParams.draft) return { robots: { index: false } }
        return { robots: { index: true } }
      }
      export default function Page(){return null}
    `
    expect(inspectNoindexSource(source)).toBe('indeterminate')
  })

  it('returns false when no noindex is declared', () => {
    const appDir = makeApp({
      'app/ok/page.tsx': 'export default function Page(){return null}',
    })
    const resolved = resolvePath(appDir, '/ok')
    expect(declaresNoindex(resolved.routeFile!, appDir)).toBe('false')
  })
})

describe('detectRouteRoots', () => {
  it('prefers src/app when present and includes secondary pages roots', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'site-roots-'))
    temps.push(root)
    fs.mkdirSync(path.join(root, 'src/app/about'), { recursive: true })
    fs.writeFileSync(
      path.join(root, 'src/app/about/page.tsx'),
      'export default function Page(){return null}',
    )
    fs.mkdirSync(path.join(root, 'src/pages'), { recursive: true })
    fs.writeFileSync(
      path.join(root, 'src/pages/Privacy.tsx'),
      'export default function Privacy(){return null}',
    )
    // decoy empty app/ should not win over src/app
    fs.mkdirSync(path.join(root, 'app'), { recursive: true })

    const roots = detectRouteRoots(root)
    expect(roots.map((r) => r.relDir)).toEqual(['src/app', 'src/pages'])
    expect(roots.every((r) => r.absDir.startsWith(root))).toBe(true)
  })

  it('returns empty when no route trees exist', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'site-roots-empty-'))
    temps.push(root)
    expect(detectRouteRoots(root)).toEqual([])
  })
})
