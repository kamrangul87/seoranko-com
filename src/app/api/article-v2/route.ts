import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const maxDuration = 300;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

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

    console.log('[article-v2] received:', { keyword, secondaryKeywords: (secondaryKeywords as string[]).length, entities: (entities as string[]).length });

    const safeWordCount = Math.min(wordCount, 1500);
    const secondaryList = (secondaryKeywords as string[]).slice(0, 12).join(', ');
    const entitiesList = (entities as string[]).slice(0, 8).join(', ');
    const gapsList = (topicalGaps as string[]).slice(0, 8).join(', ');

    // Smart internal links based on topic
    const kw = keyword.toLowerCase();
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

    // ── STEP A — Unique Angle Generator ──────────────────────────────────────
    const angleResponse = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `You are an editorial director at a top UK publication.

For the keyword: "${keyword}"
Secondary keywords: ${secondaryList}
Market: ${market}

Most articles on this topic cover: basic definitions, general advice, obvious facts.

Your job: identify ONE specific unique angle that:
1. Most existing articles completely miss
2. Answers a real question people have but can't find answered
3. Contains a surprising insight, counterintuitive fact, or data-driven observation
4. Cannot be easily replicated by AI Overview summaries

Respond in JSON only:
{
  "unique_angle": "one sentence description of the angle",
  "hook_opening": "one surprising opening sentence that grabs attention immediately",
  "unique_section_title": "H2 heading for the unique section nobody else covers",
  "unique_section_content": "150 words of genuinely unique insight for this section"
}

Do not write generic angles. Be specific and surprising.`
      }]
    });

    const angleText = angleResponse.content[0].type === 'text' ? angleResponse.content[0].text : '{}';
    let angle = { unique_angle: '', hook_opening: '', unique_section_title: '', unique_section_content: '' };
    try {
      angle = JSON.parse(angleText.replace(/```json|```/g, '').trim());
    } catch {
      console.error('[article-v2] angle parse failed, continuing without angle');
    }

    // ── STEP B — Data-Driven Unique Section (automotive) ─────────────────────
    const isAutomotive = kw.includes('mot') || kw.includes('car') || kw.includes('vehicle') ||
      kw.includes('dvsa') || kw.includes('tyre') || kw.includes('brake') ||
      kw.includes('ev') || kw.includes('electric');

    const uniqueDataSection = isAutomotive
      ? `UNIQUE DATA SECTION — include this verbatim in the article as its own H2 section:
<h2>What MOT Failure Data Actually Reveals</h2>
<p>According to DVSA's published annual MOT statistics, lighting defects consistently account for the largest share of major failures across England, Scotland and Wales — in some years representing more than one in five of all Major-category failures recorded. Brake system defects and tyre condition issues follow closely. What's rarely reported is the regional variation: urban test centres typically record higher failure rates than rural ones, a pattern that correlates with older average vehicle age and higher annual mileage in city areas.</p>
<p>Checking your specific vehicle's historical test record — including every advisory notice ever raised — gives you a significant advantage before your next test. The <a href="https://mot.autodun.com" rel="noopener">Autodun MOT predictor</a> analyses DVSA data for your exact make, model, age, and mileage to flag the components statistically most likely to fail before your test date. It's the kind of preparation most drivers skip — and the kind that most often prevents an avoidable fail.</p>`
      : '';

    // ── STEP C — Build master prompt with angle + data injected ──────────────
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
MASTER SEO ARTICLE PROMPT — GOOGLE 2026
════════════════════════════════════════

You are a senior UK journalist and SEO specialist with 15 years of experience writing for publications like The Guardian, Which?, and Auto Express. You write accurate, human, authoritative content. Real people read your work — you never write for bots.

PRIMARY KEYWORD: ${keyword}
SECONDARY KEYWORDS (weave in naturally): ${secondaryList}
KEY ENTITIES (mention where relevant): ${entitiesList}
TOPICAL GAPS TO COVER: ${gapsList}
TONE: ${tone}
MARKET: ${market}
TARGET WORD COUNT: ${safeWordCount} words

${internalLinks}

════════════════════════════════
SECTION 1 — FACT ACCURACY RULES
════════════════════════════════
Google removes pages with inaccurate claims. These rules are mandatory:

1. Only state facts you are highly confident are accurate as of June 2026
2. For any specific price, fine, date, law, or statistic — only include if you are certain it is correct
3. If unsure of a specific figure, write around it naturally: "always verify current figures at gov.uk" rather than inventing a number
4. Never invent statistics, percentages, dates, or official announcements
5. Never write "X will happen" about future events unless you are certain it is officially confirmed
6. Always attribute UK law and regulatory claims to the correct body: DVSA, HMRC, NHS, FCA, DVLA etc
7. Link regulatory claims to gov.uk or the relevant official UK body
8. If a topic section is outside your confident knowledge, write accurate general principles — never guess specifics

