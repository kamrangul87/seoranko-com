import { describe, expect, it } from 'vitest'
import { resolveDuplicateUrlArtefactPath } from './resolve-artefact'

describe('resolveDuplicateUrlArtefactPath', () => {
  it('prefers next.config when present in repo files', () => {
    expect(
      resolveDuplicateUrlArtefactPath({
        repoFiles: ['package.json', 'next.config.mjs', 'vercel.json'],
      }),
    ).toBe('next.config.mjs')
  })

  it('uses vercel.json when repo has no next.config', () => {
    expect(
      resolveDuplicateUrlArtefactPath({
        repoFiles: ['vite.config.ts', 'vercel.json', 'index.html'],
      }),
    ).toBe('vercel.json')
  })

  it('infers vercel.json from non-Next HTML samples', () => {
    expect(
      resolveDuplicateUrlArtefactPath({
        htmlSamples: ['<!doctype html><html><body>Vite SPA</body></html>'],
      }),
    ).toBe('vercel.json')
  })

  it('infers next.config.js from Next HTML markers', () => {
    expect(
      resolveDuplicateUrlArtefactPath({
        htmlSamples: ['<script id="__NEXT_DATA__" type="application/json">{}</script>'],
      }),
    ).toBe('next.config.js')
  })

  it('defaults to next.config.js when no signals', () => {
    expect(resolveDuplicateUrlArtefactPath()).toBe('next.config.js')
  })
})
