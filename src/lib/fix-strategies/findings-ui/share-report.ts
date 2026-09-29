/**
 * Item 5 — shareable, read-only, per-site fix report.
 *
 * No new source of truth: reads fix_strategies_findings (via the existing
 * FindingsStore + persistedToUiFinding, same as the findings dashboard),
 * and docs/fix-strategies/FIX_VERIFY_OUTCOME_RECORD.md (same ledger
 * regression-report.ts already cross-references) for the PR/commit/
 * production-verify/timestamp fields a finding's own row doesn't carry.
 *
 * Wording rules: every finding line here comes from OWNER_PLAIN_ENGLISH /
 * WHY_NOT_FIXED (owner-copy.ts) via persistedToUiFinding — already
 * scanned banned-word-clean by owner-copy.test.ts. The only copy this
 * file adds itself is section headers / structural labels, scanned by
 * share-report.test.ts against the same BANNED_CLAIM_WORDS_RE.
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { FindingsStore, PersistedFindingRow } from './crawl'
import { persistedToUiFinding } from './map-persisted'
import { ownerPlainEnglish } from './owner-copy'
import type { UiFinding } from './client'

export type LedgerEntry = {
  page: string | null
  topic: string | null
  verdict: string | null
  fixDetail: string | null
  prUrl: string | null
  prNumber: number | null
  mergeSha: string | null
  productionVerifyOk: boolean | null
  productionVerifyAt: string | null
  fixedAt: string | null
  outcome: string | null
}

const FIELD_RE = (label: string) =>
  new RegExp(`\\|\\s*${label}\\s*\\|\\s*(.+?)\\s*\\|\\s*$`, 'im')

function extractField(section: string, label: string): string | null {
  const m = section.match(FIELD_RE(label))
  if (!m) return null
  const raw = m[1]!.trim()
  // Ledger values are often backtick-wrapped inline code (`https://…`,
  // `verdict-slug`) — strip a single matching pair so callers can compare
  // directly against real URLs/verdicts without backticks.
  const backtickMatch = raw.match(/^`([^`]*)`$/)
  return backtickMatch ? backtickMatch[1]! : raw
}

/** Parse every "## N." / "### N." entry in the ledger into a LedgerEntry, skipping non-fix entries (no PR — recaps, excluded/guard rows). */
export function parseOutcomeLedger(markdown: string): LedgerEntry[] {
  const sections = markdown.split(/^#{2,3}\s+\d+/m).slice(1)
  const entries: LedgerEntry[] = []

  for (const section of sections) {
    const prField = extractField(section, 'PR')
    if (!prField) continue // recap / guard / no-fix entries carry no PR row

    const urlMatch = prField.match(/\((https:\/\/github\.com\/[^)]+)\)/)
    if (!urlMatch) continue
    const numMatch =
      prField.match(/#(\d+)/) || prField.match(/pull\/(\d+)/)
    const shaMatch = prField.match(/merge\s+`([0-9a-f]{6,40})`/i)

    const prodVerify = extractField(section, 'Production verify')
    const prodVerifyAtMatch = prodVerify?.match(
      /(\d{4}-\d{2}-\d{2}T[\d:]+Z?)/,
    )

    entries.push({
      page: extractField(section, 'Page'),
      topic: extractField(section, 'Topic'),
      verdict: extractField(section, 'Verdict')?.replace(/`/g, '') ?? null,
      fixDetail: extractField(section, 'Fix detail') ?? extractField(section, 'Fix'),
      prUrl: urlMatch[1]!,
      prNumber: numMatch ? Number(numMatch[1]) : null,
      mergeSha: shaMatch ? shaMatch[1]! : null,
      productionVerifyOk: prodVerify ? /\*\*OK\*\*/i.test(prodVerify) : null,
      productionVerifyAt: prodVerifyAtMatch ? prodVerifyAtMatch[1]! : null,
      fixedAt: extractField(section, 'Fixed'),
      outcome: extractField(section, 'Outcome')?.replace(/\*\*/g, '') ?? null,
    })
  }
  return entries
}

function loadLedgerMarkdown(repoRoot?: string): string {
  const path = resolve(
    repoRoot ?? process.cwd(),
    'docs/fix-strategies/FIX_VERIFY_OUTCOME_RECORD.md',
  )
  if (!existsSync(path)) return ''
  return readFileSync(path, 'utf8')
}

function findLedgerEntry(
  entries: LedgerEntry[],
  finding: PersistedFindingRow,
): LedgerEntry | null {
  return (
    entries.find(
      (e) =>
        e.page === finding.pageUrl &&
        (e.verdict === finding.verdict || e.topic === finding.topicId),
    ) ?? null
  )
}

function inRange(iso: string | null, from: string | null, to: string | null): boolean {
  if (!iso) return false
  if (from && iso < from) return false
  if (to && iso > to) return false
  return true
}

export type ReportFinding = {
  finding: UiFinding
  ledger: LedgerEntry | null
}

/**
 * A fix applied is recorded in the ledger whether or not the finding it
 * closed still exists as an open fix_strategies_findings row today — a
 * verified-closed fix has no reason to still be an open row, and (per the
 * ledger's own "Honest accounting" section) this product's resolution
 * lifecycle did not reliably fire for its earlier fixes anyway. Requiring
 * a live findings-table match here would silently under-report real,
 * production-verified fixes. plainEnglish falls back to the ledger's own
 * "Fix detail" text only when the verdict isn't one of the fixed static
 * OWNER_PLAIN_ENGLISH lines (still never model-generated).
 */
export type FixAppliedEntry = {
  page: string | null
  plainEnglish: string
  ledger: LedgerEntry
}

export type ShareableReport = {
  origin: string
  from: string | null
  to: string | null
  generatedAt: string
  detected: ReportFinding[]
  fixesApplied: FixAppliedEntry[]
  resolved: ReportFinding[]
  regressed: ReportFinding[]
  notFixed: ReportFinding[]
}

function isSameOrigin(page: string | null, origin: string): boolean {
  if (!page) return false
  try {
    return new URL(page).origin === new URL(origin).origin
  } catch {
    return page.startsWith(origin)
  }
}

export async function buildShareableReport(input: {
  siteId: string
  origin: string
  from?: string | null
  to?: string | null
  store: FindingsStore
  repoRoot?: string
}): Promise<ShareableReport> {
  const from = input.from ?? null
  const to = input.to ?? null
  const rows = await input.store.listFindings({
    siteId: input.siteId,
    includeInformational: true,
  })
  const ledgerEntries = parseOutcomeLedger(loadLedgerMarkdown(input.repoRoot))

  const detected: ReportFinding[] = []
  const resolved: ReportFinding[] = []
  const regressed: ReportFinding[] = []
  const notFixed: ReportFinding[] = []

  for (const row of rows) {
    if (!inRange(row.firstSeenAt, from, to) && !inRange(row.lastSeenAt, from, to)) {
      const resolvedInRange = inRange(row.resolvedAt, from, to)
      const regressedInRange = inRange(row.regressionObservedAt, from, to)
      const fixedInRange = inRange(row.fixedAt, from, to)
      if (!resolvedInRange && !regressedInRange && !fixedInRange) continue
    }

    const ledger = findLedgerEntry(ledgerEntries, row)
    const uiFinding = persistedToUiFinding(row, [], {
      fixFlow: ledger?.prUrl
        ? { prUrl: ledger.prUrl, prNumber: ledger.prNumber }
        : null,
    })
    const entry: ReportFinding = { finding: uiFinding, ledger }

    if (inRange(row.firstSeenAt, from, to)) detected.push(entry)
    if (row.status === 'resolved' && inRange(row.resolvedAt, from, to)) {
      resolved.push(entry)
    }
    if (row.status === 'regressed' && inRange(row.regressionObservedAt, from, to)) {
      regressed.push(entry)
    }
    if (uiFinding.whyNotAutoFixed && !ledger && !row.fixedAt) {
      notFixed.push(entry)
    }
  }

  const fixesApplied: FixAppliedEntry[] = ledgerEntries
    .filter((e) => isSameOrigin(e.page, input.origin))
    .filter((e) => inRange(e.fixedAt, from, to) || (!from && !to))
    .map((ledger) => ({
      page: ledger.page,
      plainEnglish:
        (ledger.verdict ? ownerPlainEnglish(ledger.verdict) : null) ??
        ledger.fixDetail ??
        'Fix applied — see the pull request for detail.',
      ledger,
    }))

  return {
    origin: input.origin,
    from,
    to,
    generatedAt: new Date().toISOString(),
    detected,
    fixesApplied,
    resolved,
    regressed,
    notFixed,
  }
}

function sourceLine(f: UiFinding): string {
  const id = f.primarySourceId
  const row = (id != null ? f.sources.find((s) => s.sourceId === id) : null) ?? f.sources[0] ?? null
  const verified = row?.verifiedOn ? `, verified ${row.verifiedOn}` : ''
  const link = row?.url ? ` — ${row.url}` : ''
  return `${f.sourceTier} · #${row?.sourceId ?? id ?? '—'}${verified}${link}`
}

/** Plain-text rendering — what a share link's page shows, and what pastes cleanly into chat. */
export function renderReportText(report: ShareableReport): string {
  const lines: string[] = []
  const range =
    report.from || report.to
      ? `${report.from ?? '…'} to ${report.to ?? '…'}`
      : 'all time'
  lines.push(`SEORANKO fix report — ${report.origin}`)
  lines.push(`Range: ${range} · generated ${report.generatedAt}`)
  lines.push('')

  lines.push(`## Findings detected (${report.detected.length})`)
  for (const { finding } of report.detected) {
    lines.push(`- ${finding.pageUrl ?? '(site-level)'}: ${finding.ownerPlainEnglish}`)
  }
  lines.push('')

  lines.push(`## Fixes applied (${report.fixesApplied.length})`)
  for (const { page, plainEnglish, ledger } of report.fixesApplied) {
    const pr = `PR ${ledger.prUrl}${ledger.mergeSha ? ` (commit ${ledger.mergeSha})` : ''}`
    const verify = ledger.productionVerifyOk
      ? `production verified${ledger.productionVerifyAt ? ` ${ledger.productionVerifyAt}` : ''}`
      : 'production verification not recorded'
    const fixedAt = ledger.fixedAt ? ` · fixed ${ledger.fixedAt}` : ''
    lines.push(`- ${page ?? '(site-level)'}: ${plainEnglish}`)
    lines.push(`  ${pr} · ${verify}${fixedAt}`)
  }
  lines.push('')

  lines.push(`## Resolved (${report.resolved.length})`)
  for (const { finding } of report.resolved) {
    lines.push(`- ${finding.pageUrl ?? '(site-level)'}: ${finding.ownerPlainEnglish}`)
  }
  lines.push('')

  lines.push(`## Regressed (${report.regressed.length})`)
  for (const { finding } of report.regressed) {
    lines.push(`- ${finding.pageUrl ?? '(site-level)'}: ${finding.ownerPlainEnglish}`)
  }
  lines.push('')

  lines.push(`## Deliberately not fixed (${report.notFixed.length})`)
  for (const { finding } of report.notFixed) {
    lines.push(`- ${finding.pageUrl ?? '(site-level)'}: ${finding.ownerPlainEnglish}`)
    lines.push(`  Why: ${finding.whyNotAutoFixed}`)
  }
  lines.push('')

  lines.push(`## Sources`)
  const seen = new Set<string>()
  for (const bucket of [report.detected, report.resolved, report.regressed, report.notFixed]) {
    for (const { finding } of bucket) {
      const line = sourceLine(finding)
      if (seen.has(line)) continue
      seen.add(line)
      lines.push(`- ${finding.pageUrl ?? '(site-level)'}: ${line}`)
    }
  }

  return lines.join('\n')
}
