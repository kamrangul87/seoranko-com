// Deterministic Quality Gate regression harness (Part 1).
//
// Runs the real runQualityGate over 20 real generated articles (+ 2 hand-
// written synthetic fixtures for rules no real article currently trips) —
// zero API calls, zero model calls, so this suite is fast and repeatable.
// skipLiveVerification disables the one network-touching step
// (autoVerifyCitedPolicyIssues re-fetching a cited URL); no
// freshnessResearchProvider is passed, so the freshness-evaluation path
// also stays fully local. See src/lib/quality-gate/__fixtures__/MANIFEST.md
// for what each fixture is and why.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { runQualityGate } from '@/lib/article-quality-gate'
import { wordCountBand } from '@/lib/word-count'

const FIXTURES_DIR = path.join(__dirname, '..', '__fixtures__')

interface Fixture {
  id: string
  title: string
  keyword: string
  brand: string | null
  market: string | null
  requestedWordCount: number
  content: string
  knownFailingRules: string[]
}

function loadFixtures(): Array<{ file: string; fixture: Fixture }> {
  return fs
    .readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((file) => ({
      file,
      fixture: JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, file), 'utf-8')) as Fixture,
    }))
}

async function runGateForFixture(fixture: Fixture) {
  const band = wordCountBand(fixture.requestedWordCount || 1500)
  return runQualityGate(fixture.content, {
    brand: fixture.brand || '',
    keyword: fixture.keyword,
    authorName: 'Kamran Gul',
    registeredLinkDomains: fixture.brand ? [String(fixture.brand).replace(/^https?:\/\//, '')] : [],
    minWordCount: band.min,
    maxWordCount: band.max,
    // Exercised regardless of this fixture's real brand_settings state
    // (brand_settings is empty in production right now) — this harness is
    // testing the validator's mechanical behavior, not today's live policy.
    expectOrganizationLogo: true,
    skipLiveVerification: true,
  })
}

describe('Quality Gate regression harness', () => {
  const fixtures = loadFixtures()

  it('has at least one fixture', () => {
    expect(fixtures.length).toBeGreaterThan(0)
  })

  it('runs the full deterministic gate over every fixture in under 5 seconds, zero network calls', async () => {
    const originalFetch = global.fetch
    let fetchCalled = false
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    global.fetch = (async (...args: any[]) => {
      fetchCalled = true
      throw new Error(`Unexpected network call in regression harness: ${args[0]}`)
    }) as typeof fetch

    const start = Date.now()
    try {
      for (const { fixture } of fixtures) {
        await runGateForFixture(fixture)
      }
    } finally {
      global.fetch = originalFetch
    }
    const elapsed = Date.now() - start

    expect(fetchCalled).toBe(false)
    expect(elapsed).toBeLessThan(5000)
  })

  it('snapshots the violation set (id, category, severity) per fixture', async () => {
    for (const { file, fixture } of fixtures) {
      const qr = await runGateForFixture(fixture)
      const summary = qr.issues
        .map((i) => ({ id: i.id, category: i.category, severity: i.severity }))
        .sort((a, b) => a.id.localeCompare(b.id))
      expect(summary).toMatchSnapshot(file)
    }
  })

  // ── Known-failing rule coverage ──────────────────────────────────────
  // A green suite here with no matching fixture found would mean the
  // fixtures are wrong, not that the rule holds.

  it('M02: flags a fixture with no Article.image', async () => {
    const target = fixtures.find(({ fixture }) => fixture.knownFailingRules.includes('M02'))
    expect(target, 'no fixture tagged M02 — fixtures are wrong').toBeTruthy()
    const qr = await runGateForFixture(target!.fixture)
    const hit = qr.issues.find((i) => i.category === 'schema' && /image/i.test(i.id))
    expect(hit, `expected an image-related schema issue on ${target!.file}`).toBeTruthy()
  })

  it('M07: flags a fixture with no Organization.logo', async () => {
    const target = fixtures.find(({ fixture }) => fixture.knownFailingRules.includes('M07'))
    expect(target, 'no fixture tagged M07 — fixtures are wrong').toBeTruthy()
    const qr = await runGateForFixture(target!.fixture)
    const hit = qr.issues.find((i) => i.category === 'schema' && /logo/i.test(i.id))
    expect(hit, `expected a logo-related schema issue on ${target!.file}`).toBeTruthy()
  })

  it('S05: flags a fixture with dense (6+ sentence) paragraphs', async () => {
    const target = fixtures.find(({ fixture }) => fixture.knownFailingRules.includes('S05'))
    expect(target, 'no fixture tagged S05 — fixtures are wrong').toBeTruthy()
    const qr = await runGateForFixture(target!.fixture)
    const hit = qr.issues.find((i) => i.category === 'scannability')
    expect(hit, `expected a scannability issue on ${target!.file}`).toBeTruthy()
  })

  it('S14: flags a fixture with a merge-artifact / corruption pattern', async () => {
    const target = fixtures.find(({ fixture }) => fixture.knownFailingRules.includes('S14'))
    expect(target, 'no fixture tagged S14 — fixtures are wrong').toBeTruthy()
    const qr = await runGateForFixture(target!.fixture)
    const hit = qr.issues.find((i) => i.category === 'merge-artifact')
    expect(hit, `expected a merge-artifact issue on ${target!.file}`).toBeTruthy()
  })

  it('C04: flags a fixture with an unsourced time-anchored claim', async () => {
    const target = fixtures.find(({ fixture }) => fixture.knownFailingRules.includes('C04'))
    expect(target, 'no fixture tagged C04 — fixtures are wrong').toBeTruthy()
    const qr = await runGateForFixture(target!.fixture)
    const hit = qr.issues.find((i) => i.category === 'dated-policy' && i.severity !== 'info')
    expect(hit, `expected a dated-policy issue on ${target!.file}`).toBeTruthy()
  })
})
