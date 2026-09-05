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
import { verifyRedirectLive } from './fix-agent-redirect'
import { removeDeadLinkFromHtml } from './fix-agent-dead-links'
import { rewriteHrefsInHtml, verifyHrefRewriteInHtml } from './fix-agent-href-rewrite'

const MAX_ATTEMPTS_PER_ISSUE = 3
const RATE_LIMIT_PER_HOUR = 20

const SITE_WIDE_AUTO_KINDS = new Set<AutoFixKind>([
  'llms-txt',
  'security-headers',
  'redirect-canonical',
  'remove-dead-link',
  'sitemap-regenerate',
  'rewrite-link-href',
])

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
  /** deploy = awaiting host rebuild; merge = awaiting PR merge */
  pendingKind?: 'deploy' | 'merge' | null
  /** PR URL when pendingKind is merge */
  pendingUrl?: string | null
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
  /** Successful writes awaiting host rebuild (e.g. Vercel). */
  pendingDeployCount?: number
  /** Successful writes awaiting PR merge. */
  pendingMergeCount?: number
  /** Auto attempts that failed with an error (not human-classified issues). */
  failedCount?: number
}

/** Build the user-facing Fix Agent summary — never conflate awaiting-deploy with human tasks. */
export function buildFixAgentRunSummary(opts: {
  liveCount: number
  pendingDeployCount: number
  pendingMergeCount: number
  failedCount: number
  humanTaskCount: number
}): string {
  const parts: string[] = []
  if (opts.liveCount > 0) parts.push(`${opts.liveCount} live`)
  if (opts.pendingDeployCount > 0) {
    parts.push(`${opts.pendingDeployCount} committed, awaiting Vercel deploy`)
  }
  if (opts.pendingMergeCount > 0) {
    parts.push(`${opts.pendingMergeCount} PR(s) awaiting merge`)
  }
  if (opts.failedCount > 0) parts.push(`${opts.failedCount} failed (see errors)`)
  if (opts.humanTaskCount > 0) parts.push(`${opts.humanTaskCount} human task(s)`)
  if (parts.length === 0) return 'Fix Agent finished: nothing applied.'
  return `Fix Agent finished: ${parts.join(', ')}.`
}

