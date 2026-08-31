/**
 * Content Brief is seed-only — no DataForSEO in the copilot brief path.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { generateContentBrief } from './content-brief-generator'

describe('copilot brief — seed only (no DataForSEO)', () => {
  it('brief API route does not import keyword research or long-tail expander', () => {
    const src = readFileSync(join(__dirname, '../app/api/copilot/brief/route.ts'), 'utf8')
    expect(src).not.toMatch(/from ['"]@\/lib\/dataforseo['"]/)
    expect(src).not.toMatch(/fetchKeywords/)
    expect(src).not.toMatch(/findLongTailVariants/)
    expect(src).not.toMatch(/clusterKeywords/)
    expect(src).toMatch(/generateContentBrief/)
  })

  it('briefs UI does not show DataForSEO empty-state messaging', () => {
    const src = readFileSync(join(__dirname, '../app/dashboard/briefs/page.tsx'), 'utf8')
    expect(src).not.toMatch(/No DataForSEO/)
    expect(src).not.toMatch(/seed only/i)
    expect(src).not.toMatch(/No long-tail variants/)
    expect(src).not.toMatch(/short-tail/i)
    expect(src).not.toMatch(/clusters/i)
  })

  it('generateContentBrief still works from seed alone', async () => {
    const brief = await generateContentBrief({
      seedKeyword: 'home EV charger installation',
      mode: 'content',
      market: 'UK',
    })
    expect(brief.seedKeyword).toBeTruthy()
    expect(brief.sections.length).toBeGreaterThanOrEqual(3)
    expect(brief.suggestedTitle.length).toBeGreaterThan(5)
  })
})
