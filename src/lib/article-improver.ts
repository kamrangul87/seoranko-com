import Anthropic from '@anthropic-ai/sdk'
import { runQualityGate } from './article-quality-gate'
import { repairAllMergeArtifacts } from './merge-artifact-repair'
import { buildQualityGateRunOptions } from './quality-gate-run-options'
import type { BrandSettingsLike } from './quality-gate-policy'

export type ImproveTarget = 'eeat' | 'readability' | 'human_score' | 'fact_sourcing' | 'keyword_density' | 'heading_structure' | 'authority_links' | 'all'

export interface ImproveRequest {
  articleContent: string
  target: ImproveTarget
  currentScore: number
  keyword: string
  title: string
  /**
   * Optional free-text instruction (e.g. a RANKO diagnosis `issue.fix`).
   * When set, this single targeted fix replaces the canned IMPROVE_PROMPTS[target]
   * pass so we change only what the diagnosis asked for.
   */
  instruction?: string
  /**
   * Was hardcoded 'autodun' below regardless of whose article this actually
   * is. Optional here because two automated callers (freshness-automation.ts,
   * rank-guard.ts) work off ranking_agent_articles, which doesn't have a
   * brand column at all yet — a real gap, not silently papered over; when
   * absent the Quality Gate below gets no brand rather than a fabricated one.
   */
  brand?: string
  /** Shared logo policy input — same as generate / recheck / Fix All. */
  brandSettings?: BrandSettingsLike
}

export interface ImproveResult {
  improvedContent: string
  changesSummary: string
  estimatedScoreGain: number
  qualityGate?: {
    passed: boolean
    score: number
    criticalCount: number
    warningCount: number
    autoFixedCount: number
    issues: object[]
    blockers: string[]
    readyToPublish: boolean
  }
}

