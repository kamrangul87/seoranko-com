import { describe, expect, it } from 'vitest'
import { assemblePrivacyPage } from './assembler'
import { buildSiteInventory } from './inventory'

const FULL_FIELDS = {
  controllerName: 'Example Ltd',
  controllerAddress: '1 High Street, London',
  contactEmail: 'privacy@example.com',
  jurisdiction: 'UK',
  retentionSummary: 'We keep data only as long as needed for each purpose.',
  retentionAnalytics: '14 months',
  retentionForms: '24 months',
}

describe('privacy page assembler', () => {
  it('refuses when required fields are missing', () => {
    const inventory = buildSiteInventory([])
    const result = assemblePrivacyPage(inventory, {
      ...FULL_FIELDS,
      controllerName: '',
      jurisdiction: '',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reasons).toEqual(
        expect.arrayContaining([
          'missing required field: controller name',
          'missing required field: jurisdiction',
        ]),
      )
    }
  })

  it('assembles HTML/MDX with vendor clauses when fields are complete', () => {
    const inventory = buildSiteInventory([
      {
        url: 'https://example.com/',
        html: `<script src="https://www.googletagmanager.com/gtag/js?id=G-X"></script>`,
      },
    ])
    const result = assemblePrivacyPage(inventory, FULL_FIELDS)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.html).toContain('Example Ltd')
      expect(result.html).toContain('Google Analytics 4')
      expect(result.html).not.toMatch(/not legal advice/i)
      expect(result.mdx).toContain('## Who we are')
    }
  })

  it('refuses unknown jurisdiction without inventing a supervisory authority', () => {
    const inventory = buildSiteInventory([])
    const result = assemblePrivacyPage(inventory, {
      ...FULL_FIELDS,
      jurisdiction: 'Atlantis',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reasons[0]).toMatch(/no mapped supervisory authority/i)
    }
  })
})
