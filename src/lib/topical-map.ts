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

  const clusterResponse = await client.messages.create({
    model: MODEL_FOR.topicalMapCluster,
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: `You are an SEO expert building a topical authority map.

Analyse these articles and group them into topic clusters. Each cluster needs:
- One pillar topic (the broad subject)
- A primary keyword for the pillar
- Which article ID best serves as the pillar page (most comprehensive)
- Which article IDs are cluster/supporting pages
- 3-5 missing subtopics that would complete this cluster

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
    }]
  })

  let clusterData: any = { clusters: [] }
  try {
    const text = clusterResponse.content[0].type === 'text' ? clusterResponse.content[0].text : '{}'
    clusterData = JSON.parse(text.replace(/```json|```/g, '').trim())
  } catch {
    clusterData = {
      clusters: [{
        pillarTopic: articles[0]?.keyword || 'General',
        pillarKeyword: articles[0]?.keyword || '',
        pillarArticleId: articles[0]?.id || null,
        clusterArticleIds: articles.slice(1).map(a => a.id),
        missingSubtopics: ['Related subtopic 1', 'Related subtopic 2'],
        subtopicMap: {}
      }]
    }
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
