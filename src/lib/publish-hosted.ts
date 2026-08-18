/* eslint-disable @typescript-eslint/no-explicit-any */
// src/lib/publish-hosted.ts
// The "hosted" destination for /api/publish — a first-party publish path so
// an article can go live even when the client has no connected CMS. Does
// NOT touch article-publisher.ts / publish-safeguards.ts (the existing
// siteId-scoped CMS-adapter flow for WordPress/Shopify/Webflow/GitHub/
// Universal Tag) — those stay exactly as they are. This is a fifth,
// independent destination routed through its own `publications` row, scoped
// by (user_id, brand) rather than by a connected_sites row, since hosted
// publishing has no external site connection to key off.

import { toSlug } from '@/lib/slug'
import { jaccardSimilarity } from '@/lib/publish-safeguards'

// SEORANKO's own hosting surface for the public blog route — a platform-
// level constant (like the schema.org/Clearbit URLs already used
// elsewhere), not a per-client brand or market default, so it's exempt from
// the "no hardcoded brand/market fallback" rule: this is SEORANKO's own
// domain, not a client's.
const PUBLISH_DOMAIN = process.env.NEXT_PUBLIC_PUBLISH_DOMAIN || 'blog.seoranko.com'

// Public-facing URL has no /blog/ prefix — the blog.* subdomain itself
// signals "this is the blog" (see next.config.js's rewrites, which map
// this clean form onto the actual /blog/[brand]/[slug] file route). Keeps
// the underlying route path unchanged for when a custom-domain tier is
// added later — only the rewrite mapping changes, not the route itself.
export function buildHostedPublicUrl(brand: string, slug: string): string {
  return `https://${PUBLISH_DOMAIN}/${encodeURIComponent(brand)}/${encodeURIComponent(slug)}`
}

export function slugForArticle(title: string, keyword: string): string {
  return toSlug(title || keyword, 80)
}

// ── Volume safeguards (V01-V05), hosted-specific ────────────────────────────
// Distinct from publish-safeguards.ts's generic checkNearDuplicate/
// checkVolumeThrottle (siteId-scoped, single 0.6 hard-block threshold, no
// weekly human-review tier) — hosted publishing has no connected_sites row
// to scope by, and this task's spec calls for a different, more granular
// rule set: a soft daily default, a hard daily cap, a similarity-0.85 near-
// dup check, and a weekly human-review tier. Reuses jaccardSimilarity (the
// same shingle-based utility) rather than reimplementing it.

export const HOSTED_DAILY_SOFT_LIMIT = 5
export const HOSTED_DAILY_HARD_CAP = 20
export const HOSTED_WEEKLY_HUMAN_REVIEW_THRESHOLD = 15
export const HOSTED_NEAR_DUP_SIMILARITY_THRESHOLD = 0.85
const HOSTED_NEAR_DUP_LOOKBACK = 20

export interface HostedVolumeCheck {
  dailyCount: number
  weeklyCount: number
  hardBlocked: boolean       // dailyCount >= HOSTED_DAILY_HARD_CAP
  softWarning: boolean       // dailyCount >= HOSTED_DAILY_SOFT_LIMIT
  requiresHumanReview: boolean // weeklyCount >= HOSTED_WEEKLY_HUMAN_REVIEW_THRESHOLD
}

export async function checkHostedVolume(
  supabase: any,
  userId: string,
  brand: string,
): Promise<HostedVolumeCheck> {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const [{ count: dailyCount }, { count: weeklyCount }] = await Promise.all([
    supabase
      .from('publications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('brand', brand)
      .eq('destination', 'hosted')
      .gte('published_at', since24h),
    supabase
      .from('publications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('brand', brand)
      .eq('destination', 'hosted')
      .gte('published_at', since7d),
  ])

  const daily = dailyCount ?? 0
  const weekly = weeklyCount ?? 0
  return {
    dailyCount: daily,
    weeklyCount: weekly,
    hardBlocked: daily >= HOSTED_DAILY_HARD_CAP,
    softWarning: daily >= HOSTED_DAILY_SOFT_LIMIT,
    requiresHumanReview: weekly >= HOSTED_WEEKLY_HUMAN_REVIEW_THRESHOLD,
  }
}

export interface HostedNearDupCheck {
  isDuplicate: boolean
  mostSimilarArticleId?: string
  mostSimilarTitle?: string
  similarity: number
}

export async function checkHostedNearDuplicate(
  supabase: any,
  userId: string,
  brand: string,
  candidateHtml: string,
  excludeArticleId?: string,
): Promise<HostedNearDupCheck> {
  const { data: recent } = await supabase
    .from('publications')
    .select('article_id, articles(id, title, content)')
    .eq('user_id', userId)
    .eq('brand', brand)
    .eq('destination', 'hosted')
    .order('published_at', { ascending: false })
    .limit(HOSTED_NEAR_DUP_LOOKBACK)

  let best: HostedNearDupCheck = { isDuplicate: false, similarity: 0 }
  for (const row of recent || []) {
    const article = row.articles
    if (!article || article.id === excludeArticleId || !article.content) continue
    const similarity = jaccardSimilarity(candidateHtml, article.content)
    if (similarity > best.similarity) {
      best = {
        isDuplicate: similarity >= HOSTED_NEAR_DUP_SIMILARITY_THRESHOLD,
        mostSimilarArticleId: article.id,
        mostSimilarTitle: article.title,
        similarity,
      }
    }
  }
  return best
}

// ── Author attribution (V-series requirement: real author or Organization,
// never a fictitious persona) ────────────────────────────────────────────
// This pipeline's write path already hardcodes a real, verified author name
// ("Kamran Gul" — see article-v2/route.ts's validateAndCorrect fake-author
// stripping) so in practice this always resolves to a real person. Kept as
// an explicit, checkable gate here rather than assumed, since the spec
// calls it out as a hard publish-time requirement in its own right — a
// future brand/multi-author feature must not be able to silently bypass it.
export function resolveAuthorAttribution(authorName: string | null | undefined): {
  type: 'Person' | 'Organization'
  name: string
} {
  const trimmed = (authorName || '').trim()
  const looksReal = trimmed.length > 0 && /^[A-Z][a-z]+(\s+[A-Z][a-z]+)+$/.test(trimmed)
  return looksReal
    ? { type: 'Person', name: trimmed }
    : { type: 'Organization', name: 'the publisher' }
}
