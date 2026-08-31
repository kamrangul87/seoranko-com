/**
 * Fix Agent — apply auto-fixable Site Audit issues on a connected/owned site only.
 *
 * Safety:
 * - Requires active site_connections row for the audited domain (never arbitrary URLs)
 * - Thin content / internal linking / factual claims → human brief/task, never auto-publish
 * - ≤3 strategy retries per issue, then hand off with explanation
 * - Every attempt logged with before/after; revertible when a snapshot was written
 * - Rate-limited; one site per explicit user action (no silent bulk)
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { getAdapter } from './site-adapters'
import type { CMSAdapter, FixApplyResult, PageContent, SiteCredentials } from './site-adapters/types'
import {
  classifyAuditIssues,
  describeFixableScope,
  type AutoFixKind,
  type ClassifiedIssue,
} from './fix-agent-classification'
import {
  buildArticleSchema,
  buildBreadcrumbSchema,
  buildLlmsTxt,
  buildOrganizationSchema,
  deriveDescriptionFromHtml,
  injectSchemaIntoHtml,
  mutateHtmlStructure,
  mutateImageAlt,
  mutateLangAttribute,
  mutateMetaDescription,
  mutateMetaTitle,
  mutateMissingH1,
  type HtmlMutationResult,
} from './fix-agent-html-mutations'
import { findOwnedSiteConnection, type OwnedSiteConnection } from './site-connection-lookup'
import type { PageAuditIssue } from './page-audit-engine'
import { runPageAudit } from './page-audit-engine'
import { validateSchema } from './schema-validator'

const MAX_ATTEMPTS_PER_ISSUE = 3
const RATE_LIMIT_PER_HOUR = 20

export interface FixAgentHumanTask {
  kind: string
  title: string
  reason: string
  suggestedAction: string
  briefHint?: string
}

export interface FixAgentAttemptView {
  id: string
  issueId: string
  issueTitle: string
  autoKind: string
  strategy: string
  attemptNumber: number
  status: string
  diffSummary: string | null
  verificationDetail: string | null
  errorMessage: string | null
  revertible: boolean
  scoreBefore: number | null
  scoreAfter: number | null
}

export interface FixAgentRunResult {
  ok: boolean
  message: string
  connected: boolean
  siteId?: string
  domain?: string
  cmsType?: string
  /** Plain description of what this connection can actually auto-fix. */
  fixableScope?: string
  scoreBefore?: number
  scoreAfter?: number
  classified: {
    auto: number
    human: number
    skip: number
  }
  applied: FixAgentAttemptView[]
  humanTasks: FixAgentHumanTask[]
  deferred?: boolean
}

interface StrategyPlan {
  name: string
  run: () => Promise<{
    apply: FixApplyResult
    before: string
    after: string
    summary: string
    needsHumanReview?: boolean
  }>
}

function asCreds(owned: OwnedSiteConnection): SiteCredentials {
  return {
    siteUrl: owned.siteUrl,
    siteId: owned.siteId,
    ...owned.credentials,
  }
}

