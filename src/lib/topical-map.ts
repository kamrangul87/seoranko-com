/* eslint-disable @typescript-eslint/no-explicit-any */
// Builds topical authority map from existing articles in Supabase
// Gap: every topical map tool starts from scratch with a keyword input.
// SEORANKO analyses the existing content library and builds the map from what already exists.

import Anthropic from '@anthropic-ai/sdk'
import { MODEL_FOR } from '@/lib/model-router'

export interface TopicalCluster {
  pillarTopic: string
  pillarKeyword: string
  pillarArticleId: string | null
  clusterPages: ClusterPage[]
  missingSubtopics: string[]
  topicalAuthorityScore: number
  internalLinkHealth: 'strong' | 'partial' | 'missing'
}

export interface ClusterPage {
  articleId: string
  title: string
  keyword: string
  url?: string
  brand?: string
  subtopic: string
  linksToPillar: boolean
  isOrphan: boolean
}

export interface TopicalMapResult {
  clusters: TopicalCluster[]
  totalArticles: number
  orphanArticles: string[]
  topRecommendation: string
  generatedAt: string
}

const client = new Anthropic()

// The model occasionally wraps its JSON in explanatory prose despite being
// told "Respond ONLY with JSON" — extract the first balanced {...} block
// instead of assuming the whole trimmed response is valid JSON on its own.
// Bracket-counting (not regex) so it isn't fooled by braces inside string
// values (e.g. a subtopic title that itself contains "{" or "}").
export function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null // unterminated — truncated output, no balanced object to recover
}

// Deterministic, non-AI grouping used ONLY when the clustering call's
// response can't be parsed at all (after the retry below). Groups articles
// by their own exact keyword — real, already-known data, never fabricated
// text. missingSubtopics is deliberately empty rather than padded with
// placeholder strings: per the "never let a placeholder be clickable" rule,
// dropping the gap-analysis feature entirely for this run is correct: a
// FALSE gap suggestion is worse than none, since it flows straight into
// RANKO's Research/winnability tool as if it were a real keyword.
export function groupArticlesByKeywordFallback(
  articles: Array<{ id: string; title: string; keyword: string }>
): { clusters: any[] } {
  const byKeyword = new Map<string, typeof articles>()
  for (const article of articles) {
    const key = article.keyword || 'Uncategorised'
    if (!byKeyword.has(key)) byKeyword.set(key, [])
    byKeyword.get(key)!.push(article)
  }

  const clusters = Array.from(byKeyword.entries()).map(([keyword, group]) => ({
    pillarTopic: keyword,
    pillarKeyword: keyword,
    pillarArticleId: group[0].id,
    clusterArticleIds: group.slice(1).map(a => a.id),
    missingSubtopics: [],
    subtopicMap: {},
  }))

  return { clusters }
}