const IMPROVE_PROMPTS: Record<ImproveTarget, string> = {
  eeat: `You are an expert editor improving an article's E-E-A-T signals (Experience, Expertise, Authoritativeness, Trustworthiness) for Google.

Make ONLY these targeted improvements to the article:
1. Add 1–2 specific firsthand observations or practical details that show real experience (not generic advice)
2. Strengthen any weak claims by adding specific data, named sources, or concrete examples
3. If the author bio exists, verify it mentions credentials relevant to the topic
4. Add a "Last verified: [current month year]" note if not present
5. Ensure every factual claim has a named source or is clearly attributed

DO NOT rewrite the entire article. Make surgical edits only.
Return the complete improved article with your changes applied.
At the end, add: <!-- CHANGES: [brief list of what you changed] -->`,

  readability: `You are an expert editor improving article readability for a UK general audience.

Make ONLY these targeted improvements:
1. Break any paragraphs longer than 4 sentences into shorter ones
2. Replace any jargon or technical terms with plain English alternatives (or add brief explanations in brackets)
3. Add a transitional sentence between sections that feel abrupt
4. Convert any dense lists of facts into readable sentences
5. Ensure the first sentence of every paragraph is clear and draws the reader in
6. Target Flesch Reading Ease of 60–70 (readable by most adults)

DO NOT rewrite the entire article. Make surgical edits only.
Return the complete improved article with your changes applied.
At the end, add: <!-- CHANGES: [brief list of what you changed] -->`,

  human_score: `You are an expert editor reducing AI-detection signals in an article to make it read as naturally human-written.

Make ONLY these targeted improvements:
1. Find and replace any "AI giveaway" phrases: "In today's world", "It's worth noting", "It is important to", "Furthermore", "Moreover", "In conclusion", "Delve into", "Leverage", "Utilise" (when "use" would do), "Comprehensive", "In the realm of"
2. Vary sentence length dramatically — mix 5-word punchy sentences with longer flowing ones
3. Add 1–2 short conversational asides or opinions that a real person would include (e.g. "Honestly, this surprised me during testing.")
4. Break up any section that has 3+ sentences of the same length
5. Remove any bullet points that feel like a generated list — convert to flowing prose where natural
6. Add one specific, slightly imperfect detail that only someone with real experience would know

DO NOT rewrite the entire article. Make surgical edits only.
Return the complete improved article with your changes applied.
At the end, add: <!-- CHANGES: [brief list of what you changed] -->`,

  fact_sourcing: `You are an expert editor improving fact density and source attribution in an article.

Make ONLY these targeted improvements:
1. Add a specific statistic or named source to any paragraph that currently has no cited evidence
2. Replace vague phrases ("many people", "studies show", "experts say") with specific attribution ("According to industry data from [Month Year]", "A recent regulator report found")
3. Add at least 2 more named entities (organisations, publications, government bodies) if the article is thin on these
4. Verify every statistic already in the article is attributed — add attribution where missing
5. Add a specific date or timeframe to any claim that currently has none

DO NOT rewrite the entire article. Make surgical edits only.
Return the complete improved article with your changes applied.
At the end, add: <!-- CHANGES: [brief list of what you changed] -->`,

  keyword_density: `You are an expert SEO editor adjusting keyword usage in an article.

The primary keyword is: {KEYWORD}

Make ONLY these targeted improvements:
1. If keyword density is below 0.5%: add the primary keyword naturally in 2–3 places where it fits without sounding forced — in a subheading, a paragraph opening, and the conclusion
2. If keyword density is above 2%: remove or replace some keyword instances with natural synonyms or longer variations
3. Add the keyword to the meta description if it is missing
4. Add the keyword to the first 100 words if it is not already there
5. Ensure H2 headings contain the keyword or close variants at least twice

DO NOT keyword-stuff. DO NOT rewrite the entire article.
Return the complete improved article with your changes applied.
At the end, add: <!-- CHANGES: [brief list of what you changed] -->`,

  heading_structure: `You are an SEO editor improving heading structure for AEO (Answer Engine Optimisation).

Make ONLY these targeted improvements:
1. Convert any H2 headings that are statements into questions (e.g. "The Benefits of X" → "What Are the Benefits of X?")
2. Ensure at least 4 of 6 H2 headings start with a question word: How, What, Why, When, Where, Which, Who
3. Fix any skipped heading levels (H1 directly to H3 — insert an H2 between them)
4. Ensure there is exactly one H1 tag in the article
5. Make question headings specific, not vague ("What Is SEO?" is too generic — "What Is SEO and Why Does It Matter in 2026?" is better)

DO NOT rewrite the article body. Only change heading text.
Return the complete article with heading improvements applied.
At the end, add: <!-- CHANGES: [list of headings changed] -->`,

  authority_links: `You are an SEO editor adding authoritative external links to an article.

Make ONLY these targeted improvements:
1. Identify 2-3 claims in the article that reference regulations, statistics, or official guidance
2. Add a link to the authoritative source for each: .gov.uk, .ac.uk, official regulatory body, or peer-reviewed publication
3. Replace any weak anchor text ("click here", "here", "this") with descriptive text
4. Ensure all external links have rel="noopener"
5. Do NOT add links to commercial websites — only to genuinely authoritative sources

DO NOT change the article content other than adding links.
Return the complete article with links added.
At the end, add: <!-- CHANGES: [links added] -->`,

  all: `You are an expert editor doing a comprehensive improvement pass on an article.

Apply ALL of these improvements:
1. EEAT: Add 1 firsthand observation, strengthen 2 weak claims with named sources
2. Readability: Break any paragraph over 4 sentences, simplify jargon
3. Human score: Remove 3+ AI giveaway phrases, vary sentence length, add 1 conversational aside
4. Fact sourcing: Add attribution to any unattributed claims, add 1 new named source
5. Keyword: Ensure primary keyword appears naturally in first 100 words and conclusion

Be surgical — improve without rewriting. The article's voice and structure should be preserved.
Return the complete improved article with your changes applied.
At the end, add: <!-- CHANGES: [brief list of what you changed] -->`
}

const client = new Anthropic()

const TARGETED_PROMPT = `You are an expert SEO editor applying ONE specific, targeted fix to an article.

You will be given a single instruction describing exactly what to change. Apply ONLY that change.

Rules:
- Make surgical edits. Do NOT rewrite the article, restructure it, or "improve" anything the instruction did not ask for.
- Preserve the author's voice, formatting, and all existing content that is unrelated to the instruction.
- If the instruction is already satisfied, return the article unchanged and say so in the CHANGES note.
- Never invent facts, statistics, citations, or sources. If the fix requires an authoritative external link, use only well-known, real, verifiable sources (gov.uk, NHS, official regulators, established academic institutions).

Return the complete article with your change applied.
At the end, add: <!-- CHANGES: [brief list of what you changed] -->`