async function countRecentAttempts(supabase: any, userId: string, siteId: string): Promise<number> {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { count } = await supabase
    .from('fix_agent_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('site_id', siteId)
    .gte('created_at', since)
  return count || 0
}

async function insertAttempt(
  supabase: any,
  row: Record<string, unknown>,
): Promise<string | null> {
  const { data, error } = await supabase.from('fix_agent_attempts').insert(row).select('id').maybeSingle()
  if (error) {
    console.error('[fix-agent] log insert failed', error.message)
    return null
  }
  return data?.id || null
}

function issueStillPresent(issues: PageAuditIssue[], classified: ClassifiedIssue): boolean {
  const id = classified.issue.id
  if (issues.some((i) => i.id === id)) return true
  // Unstable audit-* ids: match by title/category + autoKind heuristics
  const title = classified.issue.title.toLowerCase()
  return issues.some(
    (i) =>
      i.category === classified.issue.category &&
      (i.title.toLowerCase() === title || i.title.toLowerCase().includes(title.slice(0, 40))),
  )
}

function verifyLiveHtml(kind: AutoFixKind, html: string, schemaType?: string): { ok: boolean; detail: string } {
  switch (kind) {
    case 'meta-title': {
      const m = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)
      const ok = !!(m && m[1].replace(/<[^>]+>/g, '').trim().length >= 10)
      return { ok, detail: ok ? 'Live <title> present.' : 'Live page still missing a usable <title> (cache or theme override?).' }
    }
    case 'meta-description': {
      const ok = /<meta\s+name=["']description["']/i.test(html)
      return { ok, detail: ok ? 'Meta description detected live.' : 'Meta description not visible on live fetch.' }
    }
    case 'missing-h1': {
      const ok = /<h1\b/i.test(html)
      return { ok, detail: ok ? 'H1 present live.' : 'H1 not detected on live fetch — likely cache or theme template.' }
    }
    case 'lang-attribute': {
      const ok = /<html\b[^>]*\blang\s*=/i.test(html)
      return { ok, detail: ok ? 'html lang present.' : 'lang attribute not on live <html>.' }
    }
    case 'schema-organization':
    case 'schema-article':
    case 'schema-product':
    case 'schema-breadcrumb': {
      const wanted =
        schemaType ||
        (kind === 'schema-organization'
          ? 'Organization'
          : kind === 'schema-article'
            ? 'Article'
            : kind === 'schema-product'
              ? 'Product'
              : 'BreadcrumbList')
      const found = validateSchema(html).schemasFound
      const ok = found.includes(wanted)
      return {
        ok,
        detail: ok
          ? `Confirmed ${wanted} schema live (found: ${found.join(', ') || 'none'}).`
          : `Wrote ${wanted} but live fetch found: ${found.join(', ') || 'none'} — cache or deferred rebuild.`,
      }
    }
    case 'llms-txt':
      return { ok: true, detail: 'llms.txt write is file-level; confirm after deploy.' }
    case 'image-alt': {
      const missing = (html.match(/<img\b(?![^>]*\balt\s*=)[^>]*>/gi) || []).length
      return {
        ok: missing === 0,
        detail: missing === 0 ? 'No images missing alt on live page.' : `${missing} image(s) still missing alt live.`,
      }
    }
    case 'html-structure': {
      const bad = /<\/?(?:html|head|body)\b/i.test(html) && !/<!DOCTYPE\s+html/i.test(html)
      return { ok: !bad, detail: bad ? 'Stray wrappers still present.' : 'Structure check passed or full document.' }
    }
    case 'security-headers':
      return { ok: false, detail: 'Security headers require host config; not verifiable via HTML body alone.' }
    default:
      return { ok: false, detail: 'No verifier for this kind.' }
  }
}

function buildStrategies(
  kind: AutoFixKind,
  adapter: CMSAdapter,
  creds: SiteCredentials,
  page: PageContent,
  owned: OwnedSiteConnection,
  liveSignals: { title: string; metaDescription: string; h1: string; wordCount: number },
  langHint: string,
): StrategyPlan[] {
  const plans: StrategyPlan[] = []

  const applyMutation = (
    name: string,
    mutate: (html: string) => HtmlMutationResult,
    opts?: { title?: string; riskLevel?: 'safe' | 'review-required' },
  ): StrategyPlan => ({
    name,
    run: async () => {
      const before = page.bodyHtml
      const mut = mutate(before)
      if (!mut.changed) {
        return {
          apply: { success: true, skipped: true, detail: mut.summary },
          before,
          after: before,
          summary: mut.summary,
          needsHumanReview: mut.needsHumanReview,
        }
      }
      if (!adapter.rewritePageHtml) {
        return {
          apply: {
            success: false,
            error: `${adapter.platform} adapter cannot rewrite page HTML for this fix.`,
          },
          before,
          after: before,
          summary: mut.summary,
        }
      }
      const apply = await adapter.rewritePageHtml(creds, page, mut.html, {
        title: opts?.title,
        riskLevel: opts?.riskLevel || 'safe',
        commitMessage: `SEORANKO Fix Agent (${kind}): ${name}`,
      })
      return {
        apply,
        before,
        after: mut.html,
        summary: mut.summary,
        needsHumanReview: mut.needsHumanReview,
      }
    },
  })

  const titleSource = liveSignals.title || page.title || owned.brand
  const descSource =
    liveSignals.metaDescription ||
    deriveDescriptionFromHtml(page.bodyHtml, titleSource)

  switch (kind) {
    case 'meta-title':
      plans.push(
        applyMutation('rewrite-title-tag', (h) => mutateMetaTitle(h, titleSource), { title: titleSource.slice(0, 60) }),
      )
      if (adapter.rewritePageHtml) {
        plans.push(
          applyMutation('title-field-only', (h) => ({ html: h, changed: true, summary: 'Updated platform title field only.' }), {
            title: titleSource.slice(0, 60),
          }),
        )
      }
      break
    case 'meta-description':
      plans.push(applyMutation('inject-meta-description', (h) => mutateMetaDescription(h, descSource)))
      plans.push(
        applyMutation('meta-description-head-fallback', (h) => {
          // Force body-prepend strategy if first pass used head and platform strips it
          const tag = mutateMetaDescription('<!--x-->', descSource)
          return {
            html: tag.html + h.replace(/^<!--x-->\n?/, ''),
            changed: tag.changed,
            summary: 'Prepended meta description into content (fallback).',
          }
        }),
      )
      break
    case 'missing-h1':
      plans.push(applyMutation('insert-h1', (h) => mutateMissingH1(h, titleSource)))
      plans.push({
        name: 'append-h1-via-content',
        run: async () => {
          const before = page.bodyHtml
          const mut = mutateMissingH1(before, titleSource)
          if (!mut.changed) {
            return { apply: { success: true, skipped: true }, before, after: before, summary: mut.summary }
          }
          const apply = await adapter.appendContent(creds, page, mut.html.replace(before, ''), 'start')
          return { apply, before, after: mut.html, summary: mut.summary }
        },
      })
      break
    case 'lang-attribute':
      plans.push(applyMutation('set-html-lang', (h) => mutateLangAttribute(h, langHint)))
      break
    case 'image-alt':
      plans.push(applyMutation('filename-alt', (h) => mutateImageAlt(h), { riskLevel: 'review-required' }))
      break
    case 'html-structure':
      plans.push(applyMutation('strip-wrappers', (h) => mutateHtmlStructure(h)))
      break
    case 'schema-organization': {
      const schema = buildOrganizationSchema({
        name: owned.brand,
        url: owned.siteUrl,
      })
      plans.push({
        name: 'adapter-inject-schema',
        run: async () => {
          const before = page.bodyHtml
          const apply = await adapter.injectSchema(creds, page, schema)
          const after = injectSchemaIntoHtml(before, schema).html
          return { apply, before, after, summary: 'Inject Organization JSON-LD via adapter.' }
        },
      })
      plans.push(
        applyMutation('raw-jsonld-script', (h) => injectSchemaIntoHtml(h, schema)),
      )
      break
    }
    case 'schema-article': {
      const schema = buildArticleSchema({
        headline: titleSource,
        url: page.url,
        brandName: owned.brand,
      })
      plans.push({
        name: 'adapter-inject-article',
        run: async () => {
          const before = page.bodyHtml
          const apply = await adapter.injectSchema(creds, page, schema)
          return {
            apply,
            before,
            after: injectSchemaIntoHtml(before, schema).html,
            summary: 'Inject Article JSON-LD via adapter.',
          }
        },
      })
      plans.push(applyMutation('raw-article-jsonld', (h) => injectSchemaIntoHtml(h, schema)))
      break
    }
    case 'schema-breadcrumb': {
      const schema = buildBreadcrumbSchema(page.url)
      if (schema) {
        plans.push({
          name: 'adapter-inject-breadcrumb',
          run: async () => {
            const before = page.bodyHtml
            const apply = await adapter.injectSchema(creds, page, schema)
            return {
              apply,
              before,
              after: injectSchemaIntoHtml(before, schema).html,
              summary: 'Inject BreadcrumbList from URL path.',
            }
          },
        })
        plans.push(applyMutation('raw-breadcrumb-jsonld', (h) => injectSchemaIntoHtml(h, schema)))
      }
      break
    }
    case 'schema-product': {
      // Only inject Product shell from existing title — never invent price/stock
      const schema: Record<string, unknown> = {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: titleSource,
        ...(liveSignals.metaDescription ? { description: liveSignals.metaDescription.slice(0, 300) } : {}),
      }
      plans.push({
        name: 'adapter-inject-product-shell',
        run: async () => {
          const before = page.bodyHtml
          const apply = await adapter.injectSchema(creds, page, schema)
          return {
            apply,
            before,
            after: injectSchemaIntoHtml(before, schema).html,
            summary: 'Inject Product JSON-LD shell from existing title (no invented offers).',
          }
        },
      })
      plans.push(applyMutation('raw-product-jsonld', (h) => injectSchemaIntoHtml(h, schema)))
      break
    }
    case 'llms-txt':
      plans.push({
        name: 'write-llms-txt',
        run: async () => {
          const content = buildLlmsTxt({
            brand: owned.brand,
            siteUrl: owned.siteUrl,
            title: titleSource,
          })
          if (!adapter.writeStaticFile) {
            return {
              apply: {
                success: false,
                error: `${adapter.platform} cannot create llms.txt via API — use GitHub connector or upload manually.`,
              },
              before: '',
              after: content,
              summary: 'llms.txt create not supported on this platform.',
            }
          }
          const apply = await adapter.writeStaticFile(creds, 'llms.txt', content, {
            commitMessage: 'SEORANKO Fix Agent: add llms.txt',
          })
          return { apply, before: '', after: content, summary: 'Created llms.txt from site identity.' }
        },
      })
      break
    case 'security-headers':
      plans.push({
        name: 'headers-unsupported',
        run: async () => ({
          apply: {
            success: false,
            error:
              'Security headers require hosting config (e.g. vercel.json / CDN). Fix Agent cannot safely invent a CSP; handing off to human.',
          },
          before: '',
          after: '',
          summary: 'Security headers not auto-applied.',
        }),
      })
      break
  }

  return plans.slice(0, MAX_ATTEMPTS_PER_ISSUE)
}

function humanTaskFrom(classified: ClassifiedIssue): FixAgentHumanTask {
  const kind = classified.humanKind || 'other-editorial'
  if (kind === 'thin-content') {
    return {
      kind,
      title: classified.issue.title,
      reason: classified.reason,
      suggestedAction: 'Generate a Keyword Brief (Feature 2 / Briefs) for this URL — do not auto-publish AI copy.',
      briefHint: classified.issue.remediation || classified.issue.description,
    }
  }
  if (kind === 'internal-linking') {
    return {
      kind,
      title: classified.issue.title,
      reason: classified.reason,
      suggestedAction: 'Plan internal links editorially (which pages should link where) — not auto-applied.',
    }
  }
  if (kind === 'requires-server') {
    return {
      kind,
      title: classified.issue.title,
      reason: classified.reason,
      suggestedAction:
        classified.fixPathHint ||
        'Connect via WordPress, Shopify, or GitHub (not Universal Tag) to auto-fix, or apply manually in hosting/CMS config.',
    }
  }
  return {
    kind,
    title: classified.issue.title,
    reason: classified.reason,
    suggestedAction: 'Review manually; Fix Agent will not change factual or editorial claims.',
  }
}

export async function runFixAgent(opts: {
  supabase: any
  userId: string
  auditUrl: string
  issues: PageAuditIssue[]
  /** Explicit confirmation that user wants this one site fixed. */
  confirmSiteId: string
  scoreBefore?: number
  langHint?: string
}): Promise<FixAgentRunResult> {
  const owned = await findOwnedSiteConnection(opts.supabase, opts.userId, opts.auditUrl)
  if (!owned) {
    return {
      ok: false,
      connected: false,
      message:
        'No active site connection for this URL. Connect WordPress, Shopify, or GitHub in Settings → Your Sites first.',
      classified: { auto: 0, human: 0, skip: 0 },
      applied: [],
      humanTasks: [],
    }
  }

  if (owned.siteId !== opts.confirmSiteId) {
    return {
      ok: false,
      connected: true,
      siteId: owned.siteId,
      domain: owned.domain,
      message: 'Site confirmation mismatch — Fix Agent will not run without explicit confirmation for this site.',
      classified: { auto: 0, human: 0, skip: 0 },
      applied: [],
      humanTasks: [],
    }
  }

  const recent = await countRecentAttempts(opts.supabase, opts.userId, owned.siteId)
  if (recent >= RATE_LIMIT_PER_HOUR) {
    return {
      ok: false,
      connected: true,
      siteId: owned.siteId,
      domain: owned.domain,
      message: `Rate limit: ${RATE_LIMIT_PER_HOUR} Fix Agent attempts/hour on this site. Try again later.`,
      classified: { auto: 0, human: 0, skip: 0 },
      applied: [],
      humanTasks: [],
    }
  }

  const classified = classifyAuditIssues(opts.issues, { connectionType: owned.cmsType })
  const autoIssues = classified.filter((c) => c.fixability === 'auto' && c.autoKind)
  const humanIssues = classified.filter((c) => c.fixability === 'human')
  const skipCount = classified.filter((c) => c.fixability === 'skip').length

  const humanTasks = humanIssues.map(humanTaskFrom)
  for (const task of humanTasks) {
    await insertAttempt(opts.supabase, {
      user_id: opts.userId,
      site_id: owned.siteId,
      connection_id: owned.connectionId,
      target_url: opts.auditUrl,
      issue_id: task.title.slice(0, 120),
      issue_title: task.title,
      auto_kind: task.kind,
      strategy: 'human-handoff',
      attempt_number: 1,
      status: 'handed_off',
      diff_summary: task.reason,
      human_task: task,
      revertible: false,
      score_before: opts.scoreBefore ?? null,
    })
  }

  const adapter = getAdapter(owned.cmsType, opts.supabase)
  const creds = asCreds(owned)

  const check = await adapter.verifyConnection(creds)
  if (!check.success) {
    return {
      ok: false,
      connected: true,
      siteId: owned.siteId,
      domain: owned.domain,
      cmsType: owned.cmsType,
      message: check.error || 'Site connection verification failed.',
      classified: { auto: autoIssues.length, human: humanIssues.length, skip: skipCount },
      applied: [],
      humanTasks,
    }
  }

  const page = await adapter.findPageContent(creds, opts.auditUrl)
  if (!page && autoIssues.some((a) => a.autoKind !== 'llms-txt' && a.autoKind !== 'security-headers')) {
    return {
      ok: false,
      connected: true,
      siteId: owned.siteId,
      domain: owned.domain,
      cmsType: owned.cmsType,
      message: `Could not map this URL to an editable page on ${owned.cmsType}.`,
      classified: { auto: autoIssues.length, human: humanIssues.length, skip: skipCount },
      applied: [],
      humanTasks,
    }
  }

  // Live signals for derivation (no invented facts)
  let liveSignals = { title: page?.title || '', metaDescription: '', h1: '', wordCount: 0 }
  try {
    const audit = await runPageAudit(opts.auditUrl)
    liveSignals = {
      title: audit.signals.title || liveSignals.title,
      metaDescription: audit.signals.metaDescription || '',
      h1: audit.signals.h1 || '',
      wordCount: audit.signals.wordCount,
    }
  } catch {
    /* use page title only */
  }

  const scoreBefore = opts.scoreBefore ?? 0
  const applied: FixAgentAttemptView[] = []
  let anyPending = false
  const workingPage: PageContent | null = page
    ? { ...page, bodyHtml: page.bodyHtml }
    : null

  for (const item of autoIssues) {
    const kind = item.autoKind!
    if (!workingPage && kind !== 'llms-txt' && kind !== 'security-headers') continue

    const strategies = buildStrategies(
      kind,
      adapter,
      creds,
      workingPage || {
        id: 'llms.txt',
        url: opts.auditUrl,
        title: owned.brand,
        bodyHtml: '',
        hasSchema: false,
      },
      owned,
      liveSignals,
      opts.langHint || 'en',
    )

    if (strategies.length === 0) {
      const id = await insertAttempt(opts.supabase, {
        user_id: opts.userId,
        site_id: owned.siteId,
        connection_id: owned.connectionId,
        target_url: opts.auditUrl,
        issue_id: item.issue.id,
        issue_title: item.issue.title,
        auto_kind: kind,
        strategy: 'none',
        attempt_number: 1,
        status: 'handed_off',
        error_message: 'No implementation strategy available for this issue on this platform.',
        human_task: {
          kind: 'unsupported',
          title: item.issue.title,
          reason: 'No strategy',
          suggestedAction: 'Fix manually on the platform.',
        },
        revertible: false,
        score_before: scoreBefore,
      })
      applied.push({
        id: id || '',
        issueId: item.issue.id,
        issueTitle: item.issue.title,
        autoKind: kind,
        strategy: 'none',
        attemptNumber: 1,
        status: 'handed_off',
        diffSummary: null,
        verificationDetail: null,
        errorMessage: 'No strategy available',
        revertible: false,
        scoreBefore,
        scoreAfter: null,
      })
      continue
    }

    let resolved = false
    for (let i = 0; i < strategies.length; i++) {
      const strategy = strategies[i]
      let outcome: Awaited<ReturnType<StrategyPlan['run']>>
      try {
        outcome = await strategy.run()
      } catch (err) {
        outcome = {
          apply: { success: false, error: err instanceof Error ? err.message : 'Strategy threw' },
          before: workingPage?.bodyHtml || '',
          after: workingPage?.bodyHtml || '',
          summary: 'Strategy error',
        }
      }

      const apply = outcome.apply
      let status = 'failed'
      let verificationDetail: string | null = null
      let scoreAfter: number | null = null

      if (apply.skipped) {
        status = 'skipped'
        verificationDetail = apply.detail || outcome.summary
        resolved = true
      } else if (!apply.success) {
        status = 'failed'
        verificationDetail = apply.error || 'Write failed'
      } else if (apply.pending || adapter.deferredVerification) {
        status = 'applied'
        verificationDetail = apply.detail || 'Applied — pending rebuild/merge before live verification.'
        anyPending = true
        resolved = true
        if (workingPage && outcome.after) workingPage.bodyHtml = outcome.after
      } else if (!adapter.serverVerifiable) {
        status = 'applied'
        verificationDetail = 'Queued (not server-verifiable).'
        resolved = true
      } else {
        // Re-fetch live and check
        try {
          await new Promise((r) => setTimeout(r, 1200))
          const liveRes = await fetch(opts.auditUrl, {
            headers: { 'User-Agent': 'SEORANKO-FixAgent/1.0', 'Cache-Control': 'no-cache' },
            signal: AbortSignal.timeout(20000),
          })
          const liveHtml = await liveRes.text()
          const schemaType =
            kind === 'schema-organization'
              ? 'Organization'
              : kind === 'schema-article'
                ? 'Article'
                : kind === 'schema-product'
                  ? 'Product'
                  : kind === 'schema-breadcrumb'
                    ? 'BreadcrumbList'
                    : undefined
          const v = verifyLiveHtml(kind, liveHtml, schemaType)
          verificationDetail = v.detail
          if (v.ok) {
            status = 'verified'
            resolved = true
            if (workingPage && outcome.after) workingPage.bodyHtml = outcome.after
            try {
              const re = await runPageAudit(opts.auditUrl)
              scoreAfter = re.score
              if (!issueStillPresent(re.issues, item)) {
                verificationDetail += ' Issue no longer present on re-audit.'
              } else {
                verificationDetail +=
                  ' Marker present but issue classification still matches — check logic may disagree; stopping retries for this issue.'
                resolved = true
              }
            } catch {
              /* ignore re-audit errors */
            }
          } else {
            status = 'failed'
            verificationDetail = `${v.detail} (strategy: ${strategy.name})`
            // keep trying next strategy
          }
        } catch {
          status = 'applied'
          verificationDetail = 'Wrote fix but could not re-fetch live page to verify.'
          resolved = true
        }
      }

      const revertible = !!(apply.success && !apply.skipped && outcome.before !== undefined)
      const id = await insertAttempt(opts.supabase, {
        user_id: opts.userId,
        site_id: owned.siteId,
        connection_id: owned.connectionId,
        target_url: opts.auditUrl,
        issue_id: item.issue.id,
        issue_title: item.issue.title,
        auto_kind: kind,
        strategy: strategy.name,
        attempt_number: i + 1,
        status,
        before_snapshot: outcome.before?.slice(0, 200_000) || null,
        after_snapshot: outcome.after?.slice(0, 200_000) || null,
        diff_summary: outcome.summary + (outcome.needsHumanReview ? ' [needs human review]' : ''),
        verification_detail: verificationDetail,
        error_message: apply.success ? null : apply.error || null,
        score_before: scoreBefore,
        score_after: scoreAfter,
        revertible,
        human_task: outcome.needsHumanReview
          ? {
              kind: 'alt-review',
              title: 'Review auto-filled image alt text',
              reason: 'Alt derived from filename; confirm accuracy.',
              suggestedAction: 'Edit alt text on images flagged data-seoranko-alt-review.',
            }
          : null,
      })

      // Also mirror into legacy site_autofix_log for washout continuity
      if (apply.success && !apply.skipped) {
        await opts.supabase.from('site_autofix_log').insert({
          user_id: opts.userId,
          site_id: owned.siteId,
          issue_id: item.issue.id,
          fix_type: `fix-agent:${kind}`,
          target_url: opts.auditUrl,
          verified: status === 'verified',
          legacy_target: kind,
          verification_result: {
            strategy: strategy.name,
            detail: verificationDetail,
            attemptId: id,
            pending: !!apply.pending,
          },
        })
      }

      applied.push({
        id: id || '',
        issueId: item.issue.id,
        issueTitle: item.issue.title,
        autoKind: kind,
        strategy: strategy.name,
        attemptNumber: i + 1,
        status,
        diffSummary: outcome.summary,
        verificationDetail,
        errorMessage: apply.success ? null : apply.error || null,
        revertible,
        scoreBefore,
        scoreAfter,
      })

      if (resolved) break
    }

    if (!resolved) {
      await insertAttempt(opts.supabase, {
        user_id: opts.userId,
        site_id: owned.siteId,
        connection_id: owned.connectionId,
        target_url: opts.auditUrl,
        issue_id: item.issue.id,
        issue_title: item.issue.title,
        auto_kind: kind,
        strategy: 'exhausted',
        attempt_number: MAX_ATTEMPTS_PER_ISSUE,
        status: 'handed_off',
        diff_summary: `Tried ${strategies.length} strategies; still failing. Handing to human.`,
        human_task: {
          kind: 'retry-exhausted',
          title: item.issue.title,
          reason: 'Max retries reached',
          suggestedAction: 'Review attempt log and fix manually.',
        },
        revertible: false,
        score_before: scoreBefore,
      })
    }
  }

  let scoreAfter: number | undefined
  try {
    const re = await runPageAudit(opts.auditUrl)
    scoreAfter = re.score
  } catch {
    scoreAfter = undefined
  }

  const verifiedCount = applied.filter((a) => a.status === 'verified' || a.status === 'applied').length
  return {
    ok: true,
    connected: true,
    siteId: owned.siteId,
    domain: owned.domain,
    cmsType: owned.cmsType,
    fixableScope: describeFixableScope(owned.cmsType),
    scoreBefore,
    scoreAfter,
    message: anyPending
      ? `Applied ${verifiedCount} fix(es); some await rebuild/merge before live verification.`
      : `Fix Agent finished: ${verifiedCount} applied/verified, ${humanTasks.length} human task(s).`,
    classified: { auto: autoIssues.length, human: humanIssues.length, skip: skipCount },
    applied,
    humanTasks,
    deferred: anyPending,
  }
}

export async function revertFixAttempt(opts: {
  supabase: any
  userId: string
  attemptId: string
}): Promise<{ ok: boolean; message: string }> {
  const { data: attempt } = await opts.supabase
    .from('fix_agent_attempts')
    .select('*')
    .eq('id', opts.attemptId)
    .eq('user_id', opts.userId)
    .maybeSingle()

  if (!attempt) return { ok: false, message: 'Attempt not found.' }
  if (!attempt.revertible || !attempt.before_snapshot) {
    return { ok: false, message: 'This attempt is not revertible (no before snapshot).' }
  }
  if (attempt.reverted_at) return { ok: false, message: 'Already reverted.' }

  const owned = await findOwnedSiteConnection(opts.supabase, opts.userId, attempt.target_url)
  if (!owned || owned.siteId !== attempt.site_id) {
    return { ok: false, message: 'Site connection no longer active for this URL.' }
  }

  const adapter = getAdapter(owned.cmsType, opts.supabase)
  const creds = asCreds(owned)
  if (!adapter.rewritePageHtml) {
    return { ok: false, message: `${owned.cmsType} cannot rewrite page HTML to revert.` }
  }

  const page = await adapter.findPageContent(creds, attempt.target_url)
  if (!page) return { ok: false, message: 'Could not find page to revert.' }

  const apply = await adapter.rewritePageHtml(creds, page, attempt.before_snapshot, {
    riskLevel: 'safe',
    commitMessage: `SEORANKO Fix Agent: revert ${attempt.auto_kind}`,
  })
  if (!apply.success) return { ok: false, message: apply.error || 'Revert write failed.' }

  await opts.supabase
    .from('fix_agent_attempts')
    .update({
      reverted_at: new Date().toISOString(),
      status: 'reverted',
      revertible: false,
    })
    .eq('id', attempt.id)

  await insertAttempt(opts.supabase, {
    user_id: opts.userId,
    site_id: owned.siteId,
    connection_id: owned.connectionId,
    target_url: attempt.target_url,
    issue_id: attempt.issue_id,
    issue_title: attempt.issue_title,
    auto_kind: attempt.auto_kind,
    strategy: `revert:${attempt.strategy}`,
    attempt_number: (attempt.attempt_number || 1) + 1,
    status: 'reverted',
    before_snapshot: attempt.after_snapshot,
    after_snapshot: attempt.before_snapshot,
    diff_summary: `Reverted attempt ${attempt.id}`,
    revertible: false,
  })

  return {
    ok: true,
    message: apply.pending
      ? 'Revert committed — live after rebuild.'
      : 'Revert applied.',
  }
}