════════════════════════════════
SECTION 2 — EEAT REQUIREMENTS
════════════════════════════════
Google's 2026 Quality Rater Guidelines demand all four EEAT signals:

EXPERIENCE — demonstrate firsthand knowledge:
- Use phrases like "In practice...", "What most drivers find is...", "The reality is...", "Worth knowing here is..."
- Include practical observations only someone with real experience would know
- Reference real scenarios: "If your car fails on a lighting defect..."

EXPERTISE — show deep subject knowledge:
- Use correct technical terminology for the topic
- Explain WHY things work the way they do, not just what they are
- Cover nuances competitors miss

AUTHORITATIVENESS — cite official sources:
- Include at least 2 official UK source citations with full URLs (gov.uk, dvsa.gov.uk, nhs.uk, fca.org.uk etc)
- Reference real data, studies, or official statistics where available
- Use phrases: "According to DVSA guidance...", "Under current UK law...", "GOV.UK states..."

TRUSTWORTHINESS — build reader confidence:
- Acknowledge limitations honestly: "This varies by vehicle — check with your garage"
- Never overpromise or make absolute claims you cannot verify
- Include last updated date and author attribution at the end

════════════════════════════════
SECTION 3 — GOOGLE HELPFUL CONTENT
════════════════════════════════
Google's #1 ranking signal in 2026 is genuinely helpful content. Every sentence must earn its place.

- Answer the reader's actual question fully and directly in the introduction
- Cover all W-questions: What, Why, How, When, Who, How much
- Include specific actionable steps the reader can take immediately
- Do not pad with filler — cut anything that does not add real value
- Write for the person searching this query — what do they actually need to know right now?
- Include information competitors have missed or explained poorly

════════════════════════════════
SECTION 4 — AI DETECTION PREVENTION
════════════════════════════════
These phrases are instant AI giveaways that trigger Google penalties. NEVER use them:
"It is worth noting" / "It is important to" / "In today's world" / "When it comes to" /
"In the realm of" / "Delve into" / "Crucial" / "Leverage" / "Navigate" /
"Certainly" / "In conclusion" / "To summarise" / "This article will explore" /
"Let us examine" / "Furthermore" / "Moreover" / "In addition to this" /
"It goes without saying" / "Needless to say" / "At the end of the day"

Use natural human phrases instead:
"Here's the thing —" / "In practice," / "Worth knowing:" / "The honest answer is" /
"That said," / "Practically speaking," / "Most people don't realise that" /
"The short answer is" / "What often gets overlooked is"

════════════════════════════════
SECTION 5 — WRITING QUALITY
════════════════════════════════
1. VARY sentence length — deliberately mix short punchy sentences (5-8 words) with longer explanatory ones. Never write 3 sentences of similar length in a row.
2. START sentences differently — never start two consecutive sentences with the same word
3. USE contractions naturally throughout: you'll, it's, don't, that's, here's, you're, they've, we're
4. VARY paragraph length — mix 2-sentence paragraphs with 4-5 sentence paragraphs
5. ADD rhetorical questions occasionally: "So what does this mean in practice?" / "Why does this matter?"
6. WRITE FAQ answers as if answering a knowledgeable friend — conversational but accurate
7. USE British English throughout: whilst, colour, centre, licence (noun), realise, kerb, tyre, cheque, programme, organisation
8. OPEN the article with this specific hook sentence: ${angle.hook_opening || 'a surprising fact or counterintuitive observation'} — then continue with the introduction naturally.

════════════════════════════════
SECTION 6 — ON-PAGE SEO REQUIREMENTS
════════════════════════════════
TITLE TAG: 50-60 characters, primary keyword near the start, include year 2026 where natural

META DESCRIPTION: exactly 145-155 characters, include primary keyword, include a clear benefit or call to action, do not truncate

KEYWORD PLACEMENT:
- Primary keyword: in H1, within first 100 words, in at least 2 H2 headings, in conclusion
- Secondary keywords: each used at least once naturally in body text
- LSI/related terms: woven throughout naturally
- Never repeat same keyword phrase in consecutive sentences
- Keyword density: natural, never forced — aim for 1-2% maximum

HEADING HIERARCHY:
- Exactly one H1 (the article title)
- 6-8 H2 sections minimum
- H3 subsections where content depth warrants it
- Include primary or secondary keyword in at least 3 H2 headings

INTERNAL LINKS:
- Use the links specified in the INTERNAL LINKS section above
- Wrap in proper <a href="URL" rel="noopener">anchor text</a> tags
- Place within natural body text sentences — never as standalone lines
- Never use "click here" or bare URLs as anchor text

