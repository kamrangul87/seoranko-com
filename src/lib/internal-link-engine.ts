/* eslint-disable @typescript-eslint/no-explicit-any */
// Brand-aware internal link engine.
// Research gap filled: every existing tool (WebKnoGraph, SBERT, Linkbot, Link Whisper)
// uses semantic similarity alone — none enforce brand + topic relevance gates.
// This engine uses a Supabase whitelist as the source of truth.

import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'

const aiClient = new Anthropic()

export interface RegisteredLink {
  id: string
  brand: string
  siteUrl: string
  pageUrl: string
  pageTitle: string
  pageDescription: string | null
  topicTags: string[]
  anchorText: string
}

export interface LinkPlacementResult {
  url: string
  anchorText: string
  pageTitle: string
  placed: boolean
  placedInContext: string
  reason: string
}

export interface SkippedLink {
  url: string
  reason: string
}

export interface InternalLinkEngineResult {
  articleWithLinks: string
  placements: LinkPlacementResult[]
  skipped: SkippedLink[]
  totalPlaced: number
  totalSkipped: number
}

// Composite relevance scoring — entity overlap, topic-cluster match (when
// available), and anchor naturalness, instead of raw tag/word-overlap
// alone. Raw overlap can't distinguish "technically eligible" from
// "actually useful here". Scored against keyword/title/angle text, NOT
// full article content: getEligibleLinks runs BEFORE the article is
// written (its output is fed into the write prompt so the model places
// links naturally as it writes) — the article body doesn't exist yet.
const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'been', 'will', 'your', 'you', 'are', 'was', 'were']);

function extractEntityTerms(text: string): Set<string> {
  return new Set(
    text.toLowerCase()
      .replace(/<[^>]+>/g, ' ')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3 && !STOPWORDS.has(w))
  )
}

// Does the link's preferred anchor text share real topic words with the
// article's own terms, or would inserting it read as generic/forced?
function scoreAnchorNaturalness(anchorText: string, articleTerms: Set<string>): number {
  const anchorWords = extractEntityTerms(anchorText)
  if (anchorWords.size === 0) return 50
  const overlap = Array.from(anchorWords).filter(w => articleTerms.has(w)).length
  return Math.round((overlap / anchorWords.size) * 100)
}

// Fetch eligible links from registry — only brand-matched + topic-relevant entries
export async function getEligibleLinks(
  userId: string,
  articleBrand: string,
  articleKeyword: string,
  articleTitle: string,
  maxLinks = 5,
  clusterTopicTerms?: string[]   // optional: from Topical Map, when it's been run for this brand
): Promise<RegisteredLink[]> {
  if (!userId || !articleBrand) return []

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data } = await supabase
    .from('internal_link_registry')
    .select('*')
    .eq('user_id', userId)
    .eq('brand', articleBrand)
    .eq('is_active', true)
    .limit(20)

  if (!data?.length) return []

  const articleTerms = extractEntityTerms(`${articleKeyword} ${articleTitle}`)

  const scored = data.map((link: any) => {
    const linkTerms = new Set([
      ...(link.topic_tags || []).map((t: string) => t.toLowerCase()),
      ...Array.from(extractEntityTerms(link.page_title)),
      ...Array.from(extractEntityTerms(link.page_description || ''))
    ])

    const sharedEntities = Array.from(articleTerms).filter(t => linkTerms.has(t))
    const entityOverlap = Math.min(100, sharedEntities.length * 25)

    const topicClusterMatch = clusterTopicTerms?.length
      ? Math.min(100, clusterTopicTerms.filter(t => linkTerms.has(t.toLowerCase())).length * 25)
      : entityOverlap // no cluster data available yet — fall back to entity overlap

    const anchorNaturalness = scoreAnchorNaturalness(link.anchor_text, articleTerms)

    const compositeScore = Math.round(
      entityOverlap * 0.45 +
      topicClusterMatch * 0.35 +
      anchorNaturalness * 0.20
    )

    return { link, compositeScore, breakdown: { entityOverlap, topicClusterMatch, anchorNaturalness } }
  })

  // Keep only candidates with a real, non-trivial relevance score — a
  // near-zero score means "technically tagged for this brand" but not
  // actually relevant to what this article is about.
  const ranked = scored
    .filter((s: any) => s.compositeScore >= 15)
    .sort((a: any, b: any) => b.compositeScore - a.compositeScore)
    .slice(0, maxLinks)

  if (ranked.length > 0) {
    console.log(
      `[internal-link-engine] eligible links for "${articleKeyword}": ` +
      ranked.map((r: any) => `${r.link.page_url} (score=${r.compositeScore})`).join(', ')
    )
  } else if (data.length > 0) {
    console.log(`[internal-link-engine] ${data.length} brand-matched link(s) in registry, none scored relevant enough for "${articleKeyword}"`);
  }

  return ranked.map((s: any) => ({
    id: s.link.id,
    brand: s.link.brand,
    siteUrl: s.link.site_url,
    pageUrl: s.link.page_url,
    pageTitle: s.link.page_title,
    pageDescription: s.link.page_description,
    topicTags: s.link.topic_tags || [],
    anchorText: s.link.anchor_text
  }))
}