export async function improveArticle(request: ImproveRequest): Promise<ImproveResult> {
  const targeted = Boolean(request.instruction?.trim())

  const systemPrompt = targeted
    ? TARGETED_PROMPT
    : IMPROVE_PROMPTS[request.target].replace('{KEYWORD}', request.keyword)

  const userMessage = targeted
    ? `Target keyword: "${request.keyword}".

Apply ONLY this fix to the article below:
${request.instruction!.trim()}

ARTICLE:
${request.articleContent}`
    : `Here is the article to improve. Current ${request.target} score: ${request.currentScore}/100. Target keyword: "${request.keyword}".

Apply the targeted improvements from your instructions. Return the complete improved article.

ARTICLE:
${request.articleContent}`

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }]
  })

  const improved = response.content[0].type === 'text' ? response.content[0].text : ''
  const changesMatch = improved.match(/<!--\s*CHANGES:\s*([\s\S]*?)\s*-->/)
  const changesSummary = changesMatch ? changesMatch[1].trim() : 'Improvements applied'
  let cleanedContent = improved.replace(/<!--\s*CHANGES:[\s\S]*?-->/g, '').trim()

  // The Improve rewrite can introduce the same truncated-word/merged-sentence
  // artifacts as generation — repair before the Quality Gate scores it.
  try {
    const repairResult = await repairAllMergeArtifacts(cleanedContent)
    cleanedContent = repairResult.content
    if (repairResult.repairsMade > 0) {
      console.log(`[article-improver] merge-artifact repair: fixed ${repairResult.repairsMade} broken sentence(s)`)
    }
  } catch (err) {
    console.warn('[article-improver] merge-artifact repair failed, continuing:', err)
  }

  const scoreGainMap: Record<ImproveTarget, number> = {
    eeat: 10, readability: 12, human_score: 15, fact_sourcing: 8,
    keyword_density: 5, heading_structure: 8, authority_links: 6, all: 20
  }

  let qualityGate: ImproveResult['qualityGate']
  try {
    const brandDomains: Record<string, string[]> = {
      autodun: ['autodun.com'], seoranko: ['seoranko.com'], fitford: ['fitford.com'],
    }
    const brand = request.brand || ''
    const qgOpts = buildQualityGateRunOptions({
      brand,
      keyword: request.keyword,
      authorName: 'Kamran Gul',
      registeredLinkDomains: brandDomains[brand] || [],
      minWordCount: 800,
      maxTypically: 5,
      brandSettings: request.brandSettings,
      caller: 'improve',
    })
    const qr = await runQualityGate(cleanedContent, {
      brand: qgOpts.brand,
      keyword: qgOpts.keyword,
      authorName: qgOpts.authorName || 'Kamran Gul',
      registeredLinkDomains: qgOpts.registeredLinkDomains,
      minWordCount: qgOpts.minWordCount,
      maxTypically: qgOpts.maxTypically,
      expectOrganizationLogo: qgOpts.expectOrganizationLogo,
    })
    qualityGate = {
      passed: qr.passed, score: qr.score, criticalCount: qr.criticalCount,
      warningCount: qr.warningCount, autoFixedCount: qr.autoFixedCount,
      issues: qr.issues, blockers: qr.blockers, readyToPublish: qr.readyToPublish,
    }
    if (qr.autoFixedCount > 0) {
      return { improvedContent: qr.articleAfterAutoFix, changesSummary, estimatedScoreGain: scoreGainMap[request.target], qualityGate }
    }
  } catch { /* non-fatal */ }

  return {
    improvedContent: cleanedContent,
    changesSummary,
    estimatedScoreGain: scoreGainMap[request.target],
    qualityGate,
  }
}

export async function improveArticleStream(
  request: ImproveRequest,
  onChunk: (chunk: string) => void,
  onComplete: (fullContent: string) => void
): Promise<void> {
  const systemPrompt = IMPROVE_PROMPTS[request.target]
    .replace('{KEYWORD}', request.keyword)

  const userMessage = `Here is the article to improve. Current ${request.target} score: ${request.currentScore}/100. Target keyword: "${request.keyword}".

Apply the targeted improvements. Return the complete improved article.

ARTICLE:
${request.articleContent}`

  let fullContent = ''

  const stream = await client.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 8000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }]
  })

  for await (const chunk of stream) {
    if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
      fullContent += chunk.delta.text
      onChunk(chunk.delta.text)
    }
  }

  onComplete(fullContent)
}