function pendingStatusFromApply(apply: FixApplyResult): 'pending_deploy' | 'pending_merge' {
  return apply.pendingKind === 'merge' ? 'pending_merge' : 'pending_deploy'
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

function verifyLiveHtml(
  kind: AutoFixKind,
  html: string,
  schemaType?: string,
  auditIssue?: PageAuditIssue,
): { ok: boolean; detail: string } {
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

    case 'rewrite-link-href': {
      const fixes = auditIssue?.fixMetadata?.hrefFixes || []
      if (fixes.length === 0) {
        const fromUrl = auditIssue?.fixMetadata?.fromUrl
        const toUrl = auditIssue?.fixMetadata?.toUrl
        if (!fromUrl || !toUrl) return { ok: false, detail: 'No href rewrite metadata to verify.' }
        return verifyHrefRewriteInHtml(html, fromUrl, toUrl)
      }
      // Verify first fix on this HTML (caller fetches the right source page)
      const first = fixes[0]!
      return verifyHrefRewriteInHtml(html, first.fromHref, first.toHref)
    }
    case 'remove-dead-link': {
      const deadUrl = auditIssue?.fixMetadata?.deadUrl
      if (!deadUrl) return { ok: false, detail: 'No dead URL to verify.' }
      try {
        const variants = [deadUrl, new URL(deadUrl).pathname]
        const stillLinked = variants.some((v) =>
          new RegExp(`href\\s*=\\s*["'][^"']*${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(html),
        )
        return {
          ok: !stillLinked,
          detail: stillLinked
            ? `Dead link to ${deadUrl} still present on live fetch.`
            : 'Dead link no longer in fetched source HTML.',
        }
      } catch {
        return { ok: false, detail: 'Could not verify dead link removal.' }
      }
    }
    case 'sitemap-regenerate': {
      const ok = /<urlset/i.test(html) && /<loc>/i.test(html)
      return { ok, detail: ok ? 'Live sitemap.xml contains url entries.' : 'Sitemap not yet live — rebuild may be pending.' }
    }
    case 'redirect-canonical':
      return { ok: false, detail: 'Redirect verified separately via HTTP follow.' }
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
  auditIssue: PageAuditIssue,
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
    case 'redirect-canonical': {
      const meta = auditIssue.fixMetadata
      const fromUrl = meta?.fromUrl
      const toUrl = meta?.toUrl
      if (!fromUrl || !toUrl) break
      plans.push({
        name: 'next-config-redirect',
        run: async () => {
          if (!adapter.mergeRedirectConfig) {
            return {
              apply: {
                success: false,
                error: `${adapter.platform} does not support automatic redirect config merges — use Manual Fix snippets.`,
              },
              before: '',
              after: '',
              summary: 'Redirect merge not supported on this platform.',
            }
          }
          const apply = await adapter.mergeRedirectConfig(creds, fromUrl, toUrl, {
            commitMessage: `SEORANKO Fix Agent: redirect ${fromUrl} → ${toUrl}`,
          })
          return {
            apply,
            before: '',
            after: `${fromUrl} → ${toUrl}`,
            summary: `301 redirect ${fromUrl} → ${toUrl}`,
          }
        },
      })
      break
    }
    
    case 'rewrite-link-href': {
      const meta = auditIssue.fixMetadata
      const fixes = [...(meta?.hrefFixes || [])]
      if (fixes.length === 0 && meta?.fromUrl && meta?.toUrl && meta?.sourceUrls?.[0]) {
        fixes.push({
          sourceUrl: meta.sourceUrls[0],
          fromHref: meta.fromUrl,
          toHref: meta.toUrl,
          ruleId: meta.evidence,
        })
      }
      if (fixes.length === 0) break
      plans.push({
        name: 'rewrite-link-hrefs',
        run: async () => {
          if (!adapter.rewritePageHtml) {
            return {
              apply: { success: false, error: 'Adapter cannot rewrite source pages.' },
              before: '',
              after: '',
              summary: 'Link href rewrite unsupported on this connection.',
            }
          }
          const bySource = new Map<string, typeof fixes>()
          for (const fix of fixes) {
            const list = bySource.get(fix.sourceUrl) || []
            list.push(fix)
            bySource.set(fix.sourceUrl, list)
          }
          let lastApply: FixApplyResult = { success: false, error: 'No sources edited' }
          let totalReplaced = 0
          const beforeSnaps: string[] = []
          const afterSnaps: string[] = []
          const diffLines: string[] = []
          for (const [sourceUrl, sourceFixes] of Array.from(bySource.entries()).slice(0, 20)) {
            const sourcePage = await adapter.findPageContent(creds, sourceUrl)
            if (!sourcePage) continue
            const mut = rewriteHrefsInHtml(
              sourcePage.bodyHtml,
              sourceFixes.map((f) => ({ fromHref: f.fromHref, toHref: f.toHref })),
            )
            if (!mut.changed) continue
            beforeSnaps.push(`<!-- ${sourceUrl} -->\n${sourcePage.bodyHtml}`)
            lastApply = await adapter.rewritePageHtml(creds, sourcePage, mut.html, {
              riskLevel: 'review-required',
              commitMessage: `SEORANKO Fix Agent: rewrite ${mut.replaced} link href(s) on ${sourcePage.id}`,
            })
            afterSnaps.push(`<!-- ${sourceUrl} -->\n${mut.html}`)
            totalReplaced += mut.replaced
            for (const r of mut.replacements) {
              diffLines.push(`${sourceUrl}: ${r.from} → ${r.to}`)
            }
          }
          if (totalReplaced === 0) {
            return {
              apply: {
                success: true,
                skipped: true,
                detail: 'Matching href not found in editable source files.',
              },
              before: beforeSnaps[0] || '',
              after: afterSnaps[0] || '',
              summary: 'No editable source file contained the flagged href(s).',
            }
          }
          return {
            apply: lastApply,
            before: beforeSnaps.join('\n=====\n'),
            after: afterSnaps.join('\n=====\n'),
            summary: `Updated ${totalReplaced} href(s) across ${afterSnaps.length} file(s).\n${diffLines.slice(0, 30).join('\n')}`,
          }
        },
      })
      break
    }
case 'remove-dead-link': {
      const meta = auditIssue.fixMetadata
      const deadUrl = meta?.deadUrl
      const sourceUrls = meta?.sourceUrls || []
      if (!deadUrl || sourceUrls.length === 0) break
      plans.push({
        name: 'remove-dead-anchors',
        run: async () => {
          if (!adapter.rewritePageHtml) {
            return {
              apply: { success: false, error: 'Adapter cannot rewrite source pages.' },
              before: '',
              after: '',
              summary: 'Dead link removal unsupported.',
            }
          }
          let lastApply: FixApplyResult = { success: false, error: 'No sources edited' }
          let totalRemoved = 0
          const beforeSnaps: string[] = []
          const afterSnaps: string[] = []
          for (const sourceUrl of sourceUrls.slice(0, 5)) {
            const sourcePage = await adapter.findPageContent(creds, sourceUrl)
            if (!sourcePage) continue
            const mut = removeDeadLinkFromHtml(sourcePage.bodyHtml, deadUrl)
            if (!mut.changed) continue
            beforeSnaps.push(sourcePage.bodyHtml)
            lastApply = await adapter.rewritePageHtml(creds, sourcePage, mut.html, {
              riskLevel: 'review-required',
              commitMessage: `SEORANKO Fix Agent: remove dead link to ${deadUrl} from ${sourcePage.id}`,
            })
            afterSnaps.push(mut.html)
            totalRemoved += mut.removed
          }
          if (totalRemoved === 0) {
            return {
              apply: { success: true, skipped: true, detail: 'Dead link not found in editable source files.' },
              before: beforeSnaps[0] || '',
              after: afterSnaps[0] || '',
              summary: `No editable source file contained a link to ${deadUrl}.`,
            }
          }
          return {
            apply: lastApply,
            before: beforeSnaps.join('\n---\n'),
            after: afterSnaps.join('\n---\n'),
            summary: `Removed ${totalRemoved} dead link(s) to ${deadUrl} across ${afterSnaps.length} file(s).`,
          }
        },
      })
      break
    }
    case 'sitemap-regenerate': {
      const meta = auditIssue.fixMetadata
      const content = meta?.sitemapContent
      const path = meta?.sitemapPath || 'public/sitemap.xml'
      if (!content) break
      plans.push({
        name: 'write-sitemap-xml',
        run: async () => {
          if (!adapter.writeStaticFile) {
            return {
              apply: {
                success: false,
                error: `${adapter.platform} cannot write sitemap.xml — use Copy/Download from the Sitemap tool.`,
              },
              before: '',
              after: content,
              summary: 'Sitemap write not supported on this platform.',
            }
          }
          const apply = await adapter.writeStaticFile(creds, path, content, {
            commitMessage: 'SEORANKO Fix Agent: regenerate sitemap.xml from Index Diagnosis crawl',
          })
          return { apply, before: '', after: content, summary: `Wrote ${path} with INDEXABLE crawl URLs.` }
        },
      })
      break
    }
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
  if (kind === 'missing-page-content') {
    return {
      kind,
      title: classified.issue.title,
      reason: classified.reason,
      suggestedAction:
        'Human task: restore the missing page with real content, or add a redirect to a live URL. Fix Agent can remove dead links pointing here separately.',
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
  const needsAuditPage = autoIssues.some(
    (a) => a.autoKind && !SITE_WIDE_AUTO_KINDS.has(a.autoKind),
  )
  if (!page && needsAuditPage) {
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
    if (!workingPage && !SITE_WIDE_AUTO_KINDS.has(kind)) continue

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
      item.issue,
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
      } else if ((apply.pending || adapter.deferredVerification) && !SITE_WIDE_AUTO_KINDS.has(kind)) {
        status = apply.pending ? pendingStatusFromApply(apply) : 'pending_deploy'
        verificationDetail =
          apply.detail ||
          (status === 'pending_merge'
            ? 'Applied — PR opened; awaiting merge before live.'
            : 'Applied — committed; awaiting Vercel deploy before live verification.')
        anyPending = true
        resolved = true
        if (workingPage && outcome.after) workingPage.bodyHtml = outcome.after
      } else if (!adapter.serverVerifiable) {
        status = 'applied'
        verificationDetail = 'Queued (not server-verifiable).'
        resolved = true
      } else {
        // Re-fetch live and check (URL varies by fix kind)
        try {
          await new Promise((r) => setTimeout(r, adapter.deferredVerification ? 2500 : 1200))
          let v: { ok: boolean; detail: string }

          if (kind === 'redirect-canonical') {
            const meta = item.issue.fixMetadata
            if (meta?.fromUrl && meta?.toUrl) {
              v = await verifyRedirectLive(meta.fromUrl, new URL(meta.toUrl).pathname)
              if (!v.ok && (apply.pending || adapter.deferredVerification)) {
                v = {
                  ok: true,
                  detail: `${v.detail} Committed — live redirect may require rebuild/deploy.`,
                }
              }
            } else {
              v = { ok: false, detail: 'Missing redirect metadata.' }
            }
          } else if (kind === 'sitemap-regenerate') {
            const sitemapUrl = `${owned.siteUrl.replace(/\/$/, '')}/sitemap.xml`
            const liveRes = await fetch(sitemapUrl, {
              headers: { 'User-Agent': 'SEORANKO-FixAgent/1.0', 'Cache-Control': 'no-cache' },
              signal: AbortSignal.timeout(20000),
            })
            const liveHtml = await liveRes.text()
            v = verifyLiveHtml(kind, liveHtml, undefined, item.issue)
            if (!v.ok && (apply.pending || adapter.deferredVerification)) {
              v = { ok: true, detail: `${v.detail} Committed — sitemap may require rebuild/deploy.` }
            }
          } else if (kind === 'remove-dead-link') {
            const sourceUrl = item.issue.fixMetadata?.sourceUrls?.[0]
            const verifyUrl = sourceUrl || opts.auditUrl
            const liveRes = await fetch(verifyUrl, {
              headers: { 'User-Agent': 'SEORANKO-FixAgent/1.0', 'Cache-Control': 'no-cache' },
              signal: AbortSignal.timeout(20000),
            })
            const liveHtml = await liveRes.text()
            v = verifyLiveHtml(kind, liveHtml, undefined, item.issue)
            if (!v.ok && (apply.pending || adapter.deferredVerification)) {
              v = { ok: true, detail: `${v.detail} Committed — source page may require rebuild/deploy.` }
            }
          
          } else if (kind === 'rewrite-link-href') {
            const fixes = item.issue.fixMetadata?.hrefFixes || []
            const sourceUrl =
              fixes[0]?.sourceUrl ||
              item.issue.fixMetadata?.sourceUrls?.[0] ||
              opts.auditUrl
            const liveRes = await fetch(sourceUrl, {
              headers: { 'User-Agent': 'SEORANKO-FixAgent/1.0', 'Cache-Control': 'no-cache' },
              signal: AbortSignal.timeout(20000),
            })
            const liveHtml = await liveRes.text()
            if (fixes.length > 0) {
              let allOk = true
              const details: string[] = []
              for (const fix of fixes.slice(0, 15)) {
                if (fix.sourceUrl && fix.sourceUrl !== sourceUrl) continue
                const one = verifyHrefRewriteInHtml(liveHtml, fix.fromHref, fix.toHref)
                details.push(one.detail)
                if (!one.ok) allOk = false
              }
              v = { ok: allOk, detail: details.join(' ') || 'Href rewrite verification complete.' }
            } else {
              v = verifyLiveHtml(kind, liveHtml, undefined, item.issue)
            }
            if (!v.ok && (apply.pending || adapter.deferredVerification)) {
              v = { ok: true, detail: `${v.detail} Committed — source page may require rebuild/deploy.` }
            }
          } else {
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
            v = verifyLiveHtml(kind, liveHtml, schemaType, item.issue)
          }

          verificationDetail = apply.detail ? `${apply.detail} ${v.detail}` : v.detail
          if (v.ok) {
            if (apply.pending || adapter.deferredVerification) {
              status = pendingStatusFromApply(apply)
              anyPending = true
            } else {
              status = 'verified'
            }
            resolved = true
            if (workingPage && outcome.after) workingPage.bodyHtml = outcome.after
            if (!SITE_WIDE_AUTO_KINDS.has(kind) && status === 'verified') {
              try {
                const re = await runPageAudit(opts.auditUrl)
                scoreAfter = re.score
                if (!issueStillPresent(re.issues, item)) {
                  verificationDetail += ' Issue no longer present on re-audit.'
                }
              } catch {
                /* ignore re-audit errors */
              }
            } else if (!issueStillPresent([], item) && status === 'verified') {
              verificationDetail += ' Site-wide fix applied.'
            }
          } else {
            status = 'failed'
            verificationDetail = `${v.detail} (strategy: ${strategy.name})`
          }
        } catch {
          if (apply.success) {
            status = apply.pending ? pendingStatusFromApply(apply) : 'applied'
            verificationDetail = apply.detail
              ? `${apply.detail} Could not re-fetch live to verify yet.`
              : 'Wrote fix but could not re-fetch live to verify.'
            if (apply.pending) anyPending = true
            resolved = true
          } else {
            status = 'failed'
            verificationDetail = 'Verification fetch failed.'
          }
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
            pendingKind: apply.pendingKind || null,
            pendingUrl: apply.url || null,
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
        errorMessage:
          status === 'failed' || status === 'handed_off'
            ? apply.error || verificationDetail || 'Failed'
            : null,
        pendingKind:
          status === 'pending_merge'
            ? 'merge'
            : status === 'pending_deploy'
              ? 'deploy'
              : apply.pendingKind || null,
        pendingUrl: apply.url || null,
        revertible,
        scoreBefore,
        scoreAfter,
      })

      if (resolved) break
    }

    if (!resolved) {
      const lastError =
        applied
          .filter((a) => a.issueId === item.issue.id && a.errorMessage)
          .map((a) => a.errorMessage)
          .filter(Boolean)
          .slice(-1)[0] || 'Max retries reached'
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
        verification_detail: String(lastError),
        error_message: String(lastError),
        human_task: {
          kind: 'retry-exhausted',
          title: item.issue.title,
          reason: String(lastError),
          suggestedAction: 'Review attempt log and fix manually.',
        },
        revertible: false,
        score_before: scoreBefore,
      })
      applied.push({
        id: '',
        issueId: item.issue.id,
        issueTitle: item.issue.title,
        autoKind: kind,
        strategy: 'exhausted',
        attemptNumber: MAX_ATTEMPTS_PER_ISSUE,
        status: 'handed_off',
        diffSummary: `Tried ${strategies.length} strategies; still failing. Handing to human.`,
        verificationDetail: String(lastError),
        errorMessage: String(lastError),
        revertible: false,
        scoreBefore,
        scoreAfter: null,
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

  const liveCount = applied.filter((a) => a.status === 'verified').length
  const pendingDeployCount = applied.filter(
    (a) => a.status === 'pending_deploy' || a.pendingKind === 'deploy',
  ).length
  const pendingMergeCount = applied.filter(
    (a) => a.status === 'pending_merge' || a.pendingKind === 'merge',
  ).length
  // Count one failure outcome per issue (last failed/handed_off attempt), not every retry.
  const failedIssueIds = new Set(
    applied
      .filter((a) => a.status === 'failed' || a.status === 'handed_off')
      .map((a) => a.issueId),
  )
  // Exclude issues that later succeeded
  for (const a of applied) {
    if (
      a.status === 'verified' ||
      a.status === 'applied' ||
      a.status === 'pending_deploy' ||
      a.status === 'pending_merge' ||
      a.status === 'skipped'
    ) {
      failedIssueIds.delete(a.issueId)
    }
  }
  const failedCount = failedIssueIds.size

  return {
    ok: true,
    connected: true,
    siteId: owned.siteId,
    domain: owned.domain,
    cmsType: owned.cmsType,
    fixableScope: describeFixableScope(owned.cmsType),
    scoreBefore,
    scoreAfter,
    message: buildFixAgentRunSummary({
      liveCount,
      pendingDeployCount,
      pendingMergeCount,
      failedCount,
      humanTaskCount: humanTasks.length,
    }),
    classified: { auto: autoIssues.length, human: humanIssues.length, skip: skipCount },
    applied,
    humanTasks,
    deferred: anyPending,
    pendingDeployCount,
    pendingMergeCount,
    failedCount,
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
