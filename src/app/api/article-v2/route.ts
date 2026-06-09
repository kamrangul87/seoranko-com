import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const maxDuration = 60;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      keyword = '',
      wordCount = 2000,
      tone = 'professional',
      market = 'United Kingdom',
      secondaryKeywords = [],
      entities = [],
      topicalGaps = [],
    } = body;

    const secondaryList = (secondaryKeywords as string[]).slice(0, 15).join(', ');
    const entitiesList = (entities as string[]).slice(0, 10).join(', ');
    const gapsList = (topicalGaps as string[]).slice(0, 10).join(', ');

    const prompt = `You are a senior UK journalist and SEO specialist with 15 years of experience. You write for real people first, search engines second. Your writing is accurate, human, and authoritative.

PRIMARY KEYWORD: ${keyword}
SECONDARY KEYWORDS: ${secondaryList}
KEY ENTITIES: ${entitiesList}
TOPICS TO COVER: ${gapsList}
TONE: ${tone}
MARKET: ${market}
TARGET WORD COUNT: ${wordCount}

════════════════════════════════════
GOOGLE 2026 COMPLIANCE RULES
════════════════════════════════════

RULE 1 — FACT ACCURACY (most important)
Google removes pages with inaccurate claims. Follow these strictly:
- Only state facts you are highly confident are accurate as of 2026
- For any specific price, date, fine, law or statistic — only include if you are certain it is correct
- If unsure of a specific figure, write around it: "always verify the latest figures at gov.uk"
- Never invent statistics, percentages, dates or official announcements
- Never write "X will happen in 2026" unless you are certain it is confirmed
- Always attribute claims about UK law to the correct body: DVSA, HMRC, NHS, FCA etc
- Link to gov.uk or official sources for any regulatory claims

RULE 2 — EEAT SIGNALS (Experience, Expertise, Authoritativeness, Trust)
- Demonstrate firsthand knowledge: use phrases like "In practice...", "What drivers often find is...", "The reality is..."
- Cite at least 2 official UK sources inline with their URLs
- Include specific verified data points with attribution
- Show author expertise: write as someone who genuinely knows this topic deeply
- Add a "Last updated June 2026" line at the end
- Add author attribution at the end

RULE 3 — HELPFUL CONTENT (Google's #1 priority)
- Answer the user's actual question fully and directly
- Do not pad with filler — every sentence must add value
- Answer the W-questions: What, Why, How, When, Who, How much
- Include practical next steps the reader can take immediately
- Write for the person searching this query — what do they actually need to know?

RULE 4 — AI DETECTION PREVENTION
Never use these phrases (instant AI giveaway):
"It is worth noting", "It is important to", "In today's world", "When it comes to",
"In the realm of", "Delve into", "Crucial", "Leverage", "Navigate", "Certainly",
"In conclusion", "To summarise", "This article will explore", "Let us examine"

Instead use natural human phrases:
"Here's the thing —", "In practice,", "Worth knowing:", "The honest answer is",
"That said,", "Practically speaking,", "Most people don't realise that"

RULE 5 — WRITING QUALITY
- Vary sentence length: mix short (5-8 words) with longer explanatory sentences
- Use British English: whilst, colour, centre, licence, realise, kerb, tyre
- Use contractions naturally: you'll, it's, don't, that's, here's, you're
- Vary paragraph length: mix 2-sentence and 5-sentence paragraphs
- Never start two consecutive sentences with the same word
- Add rhetorical questions occasionally: "So what does this mean for you?"
- Write the FAQ answers conversationally — as if answering a friend

════════════════════════════════════
ON-PAGE SEO REQUIREMENTS
════════════════════════════════════

TITLE TAG: 50-60 characters max, primary keyword near the beginning, written for 2026

META DESCRIPTION: exactly 145-155 characters, include primary keyword, include a benefit or call to action

KEYWORD PLACEMENT:
- Primary keyword in: H1, first 100 words, at least 2 H2s, conclusion
- Secondary keywords: each used at least once naturally in body text
- Never repeat same keyword in consecutive sentences
- Use LSI (related) terms naturally throughout

HEADING STRUCTURE:
- One H1 only (the article title)
- H2s for main sections (6-8 sections minimum)
- H3s for subsections where needed
- Include primary or secondary keyword in at least 3 H2s

INTERNAL LINKING:
- Include 2-3 internal links to related content
- Use descriptive anchor text (not "click here")
- For automotive topics, link to: https://mot.autodun.com or https://ev.autodun.com where relevant
- For general topics, link to: https://seoranko.com

SCHEMA MARKUP:
- Include FAQ schema as JSON-LD at the end of the article
- Include Article schema with author and dateModified

════════════════════════════════════
COMPLETE ARTICLE STRUCTURE
════════════════════════════════════

Output in this EXACT order:

1. HTML comment with meta description (line 1):
<!-- META: [145-155 chars, primary keyword, benefit, CTA] -->

2. Article schema JSON-LD:
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "[H1 title]",
  "author": {"@type": "Person", "name": "Seoranko Editorial Team"},
  "publisher": {"@type": "Organization", "name": "Seoranko"},
  "dateModified": "2026-06-09",
  "inLanguage": "en-GB"
}
</script>

3. H1 — compelling title, primary keyword near start, 2026 where relevant

4. Introduction (150-200 words):
- Open with a surprising fact, statistic or question
- State clearly what the article covers
- Include primary keyword in first 100 words
- Tell reader what they will gain by reading

5. H2 Section 1 — [first main topic] (300+ words)
Include H3 subsections where needed

6. H2 Section 2 — [second main topic] (300+ words)

7. H2 Section 3 — [third main topic] (300+ words)

8. H2 Section 4 — [fourth main topic] (300+ words)

9. H2: What the Official Guidance Says
- Reference gov.uk, DVSA, NHS or relevant UK authority
- Include actual URL to official source
- Quote or paraphrase verified official information only

10. H2: Frequently Asked Questions
- 5 questions as H3s
- Answers: 80-120 words each, conversational tone
- Cover the most searched related questions for this topic

11. FAQ Schema JSON-LD:
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    [5 Q&A objects here matching the FAQ section above]
  ]
}
</script>

12. H2: The Bottom Line
- 150-word practical summary
- 2-3 specific action steps the reader should take now
- Internal link to relevant Autodun or Seoranko tool where appropriate

13. Footer metadata:
<p class="article-meta"><em>Last updated: June 2026. Information reflects current UK regulations. Always verify regulatory details at <a href="https://www.gov.uk" rel="noopener">GOV.UK</a>.</em></p>
<p class="article-author">Written by the <strong>Seoranko Editorial Team</strong></p>

════════════════════════════════════
CRITICAL COMPLETION RULE
════════════════════════════════════
You MUST complete the entire article including all sections above.
If you are approaching your token limit:
- Skip to The Bottom Line section immediately
- Write a proper conclusion
- Add the footer metadata
- NEVER stop mid-sentence or mid-section
- A complete shorter article is better than a truncated longer one

Write the complete article now. Do not add any commentary before or after — output the article HTML only.`;

    const stream = await anthropic.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 8000,
      messages: [{ role: 'user', content: prompt }],
    });

    const readable = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        try {
          for await (const chunk of stream) {
            if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
              controller.enqueue(encoder.encode(chunk.delta.text));
            }
          }
          controller.close();
        } catch (err) {
          controller.error(err);
        }
      },
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Transfer-Encoding': 'chunked',
        'X-Content-Type-Options': 'nosniff',
      },
    });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error('[article-v2]', error);
    return new Response(JSON.stringify({ error: error?.message || 'Failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