// Build the injection prompt for Claude — only eligible links can be placed
export function buildInjectionPrompt(
  eligibleLinks: RegisteredLink[],
  articleBrand: string,
  articleKeyword: string
): string {
  if (eligibleLinks.length === 0) {
    return `
INTERNAL LINKS: No eligible internal links found for brand "${articleBrand}"
on topic "${articleKeyword}". Do NOT add any internal links to this article.
Do NOT invent links. Do NOT link to any external sites as internal links.
`
  }

  const linkList = eligibleLinks.map((link, i) => `
${i + 1}. URL: ${link.pageUrl}
   Title: ${link.pageTitle}
   Preferred anchor text: "${link.anchorText}"
   Topic tags: ${link.topicTags.join(', ')}
   Description: ${link.pageDescription || 'not provided'}`
  ).join('\n')

  return `
INTERNAL LINKS — MANDATORY RULES:

You may ONLY place links from the list below. These are the ONLY approved
internal links for brand "${articleBrand}" on topic "${articleKeyword}".

HARD RULES — violating any of these will cause article rejection:
1. ONLY place links from the numbered list below — no other URLs permitted
2. ONLY place a link where it fits naturally in existing paragraph text
3. Use the EXACT anchor text shown — no variations
4. Maximum 1 link per paragraph, maximum 3 links total
5. If a link does not fit naturally anywhere, DO NOT place it — skip it
6. DO NOT create new sentences just to fit a link
7. DO NOT link to any site not on this list — not even to gov.uk or official sources
   (those are external authority links, handled separately)

APPROVED LINKS FOR THIS ARTICLE:
${linkList}

For any link you skip, add at the end of the article:
<!-- LINK SKIPPED: [url] — reason: [why it didn't fit naturally] -->
`
}

// Inject links into a completed article using Claude
export async function injectInternalLinks(
  articleContent: string,
  eligibleLinks: RegisteredLink[],
  articleBrand: string,
  articleKeyword: string
): Promise<InternalLinkEngineResult> {
  if (eligibleLinks.length === 0) {
    return { articleWithLinks: articleContent, placements: [], skipped: [], totalPlaced: 0, totalSkipped: 0 }
  }

  const injectionPrompt = buildInjectionPrompt(eligibleLinks, articleBrand, articleKeyword)

  const response = await aiClient.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8000,
    system: `You are an SEO editor adding internal links to an article.\n${injectionPrompt}`,
    messages: [{
      role: 'user',
      content: `Add the approved internal links to this article following the rules above.
Return the complete article with links placed naturally.

ARTICLE:
${articleContent}`
    }]
  })

  const result = response.content[0].type === 'text' ? response.content[0].text : articleContent

  const placements: LinkPlacementResult[] = []
  const skipped: SkippedLink[] = []

  for (const link of eligibleLinks) {
    const isPlaced = result.includes(link.pageUrl)
    const skipMatch = result.match(
      new RegExp(`LINK SKIPPED: ${link.pageUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} — reason: ([^\\n]+)`)
    )

    if (isPlaced) {
      const linkIndex = result.indexOf(link.pageUrl)
      const sentenceStart = Math.max(0, result.lastIndexOf('.', linkIndex - 50) + 1)
      const sentenceEnd = Math.min(result.length, result.indexOf('.', linkIndex) + 1)
      const context = result.slice(sentenceStart, sentenceEnd).replace(/<[^>]+>/g, '').trim()

      placements.push({
        url: link.pageUrl,
        anchorText: link.anchorText,
        pageTitle: link.pageTitle,
        placed: true,
        placedInContext: context.slice(0, 150),
        reason: 'Placed naturally in article'
      })
    } else {
      skipped.push({
        url: link.pageUrl,
        reason: skipMatch?.[1]?.trim() || 'Did not fit naturally in article content'
      })
    }
  }

  const cleanArticle = result.replace(/<!--\s*LINK SKIPPED:[^>]*-->/g, '').trim()

  return {
    articleWithLinks: cleanArticle,
    placements,
    skipped,
    totalPlaced: placements.length,
    totalSkipped: skipped.length
  }
}

// Full pipeline: get eligible links from registry, then inject them
export async function runInternalLinkPipeline(
  articleContent: string,
  userId: string,
  articleBrand: string,
  articleKeyword: string,
  articleTitle: string
): Promise<InternalLinkEngineResult> {
  const eligibleLinks = await getEligibleLinks(userId, articleBrand, articleKeyword, articleTitle)
  return injectInternalLinks(articleContent, eligibleLinks, articleBrand, articleKeyword)
}
