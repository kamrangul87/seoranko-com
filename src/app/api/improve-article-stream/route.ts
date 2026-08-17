import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { getAnthropicClient } from '@/lib/anthropic'

export const maxDuration = 120

const IMPROVE_PROMPTS: Record<string, string> = {
  eeat: `You are an expert editor improving E-E-A-T signals. Make surgical improvements only:
1. Add 1–2 firsthand observations showing real experience
2. Strengthen weak claims with specific data and named sources
3. Add "Last verified: [current month year]" if missing
4. Ensure every factual claim has attribution
Return the full improved article. End with: <!-- CHANGES: [what changed] -->`,

  readability: `You are an expert editor improving readability for a UK general audience. Make surgical improvements only:
1. Break paragraphs longer than 4 sentences
2. Replace jargon with plain English
3. Add transitional sentences between abrupt sections
4. Target Flesch Reading Ease 60–70
Return the full improved article. End with: <!-- CHANGES: [what changed] -->`,

  human_score: `You are an expert editor reducing AI-detection signals. Make surgical improvements only:
1. Remove AI giveaway phrases: "In today's world", "It's worth noting", "Furthermore", "Moreover", "Delve into", "Leverage", "Comprehensive"
2. Vary sentence length dramatically — mix short punchy sentences with longer ones
3. Add 1–2 short conversational asides a real person would write
4. Break up sections with 3+ same-length sentences
Return the full improved article. End with: <!-- CHANGES: [what changed] -->`,

  human: `You are an expert editor reducing AI-detection signals. Make surgical improvements only:
1. Remove AI giveaway phrases: "In today's world", "It's worth noting", "Furthermore", "Moreover", "Delve into", "Leverage", "Comprehensive"
2. Vary sentence length dramatically — mix short punchy sentences with longer ones
3. Add 1–2 short conversational asides a real person would write
4. Break up sections with 3+ same-length sentences
Return the full improved article. End with: <!-- CHANGES: [what changed] -->`,

  fact_sourcing: `You are an expert editor improving fact density and citations. Make surgical improvements only:
1. Add a specific statistic or named source to paragraphs with no cited evidence
2. Replace vague phrases with specific attribution
3. Add at least 2 more named entities if article is thin
4. Add specific dates/timeframes to undated claims
Return the full improved article. End with: <!-- CHANGES: [what changed] -->`,

  keyword_density: `You are an SEO editor adjusting keyword usage. The primary keyword is: {KEYWORD}
Make surgical improvements only:
1. Add keyword naturally in 2–3 places if density is below 0.5%
2. Ensure keyword appears in first 100 words
3. Add keyword to H2 heading if missing
Return the full improved article. End with: <!-- CHANGES: [what changed] -->`,

  keyword: `You are an SEO editor adjusting keyword usage. The primary keyword is: {KEYWORD}
Make surgical improvements only:
1. Add keyword naturally in 2–3 places if density is below 0.5%
2. Ensure keyword appears in first 100 words
3. Add keyword to H2 heading if missing
Return the full improved article. End with: <!-- CHANGES: [what changed] -->`,

  heading_structure: `You are an SEO editor improving heading structure for AEO (Answer Engine Optimisation). Make ONLY these changes:
1. Convert statement H2s into questions (e.g. "The Benefits of X" → "What Are the Benefits of X?")
2. Ensure at least 4 of 6 H2s start with a question word: How, What, Why, When, Where, Which, Who
3. Fix any skipped heading levels (H1 → H3 without H2 — insert an H2 between them)
4. Ensure exactly one H1 tag
5. Make question headings specific, not vague
DO NOT rewrite the article body. Only change heading text.
Return the full article. End with: <!-- CHANGES: [headings changed] -->`,

  authority_links: `You are an SEO editor adding authoritative external links. Make ONLY these changes:
1. Identify 2-3 claims referencing regulations, statistics, or official guidance
2. Add a link to the authoritative source (.gov.uk, .ac.uk, official regulatory body)
3. Replace weak anchor text ("click here", "here", "this") with descriptive text
4. Ensure all external links have rel="noopener"
5. Do NOT link to commercial websites — only authoritative sources
DO NOT change content other than adding links.
Return the full article. End with: <!-- CHANGES: [links added] -->`,

  all: `You are an expert editor doing a comprehensive improvement pass. Apply ALL:
1. EEAT: Add 1 firsthand detail, strengthen 2 claims with sources
2. Readability: Break long paragraphs, simplify jargon
3. Human score: Remove 3+ AI phrases, vary sentence length, add 1 conversational aside
4. Fact sourcing: Add attribution to unattributed claims
5. Keyword: Ensure keyword in first 100 words and conclusion
Return the full improved article. End with: <!-- CHANGES: [what changed] -->`
}

export async function POST(req: NextRequest) {
  const { articleContent, target, currentScore, keyword } = await req.json()

  const client = getAnthropicClient()
  const systemPrompt = (IMPROVE_PROMPTS[target] || IMPROVE_PROMPTS.all)
    .replace('{KEYWORD}', keyword || '')

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const anthropicStream = await client.messages.stream({
          model: 'claude-sonnet-4-6',
          max_tokens: 8000,
          system: systemPrompt,
          messages: [{
            role: 'user',
            content: `Improve this article (current ${target} score: ${currentScore}/100, keyword: "${keyword}"):\n\n${articleContent}`
          }]
        })

        for await (const chunk of anthropicStream) {
          if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
            controller.enqueue(encoder.encode(chunk.delta.text))
          }
        }

        controller.close()
      } catch (err) {
        controller.error(err)
      }
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Transfer-Encoding': 'chunked',
      'Cache-Control': 'no-cache',
    }
  })
}
