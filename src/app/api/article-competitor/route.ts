import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const maxDuration = 60;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

async function getTopCompetitorUrls(keyword: string, market: string): Promise<string[]> {
  const locationCode =
    market === 'United Kingdom' ? 2826 :
    market === 'United States'  ? 2840 :
    market === 'Australia'      ? 2036 :
    market === 'Canada'         ? 2124 : 2826;

  try {
    const response = await fetch('https://api.dataforseo.com/v3/serp/google/organic/live/advanced', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(
          `${process.env.DATAFORSEO_LOGIN}:${process.env.DATAFORSEO_PASSWORD}`
        ).toString('base64'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([{
        keyword,
        location_code: locationCode,
        language_code: 'en',
        depth: 10,
      }]),
      signal: AbortSignal.timeout(12000),
    });

    if (!response.ok) return [];
    const data = await response.json();
    const items = data?.tasks?.[0]?.result?.[0]?.items ?? [];
    return (items as Array<{ type: string; url: string }>)
      .filter(item => item.type === 'organic')
      .slice(0, 4)
      .map(item => item.url)
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function fetchCompetitorContent(url: string): Promise<string> {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return '';
    const html = await response.text();
    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 3000);
  } catch {
    return '';
  }
}

async function extractCompetitorNLP(competitorTexts: string[], keyword: string): Promise<{
  commonTopics: string[];
  contentGaps: string[];
  weaknesses: string[];
  entities: string[];
}> {
  const combined = competitorTexts
    .map((t, i) => `COMPETITOR ${i + 1}:\n${t}`)
    .join('\n\n---\n\n');

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1000,
    messages: [{
      role: 'user',
      content: `Analyse these top-ranking articles for "${keyword}" and extract competitive intelligence.

${combined}

Respond in JSON only:
{
  "commonTopics": ["topic every competitor covers — be specific"],
  "contentGaps": ["important subtopic NOT covered well by any competitor"],
  "weaknesses": ["specific area where competitor content is weak or superficial"],
  "entities": ["people, brands, tools, regulations, organisations mentioned"]
}

List at least 4 items in each array. Be specific and actionable.`,
    }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '{}';
  try {
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch {
    return { commonTopics: [], contentGaps: [], weaknesses: [], entities: [] };
  }
}

async function generateUniqueAngle(
  keyword: string,
  gaps: string[],
  weaknesses: string[],
): Promise<{ hook: string; uniqueSection: string; uniqueContent: string }> {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 400,
    messages: [{
      role: 'user',
      content: `For the keyword "${keyword}":
Content gaps competitors miss: ${gaps.slice(0, 5).join(', ')}
Competitor weaknesses: ${weaknesses.slice(0, 3).join(', ')}

Create a unique angle that directly exploits these gaps.

Respond in JSON only:
{
  "hook": "one surprising opening sentence that immediately signals this article is different from all others",
  "uniqueSection": "H2 heading for a unique section none of the competitors have",
  "uniqueContent": "100 words of genuinely differentiated content that fills the biggest gap"
}`,
    }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '{}';
  try {
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch {
    return { hook: '', uniqueSection: 'What the Top Results Get Wrong', uniqueContent: '' };
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      keyword = '',
      wordCount = 1500,
      tone = 'professional',
      market = 'United Kingdom',
      secondaryKeywords = [],
      entities = [],
      topicalGaps = [],
    } = body;

    console.log('[article-competitor] received:', { keyword, market });

    const safeWordCount = Math.min(wordCount, 1500);
    const kw = keyword.toLowerCase();

    // ── STEP 1: Get top competitor URLs ───────────────────────────────────────
    const competitorUrls = await getTopCompetitorUrls(keyword, market);
    console.log('[article-competitor] urls:', competitorUrls.length);

    // ── STEP 2: Fetch competitor content in parallel ───────────────────────────
    const competitorTexts = await Promise.all(
      competitorUrls.map(url => fetchCompetitorContent(url))
    );
    const validTexts = competitorTexts.filter(t => t.length > 100);
    console.log('[article-competitor] valid texts:', validTexts.length);

    // ── STEP 3: Extract NLP from competitors ─────────────────────────────────
    const nlp = validTexts.length > 0
      ? await extractCompetitorNLP(validTexts, keyword)
      : { commonTopics: [], contentGaps: [], weaknesses: [], entities: [] };

    // ── STEP 4: Generate unique angle from gaps ───────────────────────────────
    const allGaps = Array.from(new Set([...nlp.contentGaps, ...(topicalGaps as string[])])).slice(0, 8);
    const angle = await generateUniqueAngle(keyword, allGaps, nlp.weaknesses);

    // Merge entities
    const allEntities = Array.from(new Set([...nlp.entities, ...(entities as string[])])).slice(0, 10);
    const secondaryList = (secondaryKeywords as string[]).slice(0, 12).join(', ');
    const entitiesList = allEntities.join(', ');
    const gapsList = allGaps.join(', ');

    // Smart internal links
    let internalLinks = '';
    if (kw.includes('mot') || kw.includes('car') || kw.includes('vehicle') || kw.includes('dvsa') || kw.includes('tyre') || kw.includes('brake') || kw.includes('driving') || kw.includes('engine')) {
      internalLinks = `INTERNAL LINKS — insert these naturally in the article body (maximum 3 total, never same URL twice):
- "check your MOT history" → https://mot.autodun.com (when mentioning MOT checks or due dates)
- "free MOT predictor" → https://mot.autodun.com (use once in Bottom Line or FAQ)
- "find the right electric car" → https://ev.autodun.com (only if EVs mentioned)
- "instant AI car advice" → https://ai.autodun.com (when mentioning car problems or repairs)`;
    } else if (kw.includes('seo') || kw.includes('keyword') || kw.includes('content') || kw.includes('rank') || kw.includes('google') || kw.includes('search') || kw.includes('article')) {
      internalLinks = `INTERNAL LINKS — insert these naturally in the article body (maximum 2 total):
- "keyword research tool" → https://seoranko.com (when mentioning keyword research)
- "AI article generator" → https://seoranko.com (when mentioning content creation)`;
    } else if (kw.includes('health') || kw.includes('fitness') || kw.includes('weight') || kw.includes('diet') || kw.includes('exercise') || kw.includes('nutrition')) {
      internalLinks = `INTERNAL LINKS — insert naturally (maximum 2 total):
- "personalised health analysis" → https://fitford.com (when mentioning health tracking)`;
    } else {
      internalLinks = `INTERNAL LINKS — insert 1 natural link to https://seoranko.com where appropriate.`;
    }

    // Automotive data section
    const isAutomotive = kw.includes('mot') || kw.includes('car') || kw.includes('vehicle') ||
      kw.includes('dvsa') || kw.includes('tyre') || kw.includes('brake') ||
      kw.includes('ev') || kw.includes('electric');

    const uniqueDataSection = isAutomotive
      ? `UNIQUE DATA SECTION — include this verbatim as its own H2 section:
<h2>What MOT Failure Data Actually Reveals</h2>
<p>According to DVSA's published annual MOT statistics, lighting defects consistently account for the largest share of major failures across England, Scotland and Wales — in some years representing more than one in five of all Major-category failures recorded. Brake system defects and tyre condition issues follow closely. What's rarely reported is the regional variation: urban test centres typically record higher failure rates than rural ones, a pattern that correlates with older average vehicle age and higher annual mileage in city areas.</p>
<p>Checking your specific vehicle's historical test record — including every advisory notice ever raised — gives you a significant advantage before your next test. The <a href="https://mot.autodun.com" rel="noopener">Autodun MOT predictor</a> analyses DVSA data for your exact make, model, age, and mileage to flag the components statistically most likely to fail before your test date. It's the kind of preparation most drivers skip — and the kind that most often prevents an avoidable fail.</p>`
      : '';

    // ── STEP 5: Build master prompt with competitor intelligence ──────────────
    const competitorIntelSection = validTexts.length > 0 ? `
════════════════════════════════════════
COMPETITOR INTELLIGENCE (${validTexts.length} TOP-RANKING ARTICLES ANALYSED)
════════════════════════════════════════
Topics every competitor covers (you must cover these better):
${nlp.commonTopics.slice(0, 5).map((t, i) => `${i + 1}. ${t}`).join('\n')}

Content gaps competitors MISS — cover all of these:
${nlp.contentGaps.slice(0, 5).map((t, i) => `${i + 1}. ${t}`).join('\n')}

Competitor weaknesses to directly address:
${nlp.weaknesses.slice(0, 3).map((t, i) => `${i + 1}. ${t}`).join('\n')}

CRITICAL: Your article must visibly outperform these results on every gap listed above.
` : '';

    const prompt = `CRITICAL FORMAT RULE — READ FIRST:
Output ONLY valid HTML. Strictly forbidden:
- # ## ### markdown headings → use <h1> <h2> <h3> instead
- **bold** markdown → use <strong> instead
- --- dividers → use <hr> instead
- bullet - or * lists → use <ul><li> instead
- Any markdown code fences or backticks
- Plain text outside of HTML tags
The first line must be the HTML comment. Then schema script. Then <h1>. Nothing before the comment.

════════════════════════════════════════
COMPETITOR-BEATING ARTICLE — GOOGLE 2026
════════════════════════════════════════

You are a senior UK journalist and SEO specialist with 15 years of experience writing for The Guardian, Which?, and Auto Express. Your brief: write an article that definitively outranks and outperforms every existing result for this keyword.

PRIMARY KEYWORD: ${keyword}
SECONDARY KEYWORDS (weave in naturally): ${secondaryList}
KEY ENTITIES (mention where relevant): ${entitiesList}
TOPICAL GAPS TO COVER: ${gapsList}
TONE: ${tone}
MARKET: ${market}
TARGET WORD COUNT: ${safeWordCount} words

${internalLinks}

${competitorIntelSection}

════════════════════════════════
SECTION 1 — FACT ACCURACY RULES
════════════════════════════════
1. Only state facts you are highly confident are accurate as of June 2026
2. For specific prices, fines, dates, or statistics — only include if you are certain
3. If unsure of a specific figure, write around it: "always verify current figures at gov.uk"
4. Never invent statistics, percentages, dates, or official announcements
5. Always attribute UK law and regulatory claims to the correct body: DVSA, HMRC, NHS, FCA, DVLA
6. Link regulatory claims to gov.uk or the relevant official UK body

════════════════════════════════
SECTION 2 — EEAT REQUIREMENTS
════════════════════════════════
EXPERIENCE — demonstrate firsthand knowledge:
- Use phrases like "In practice...", "What most people find is...", "The reality is..."
- Include practical observations only someone with real experience would know

EXPERTISE — show deep subject knowledge:
- Use correct technical terminology
- Explain WHY things work the way they do
- Cover nuances competitors miss (see competitor intelligence above)

AUTHORITATIVENESS — cite official sources:
- Include at least 2 official UK source citations with full URLs
- Use phrases: "According to official guidance...", "Under current UK law...", "GOV.UK states..."

TRUSTWORTHINESS — build reader confidence:
- Acknowledge limitations honestly: "This varies — check with an expert"
- Never overpromise

════════════════════════════════
SECTION 3 — GOOGLE HELPFUL CONTENT
════════════════════════════════
- Answer the reader's actual question fully and directly in the introduction
- Cover all W-questions: What, Why, How, When, Who, How much
- Include specific actionable steps the reader can take immediately
- Do not pad with filler — cut anything that does not add real value
- Include information competitors have missed or explained poorly

════════════════════════════════
SECTION 4 — AI DETECTION PREVENTION
════════════════════════════════
NEVER use: "It is worth noting" / "It is important to" / "In today's world" / "When it comes to" /
"Delve into" / "Crucial" / "Leverage" / "Navigate" / "Certainly" / "In conclusion" /
"Furthermore" / "Moreover" / "In addition to this" / "Needless to say"

Use instead: "Here's the thing —" / "In practice," / "Worth knowing:" / "The honest answer is" /
"That said," / "Practically speaking," / "Most people don't realise that" / "The short answer is"

════════════════════════════════
SECTION 5 — WRITING QUALITY
════════════════════════════════
1. VARY sentence length — mix short punchy sentences with longer explanatory ones
2. START sentences differently — never start two consecutive sentences with the same word
3. USE contractions naturally: you'll, it's, don't, that's, here's, you're, they've
4. VARY paragraph length — mix 2-sentence with 4-5 sentence paragraphs
5. USE British English: whilst, colour, centre, licence (noun), realise, kerb, tyre
6. OPEN with this hook: ${angle.hook || 'a counterintuitive fact that challenges the conventional wisdom on this topic'}

════════════════════════════════
SECTION 6 — ON-PAGE SEO REQUIREMENTS
════════════════════════════════
TITLE TAG: 50-60 characters, primary keyword near start, include year 2026 where natural
META DESCRIPTION: exactly 145-155 characters, include primary keyword and a benefit
KEYWORD PLACEMENT: primary keyword in H1, within first 100 words, in at least 2 H2 headings
HEADING HIERARCHY: one H1, 6-8 H2 sections minimum, H3 where depth warrants

════════════════════════════════
SECTION 7 — COMPLETE ARTICLE STRUCTURE
════════════════════════════════
Output in this EXACT order:

LINE 1 — Meta description HTML comment:
<!-- META: [145-155 characters — include primary keyword and a benefit] -->

THEN — Article schema JSON-LD:
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Article","headline":"[exact H1 title]","author":{"@type":"Person","name":"Seoranko Editorial Team"},"publisher":{"@type":"Organization","name":"Seoranko","url":"https://seoranko.com"},"dateModified":"2026-06-09","inLanguage":"en-GB"}
</script>

THEN — H1 title:
<h1>[Compelling title, primary keyword near start, 50-60 chars]</h1>

THEN — Introduction (150-200 words):
<p>Open with the hook. State what article covers. Include primary keyword in first 100 words.</p>

THEN — Body section 1 (200 words max):
<h2>[Cover first common competitor topic — but go deeper]</h2>
<p>...</p>

THEN — Body section 2 (200 words max):
<h2>[Cover second topic]</h2>
<p>...</p>

THEN — Body section 3 (200 words max):
<h2>[Cover third topic]</h2>
<p>...</p>

THEN — UNIQUE SECTION — the insight competitors completely miss:
<h2>${angle.uniqueSection || 'What Every Other Guide Gets Wrong'}</h2>
<p>${angle.uniqueContent || 'A genuinely unique insight filling the gap competitors leave.'}</p>

${uniqueDataSection}

THEN — Body section 4 (200 words max):
<h2>[Cover content gap from competitor analysis]</h2>
<p>...</p>

THEN — Body section 5 (200 words max):
<h2>[Cover another content gap]</h2>
<p>...</p>

THEN — Official Sources section:
<h2>What the Official Guidance Says</h2>
Reference and link to 2 official UK sources. Include actual URLs.

THEN — FAQ section:
<h2>Frequently Asked Questions</h2>
Exactly 5 questions as <h3> tags. Answers in <p> tags, 80-100 words each, conversational tone.
Include at least 2 FAQ questions that address the competitor gaps identified above.

THEN — FAQ Schema JSON-LD:
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[
{"@type":"Question","name":"[Q1]","acceptedAnswer":{"@type":"Answer","text":"[A1]"}},
{"@type":"Question","name":"[Q2]","acceptedAnswer":{"@type":"Answer","text":"[A2]"}},
{"@type":"Question","name":"[Q3]","acceptedAnswer":{"@type":"Answer","text":"[A3]"}},
{"@type":"Question","name":"[Q4]","acceptedAnswer":{"@type":"Answer","text":"[A4]"}},
{"@type":"Question","name":"[Q5]","acceptedAnswer":{"@type":"Answer","text":"[A5]"}}
]}
</script>

THEN — Bottom Line section:
<h2>The Bottom Line</h2>
<p>150-word practical summary. 2-3 specific action steps. Include one relevant internal link.</p>

THEN — Expert review block (verbatim):
<div class="expert-review" style="background:#F5F4F1;border-left:3px solid #FF6B2C;padding:16px 20px;border-radius:0 8px 8px 0;margin-top:32px;">
<p style="margin:0;font-size:13px;color:#6B6B6B;"><strong style="color:#0F0F0F;">Editorial review:</strong> This article has been researched using official DVSA and GOV.UK sources. All regulatory claims reflect current UK law as of June 2026. Data references are sourced from publicly available DVSA annual statistics. <a href="https://mot.autodun.com" rel="noopener">Verify your vehicle's MOT status</a> directly through official DVSA records.</p>
</div>

THEN — Footer metadata (always last):
<p class="article-meta"><em>Last updated: June 2026. This information reflects current UK regulations. Always verify regulatory details at <a href="https://www.gov.uk" rel="noopener">GOV.UK</a>.</em></p>
<p class="article-author">Written by the <strong>Seoranko Editorial Team</strong></p>

════════════════════════════════
SECTION 8 — TOKEN BUDGET
════════════════════════════════
- Introduction: 150 words
- Each of 5 body H2 sections: 200 words maximum
- Unique section: 150 words
- Official Sources: 150 words
- FAQ: 5 questions × 90 words = 450 words
- Bottom Line: 150 words
- Total target: ~1450 words

If approaching token limit:
1. Finish the current sentence and close the HTML tag
2. Jump immediately to The Bottom Line
3. Write expert review block and footer metadata
4. NEVER stop mid-sentence or mid-tag

════════════════════════════════
SECTION 9 — COMPETITOR-BEATING RULE
════════════════════════════════
This article exists to outrank and outperform every existing result. Every section must be more detailed, more accurate, or more helpful than the competition. The content gaps identified must be visibly addressed. The weaknesses in current results must be directly corrected.

Write the complete article now. Output HTML only — no commentary, no preamble, no markdown.`;

    // ── STEP 6: Stream article ────────────────────────────────────────────────
    const stream = await anthropic.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 6000,
      messages: [{ role: 'user', content: prompt }],
    });

    const readable = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        try {
          for await (const chunk of stream) {
            if (
              chunk.type === 'content_block_delta' &&
              chunk.delta.type === 'text_delta'
            ) {
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
        'X-Competitor-Count': String(validTexts.length),
        'X-Content-Gaps': nlp.contentGaps.slice(0, 5).join('|'),
      },
    });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error('[article-competitor]', error);
    return new Response(
      JSON.stringify({ error: error?.message || 'Competitor article generation failed' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