export async function buildTopicalMap(
  articles: Array<{
    id: string
    title: string
    keyword: string
    content?: string
    url?: string
    brand?: string
  }>
): Promise<TopicalMapResult> {

  if (articles.length === 0) {
    return {
      clusters: [],
      totalArticles: 0,
      orphanArticles: [],
      topRecommendation: 'Generate your first article to start building topical authority.',
      generatedAt: new Date().toISOString()
    }
  }

  const articleList = articles.map((a, i) =>
    `${i + 1}. ID: ${a.id} | Keyword: "${a.keyword}" | Title: "${a.title}"`
  ).join('\n')

  const clusteringPrompt = `You are an SEO expert building a topical authority map.

Analyse these articles and group them into topic clusters. Each cluster needs:
- One pillar topic (the broad subject)
- A primary keyword for the pillar
- Which article ID best serves as the pillar page (most comprehensive)
- Which article IDs are cluster/supporting pages
- 3-5 missing subtopics that would complete this cluster — real, specific
  suggestions only. If you cannot think of genuine gaps for a cluster,
  return an empty array for missingSubtopics rather than inventing
  generic placeholder text like "Related subtopic".

Articles:
${articleList}

Respond ONLY with JSON in this exact format:
{
  "clusters": [
    {
      "pillarTopic": "broad topic name",
      "pillarKeyword": "primary keyword",
      "pillarArticleId": "article-id-or-null",
      "clusterArticleIds": ["id1", "id2"],
      "missingSubtopics": ["missing topic 1", "missing topic 2", "missing topic 3"],
      "subtopicMap": {"article-id": "what subtopic this covers"}
    }
  ]
}`

  // Bumped from 2000 — that was tight enough for a real 19-article library
  // (one pillarTopic + subtopicMap entry per article + 3-5 subtopics per
  // cluster) to truncate output mid-object, which is the confirmed root
  // cause of the "Related subtopic 1/2" placeholder bug: a truncated
  // response fails JSON.parse, and the old catch block fabricated that
  // exact placeholder text as a fallback instead of surfacing the failure.
  async function callClusteringModel(): Promise<{ clusters: any[] } | null> {
    const response = await client.messages.create({
      model: MODEL_FOR.topicalMapCluster,
      max_tokens: 4000,
      messages: [{ role: 'user', content: clusteringPrompt }],
    })
    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    const stripped = text.replace(/```json|```/g, '').trim()
    // The model occasionally wraps JSON in explanatory prose despite being
    // told not to — try the raw stripped text first, then a bracket-matched
    // extraction of just the {...} object before giving up on this attempt.
    for (const candidate of [stripped, extractJsonObject(stripped)]) {
      if (!candidate) continue
      try {
        const parsed = JSON.parse(candidate)
        if (Array.isArray(parsed.clusters)) return parsed
      } catch { /* try the next candidate, or the caller retries */ }
    }
    return null
  }

  let clusterData = await callClusteringModel()
  if (!clusterData) {
    console.warn('[topical-map] clustering response failed to parse — retrying once')
    clusterData = await callClusteringModel()
  }
  if (!clusterData) {
    // Never fabricate placeholder gap-analysis text (e.g. "Related
    // subtopic 1") — a fake suggestion is worse than none, since it's
    // clickable in the UI and flows straight into RANKO's Research/
    // winnability tool as if it were a real keyword. Fall back to a
    // deterministic, non-AI grouping with an honestly-empty gap list
    // instead of a second AI attempt that could fail the same way.
    console.error('[topical-map] clustering failed twice — using deterministic keyword grouping, no fabricated subtopics')
    clusterData = groupArticlesByKeywordFallback(articles)
  }

  // Real internal links in this pipeline only ever get placed as a direct
  // <a href="..."> in an article's own content — there's no separate ledger
  // of "what links where" kept up to date elsewhere (articles.internal_links
  // exists as a column but nothing in the app ever writes to it, so it was
  // always '[]' and every link-health check below was a permanent no-op).
  // Scanning content for the target's actual URL is the same ground-truth
  // approach article-v2/route.ts's auditPlacedLinks already uses to confirm
  // "was this link really placed" rather than trusting a tracking column.
  const articleLinkMap: Record<string, string[]> = {}
  for (const article of articles) {
    const linkedUrls: string[] = []
    if (article.content) {
      for (const other of articles) {
        if (other.id === article.id || !other.url) continue
        if (article.content.includes(other.url)) linkedUrls.push(other.url)
      }
    }
    articleLinkMap[article.id] = linkedUrls
  }

  const clusters: TopicalCluster[] = []
  const linkedArticleIds = new Set<string>()

  for (const cluster of clusterData.clusters) {
    const clusterPages: ClusterPage[] = []

    const pillarArticle = articles.find(a => a.id === cluster.pillarArticleId)
    if (pillarArticle) {
      clusterPages.push({
        articleId: pillarArticle.id,
        title: pillarArticle.title,
        keyword: pillarArticle.keyword,
        url: pillarArticle.url,
        brand: pillarArticle.brand,
        subtopic: 'Pillar page',
        linksToPillar: false,
        isOrphan: false
      })
    }

    for (const clusterId of (cluster.clusterArticleIds || [])) {
      const article = articles.find(a => a.id === clusterId)
      if (!article) continue

      const linksInArticle = articleLinkMap[article.id] || []
      const pillarUrl = pillarArticle?.url || ''
      const linksToPillar = pillarUrl ? linksInArticle.some(l => l.includes(pillarUrl)) : false

      if (linksToPillar) linkedArticleIds.add(article.id)

      clusterPages.push({
        articleId: article.id,
        title: article.title,
        keyword: article.keyword,
        url: article.url,
        brand: article.brand,
        subtopic: cluster.subtopicMap?.[article.id] || article.keyword,
        linksToPillar,
        isOrphan: false
      })
    }

    for (const page of clusterPages) {
      const isLinkedTo = Object.entries(articleLinkMap).some(([fromId, links]) =>
        fromId !== page.articleId && links.some(l => page.url && l.includes(page.url))
      )
      page.isOrphan = !isLinkedTo && page.subtopic !== 'Pillar page'
    }

    const coverageScore = Math.min(100, (clusterPages.length / (clusterPages.length + cluster.missingSubtopics.length)) * 100)
    const linkScore = clusterPages.length > 1
      ? (clusterPages.filter(p => p.linksToPillar).length / (clusterPages.length - 1)) * 100
      : 100
    const topicalAuthorityScore = Math.round((coverageScore * 0.6) + (linkScore * 0.4))

    const orphanCount = clusterPages.filter(p => p.isOrphan).length
    const internalLinkHealth = orphanCount === 0 ? 'strong' : orphanCount <= 1 ? 'partial' : 'missing'

    clusters.push({
      pillarTopic: cluster.pillarTopic,
      pillarKeyword: cluster.pillarKeyword,
      pillarArticleId: cluster.pillarArticleId,
      clusterPages,
      missingSubtopics: cluster.missingSubtopics || [],
      topicalAuthorityScore,
      internalLinkHealth
    })
  }

  const allClusteredIds = new Set(clusters.flatMap(c => c.clusterPages.map(p => p.articleId)))
  const orphanArticles = articles.filter(a => !allClusteredIds.has(a.id)).map(a => a.id)

  const weakestCluster = clusters.sort((a, b) => a.topicalAuthorityScore - b.topicalAuthorityScore)[0]
  const topRecommendation = orphanArticles.length > 0
    ? `${orphanArticles.length} articles have no internal links — add them to a cluster and link them to the pillar page`
    : weakestCluster?.missingSubtopics.length > 0
      ? `Write "${weakestCluster.missingSubtopics[0]}" to strengthen your "${weakestCluster.pillarTopic}" cluster — currently at ${weakestCluster.topicalAuthorityScore}/100 topical authority`
      : 'Add internal links between cluster pages and their pillar pages to strengthen topical authority signals'

  return {
    clusters,
    totalArticles: articles.length,
    orphanArticles,
    topRecommendation,
    generatedAt: new Date().toISOString()
  }
}

export async function generateInternalLinkRecommendations(
  articleId: string,
  articleKeyword: string,
  allArticles: Array<{ id: string; title: string; keyword: string; url?: string }>
): Promise<Array<{ targetUrl: string; targetTitle: string; suggestedAnchorText: string; relevanceScore: number }>> {

  const otherArticles = allArticles.filter(a => a.id !== articleId)
  if (otherArticles.length === 0) return []

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 800,
    messages: [{
      role: 'user',
      content: `For an article about "${articleKeyword}", suggest the best internal links from these other articles.

Other articles:
${otherArticles.map(a => `- "${a.title}" (keyword: ${a.keyword}) URL: ${a.url || '#'}`).join('\n')}

Return JSON only:
{
  "links": [
    {
      "targetUrl": "url",
      "targetTitle": "title",
      "suggestedAnchorText": "natural anchor text that fits the source article",
      "relevanceScore": 85
    }
  ]
}

Only include genuinely relevant links (relevanceScore >= 60). Max 5 links.`
    }]
  })

  try {
    const text = response.content[0].type === 'text' ? response.content[0].text : '{}'
    const data = JSON.parse(text.replace(/```json|```/g, '').trim())
    return data.links || []
  } catch {
    return []
  }
}
