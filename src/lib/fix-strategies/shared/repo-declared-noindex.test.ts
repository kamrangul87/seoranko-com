import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  checkRepoDeclaredNoindex,
  inspectNoindexSource,
} from './repo-declared-noindex'
import { resolvePath } from '../site-model'

const temps: string[] = []

function makeApp(structure: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-noindex-'))
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

describe('checkRepoDeclaredNoindex', () => {
  it('covers static metadata robots index:false on the page → true', () => {
    const appDir = makeApp({
      'app/hidden/page.tsx':
        'export const metadata = { robots: { index: false } }\nexport default function Page(){return null}',
    })
    const resolved = resolvePath(appDir, '/hidden')
    expect(resolved.routeFile).toBeTruthy()
    expect(checkRepoDeclaredNoindex(resolved.routeFile!, appDir)).toBe('true')
  })

  it('covers noindex cascading from a parent layout → true', () => {
    const appDir = makeApp({
      'app/layout.tsx':
        'export const metadata = { robots: { index: false } }\nexport default function Layout({children}){return children}',
      'app/visible/page.tsx': 'export default function Page(){return null}',
    })
    const resolved = resolvePath(appDir, '/visible')
    expect(checkRepoDeclaredNoindex(resolved.routeFile!, appDir)).toBe('true')
  })

  it('covers conditional generateMetadata → indeterminate', () => {
    const source = `
      export async function generateMetadata({ searchParams }) {
        if (searchParams.draft) return { robots: { index: false } }
        return { robots: { index: true } }
      }
      export default function Page(){return null}
    `
    expect(inspectNoindexSource(source)).toBe('indeterminate')

    const appDir = makeApp({
      'app/draft/page.tsx': source,
    })
    const resolved = resolvePath(appDir, '/draft')
    expect(checkRepoDeclaredNoindex(resolved.routeFile!, appDir)).toBe(
      'indeterminate',
    )
  })

  it('returns false when no noindex is declared', () => {
    const appDir = makeApp({
      'app/ok/page.tsx': 'export default function Page(){return null}',
    })
    const resolved = resolvePath(appDir, '/ok')
    expect(checkRepoDeclaredNoindex(resolved.routeFile!, appDir)).toBe('false')
  })
})