════════════════════════════════
SECTION 7 — COMPLETE ARTICLE STRUCTURE
════════════════════════════════
Output in this EXACT order — no deviations:

LINE 1 — Meta description HTML comment:
<!-- META: [write exactly 145-155 characters here — include primary keyword and a benefit] -->

THEN — Article schema JSON-LD:
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Article","headline":"[exact H1 title]","author":{"@type":"Person","name":"Seoranko Editorial Team"},"publisher":{"@type":"Organization","name":"Seoranko","url":"https://seoranko.com"},"dateModified":"2026-06-09","inLanguage":"en-GB"}
</script>

THEN — H1 title:
<h1>[Compelling title, primary keyword near start, written for 2026, 50-60 chars]</h1>

THEN — Introduction (150-200 words):
<p>Open with the hook sentence specified above. State what article covers. Include primary keyword in first 100 words. Tell reader exactly what they will gain.</p>

THEN — Body section 1 (200 words max):
<h2>[Title with keyword where natural]</h2>
<p>...</p>

THEN — Body section 2 (200 words max):
<h2>[Title]</h2>
<p>...</p>

THEN — Body section 3 (200 words max):
<h2>[Title]</h2>
<p>...</p>

THEN — UNIQUE SECTION — include this as its own H2 section placed here (after section 3):
<h2>${angle.unique_section_title || 'What Most Guides Get Wrong'}</h2>
<p>${angle.unique_section_content || 'Include a genuinely unique insight here that competitors miss.'}</p>

${uniqueDataSection}

THEN — Body section 4 (200 words max):
<h2>[Title]</h2>
<p>...</p>

THEN — Body section 5 (200 words max):
<h2>[Title]</h2>
<p>...</p>

THEN — Official Sources section:
<h2>What the Official Guidance Says</h2>
Reference and link to 2 official UK sources. Include actual URLs.

THEN — FAQ section:
<h2>Frequently Asked Questions</h2>
Exactly 5 questions as <h3> tags. Answers in <p> tags, 80-100 words each, conversational tone.

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
<p>150-word practical summary. 2-3 specific action steps. Include one relevant internal link naturally.</p>

THEN — Expert review block (include this verbatim):
<div class="expert-review" style="background:#F5F4F1;border-left:3px solid #FF6B2C;padding:16px 20px;border-radius:0 8px 8px 0;margin-top:32px;">
<p style="margin:0;font-size:13px;color:#6B6B6B;"><strong style="color:#0F0F0F;">Editorial review:</strong> This article has been researched using official DVSA and GOV.UK sources. All regulatory claims reflect current UK law as of June 2026. Data references are sourced from publicly available DVSA annual statistics. <a href="https://mot.autodun.com" rel="noopener">Verify your vehicle's MOT status</a> directly through official DVSA records.</p>
</div>

THEN — Footer metadata (always last, always complete):
<p class="article-meta"><em>Last updated: June 2026. This information reflects current UK regulations. Always verify regulatory details at <a href="https://www.gov.uk" rel="noopener">GOV.UK</a>.</em></p>
<p class="article-author">Written by the <strong>Seoranko Editorial Team</strong></p>

════════════════════════════════
SECTION 8 — TOKEN BUDGET
════════════════════════════════
You have a fixed token limit. Manage it strictly:
- Introduction: 150 words
- Each of 5 body H2 sections: 200 words maximum
- Unique section: 150 words (use the content provided above verbatim)
- Official Sources section: 150 words
- FAQ: 5 questions × 90 words = 450 words
- Bottom Line: 150 words
- Total target: ~1450 words

If approaching token limit at any point:
1. Finish the current sentence
2. Close the current HTML tag
3. Jump immediately to The Bottom Line
4. Write the expert review block and footer metadata
5. NEVER stop mid-sentence or mid-tag — always close every open HTML tag

A complete 1000-word article beats a truncated 2000-word one every time.

════════════════════════════════
SECTION 9 — UNIQUENESS RULE
════════════════════════════════
This article must contain at least ONE insight, observation, or data point that cannot be found in a standard Google search or AI Overview.
The unique angle for this article is: ${angle.unique_angle || 'a specific insight that most articles on this topic miss entirely'}.
Make sure this angle is clearly present and prominent in the article — not buried or generic.

Write the complete article now. Output HTML only — no commentary, no preamble, no markdown.`;

    // ── STEP D — Stream article with angle injected ───────────────────────────
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
      },
    });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error('[article-v2]', error);
    return new Response(
      JSON.stringify({ error: error?.message || 'Article generation failed' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
