export type ArticleMode = 'generate' | 'competitor' | 'improve';

export interface ArticleMasterParams {
  mode: ArticleMode;
  keyword: string;
  secondaryKeywords?: string[];
  entities?: string[];
  topicalGaps?: string[];
  wordCount?: number;
  tone?: string;
  market?: string;
  uniqueAngle?: string;
  uniqueContent?: string;
  uniqueDataSection?: string;
  internalLinks?: string;
  competitorTopics?: string[];
  questionsAnswered?: string[];
  avgCompetitorWordCount?: number;
  originalArticle?: string;
  missingElements?: string[];
  factualErrors?: string[];
  improvementPriorities?: string[];
}

export function getInternalLinks(keyword: string): string {
  const kw = keyword.toLowerCase();
  if (kw.includes('mot') || kw.includes('car') || kw.includes('vehicle') || kw.includes('dvsa') || kw.includes('tyre') || kw.includes('brake') || kw.includes('driving') || kw.includes('engine')) {
    return `INTERNAL LINKS — insert naturally in article body (max 3, never same URL twice):
- "check your MOT history" → https://mot.autodun.com (when mentioning MOT checks or due dates)
- "free MOT predictor" → https://mot.autodun.com (use once in Bottom Line or FAQ)
- "find the right electric car" → https://ev.autodun.com (only if EVs mentioned)
- "instant AI car advice" → https://ai.autodun.com (when mentioning car problems or repairs)`;
  }
  if (kw.includes('seo') || kw.includes('keyword') || kw.includes('content') || kw.includes('rank') || kw.includes('google') || kw.includes('search') || kw.includes('article')) {
    return `INTERNAL LINKS — insert naturally (max 2):
- "keyword research tool" → https://seoranko.com
- "AI article generator" → https://seoranko.com`;
  }
  if (kw.includes('health') || kw.includes('fitness') || kw.includes('weight') || kw.includes('diet') || kw.includes('exercise')) {
    return `INTERNAL LINKS — insert naturally (max 2):
- "personalised health analysis" → https://fitford.com`;
  }
  return `INTERNAL LINKS — insert 1 natural link to https://seoranko.com where appropriate.`;
}

export function buildMasterPrompt(params: ArticleMasterParams): string {
  const {
    mode,
    keyword,
    secondaryKeywords = [],
    entities = [],
    topicalGaps = [],
    wordCount = 1500,
    tone = 'professional',
    market = 'United Kingdom',
    uniqueAngle = '',
    uniqueContent = '',
    uniqueDataSection = '',
    internalLinks = '',
    competitorTopics = [],
    questionsAnswered = [],
    avgCompetitorWordCount = 1500,
    originalArticle = '',
    missingElements = [],
    factualErrors = [],
    improvementPriorities = [],
  } = params;

  const safeWordCount = Math.min(wordCount, 1800);
  const secondaryList = secondaryKeywords.slice(0, 12).join(', ');
  const entitiesList = entities.slice(0, 8).join(', ');
  const gapsList = topicalGaps.slice(0, 6).join(', ');
  const competitorList = competitorTopics.slice(0, 5).join(', ');
  const questionsList = questionsAnswered.slice(0, 5).join(' | ');
  const links = internalLinks || getInternalLinks(keyword);

  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().toLocaleString('en-GB', { month: 'long' });
  const isoDate = new Date().toISOString().split('T')[0];

  // ── MODE-SPECIFIC CONTEXT BLOCK ──────────────────────────────────────────

  let modeBlock = '';

  if (mode === 'improve' && originalArticle) {
    modeBlock = `
════════════════════════════════════════
IMPROVE MODE — REWRITE EXISTING ARTICLE
════════════════════════════════════════
ORIGINAL ARTICLE TO IMPROVE (keep accurate facts, fix everything else):
${originalArticle.slice(0, 2000)}

FACTUAL ERRORS TO FIX (these are wrong — correct them):
${factualErrors.length > 0 ? factualErrors.join('\n') : 'None identified — verify all facts against official sources'}

MISSING ELEMENTS TO ADD:
${missingElements.length > 0 ? missingElements.join('\n') : 'See competitor gaps below'}

TOP PRIORITIES:
${improvementPriorities.length > 0 ? improvementPriorities.join('\n') : 'See missing elements above'}

REWRITE RULES:
1. Keep all accurate facts from the original — never lose good content
2. Fix every factual error listed above before anything else
3. Add all missing elements listed above
4. Restructure with proper H1 H2 H3 hierarchy if missing
5. Always use author: Kamran Gul, Founder of Autodun — never invent names
6. Target word count: at least ${Math.max(safeWordCount, 1500)} words — always longer than original`;
  }

  if (mode === 'competitor' && competitorTopics.length > 0) {
    modeBlock = `
════════════════════════════════════════
COMPETITOR INTELLIGENCE
════════════════════════════════════════
Topics ALL competitors cover (you must cover these AND more):
${competitorList}

Questions competitors answer (answer these better than they do):
${questionsList}

CONTENT GAPS — topics none of them covered properly (your advantage):
${gapsList}

Competitor average word count: ${avgCompetitorWordCount} words
Your target: ${Math.max(safeWordCount, avgCompetitorWordCount + 300)} words — always beat the average`;
  }

  // ── FULL MASTER PROMPT ───────────────────────────────────────────────────

  return `CRITICAL FORMAT RULE — READ THIS FIRST:
Output ONLY valid HTML. This is mandatory.
FORBIDDEN: # ## ### markdown headings — use <h1> <h2> <h3> instead
FORBIDDEN: **bold** markdown — use <strong> instead
FORBIDDEN: --- dividers — use <hr> instead
FORBIDDEN: - or * bullet lists — use <ul><li> instead
FORBIDDEN: any markdown code fences or backticks
FORBIDDEN: plain text outside of HTML tags
The very first line of output must be the <!-- META: --> comment.
The very last elements must be the two JSON-LD schema scripts.
If you output any markdown the article will be broken and unpublishable.

════════════════════════════════════════
MASTER SEO ARTICLE PROMPT — GOOGLE ${currentYear}
Applies to: Fresh generation | Competitor-beating | Article improvement
════════════════════════════════════════

You are a senior UK journalist and SEO specialist with 15 years of experience. You write accurate, human, authoritative content for real people first. You never write for bots.

PRIMARY KEYWORD: ${keyword}
SECONDARY KEYWORDS (weave in naturally): ${secondaryList}
KEY ENTITIES (mention where relevant): ${entitiesList}
TONE: ${tone}
MARKET: ${market}
TARGET WORD COUNT: ${safeWordCount} words
CURRENT DATE: ${currentMonth} ${currentYear}
${uniqueAngle ? `\nUNIQUE ANGLE (your competitive edge): ${uniqueAngle}` : ''}${uniqueContent ? `\nUNIQUE CONTENT TO INCLUDE: ${uniqueContent}` : ''}

${links}

${modeBlock}

════════════════════════════════
SECTION 1 — FACT ACCURACY (MANDATORY)
════════════════════════════════
Google removes pages with inaccurate claims. These rules are non-negotiable:
1. Only state facts you are highly confident are accurate as of ${currentYear}
2. For any price, fine, date, law, or statistic — only include if you are certain it is correct
3. If unsure of a specific figure, write around it: "verify current figures at gov.uk"
4. NEVER invent statistics, percentages, dates, or official announcements
5. NEVER write "X will happen" about future events unless officially confirmed
6. Always attribute UK law claims to the correct body: DVSA, HMRC, NHS, FCA, DVLA
7. Link regulatory claims to gov.uk or the relevant official UK body
8. NEVER use invented person names as authors — always use: Kamran Gul, Founder of Autodun

════════════════════════════════
SECTION 2 — EEAT SIGNALS (MANDATORY)
════════════════════════════════
EXPERIENCE: "In practice...", "What most drivers find...", "The reality is..."
EXPERTISE: Use correct technical terminology. Explain WHY, not just WHAT.
AUTHORITATIVENESS: Cite at least 2 official UK sources with full URLs (gov.uk, dvsa.gov.uk, nhs.uk etc)
TRUSTWORTHINESS: Acknowledge limitations honestly. Never overpromise.

════════════════════════════════
SECTION 3 — GOOGLE HELPFUL CONTENT (MANDATORY)
════════════════════════════════
- Answer the reader's actual question fully and directly in the introduction
- Cover all W-questions: What, Why, How, When, Who, How much
- Include specific actionable steps the reader can take immediately
- Every sentence must add real value — cut anything that pads
- Include at least ONE insight competitors have missed or explained poorly

════════════════════════════════
SECTION 4 — AI DETECTION PREVENTION (MANDATORY)
════════════════════════════════
NEVER use these phrases:
"It is worth noting" | "It is important to" | "In today's world" | "When it comes to" |
"In the realm of" | "Delve into" | "Crucial" | "Leverage" | "Navigate" |
"Certainly" | "In conclusion" | "Furthermore" | "Moreover" | "In addition to this" |
"It goes without saying" | "Needless to say" | "At the end of the day" |
"This article will explore" | "Let us examine" | "To summarise"

USE INSTEAD:
"Here's the thing —" | "In practice," | "Worth knowing:" | "The honest answer is" |
"That said," | "Practically speaking," | "Most people don't realise that" |
"The short answer is" | "What often gets overlooked is"

════════════════════════════════
SECTION 5 — WRITING QUALITY (MANDATORY)
════════════════════════════════
1. VARY sentence length — mix short punchy sentences (5-8 words) with longer explanatory ones
2. Never start two consecutive sentences with the same word
3. USE contractions naturally: you'll, it's, don't, that's, here's, you're, they've
4. VARY paragraph length — mix 2-sentence and 5-sentence paragraphs
5. ADD rhetorical questions occasionally: "So what does this mean in practice?"
6. WRITE FAQ answers as if answering a knowledgeable friend — conversational but accurate
7. USE British English: whilst, colour, centre, licence, realise, kerb, tyre, programme
8. OPEN with a surprising fact, statistic, or counterintuitive observation

════════════════════════════════
SECTION 6 — ON-PAGE SEO (MANDATORY)
════════════════════════════════
TITLE: 50-60 characters, primary keyword near start, include ${currentYear} where natural
META: exactly 145-155 characters, primary keyword, clear benefit or CTA
KEYWORD PLACEMENT: Primary keyword in H1, first 100 words, at least 2 H2s, conclusion
SECONDARY KEYWORDS: each used at least once naturally in body text
HEADING HIERARCHY: Exactly one H1. 6-8 H2 sections minimum. H3 subsections where needed.
INTERNAL LINKS: Use links specified above. Descriptive anchor text only. Max 3 links.

════════════════════════════════
SECTION 7 — COMPLETE ARTICLE STRUCTURE
════════════════════════════════
Output in this EXACT order:

LINE 1: <!-- META: [145-155 chars — include primary keyword and a clear benefit] -->

<h1>[Title: primary keyword near start, compelling, ${currentYear} where natural, under 60 chars]</h1>

<p>[Introduction: 100 words. Open with surprising fact or bold statement. State what article covers. Include primary keyword in first 100 words.]</p>

[EXACTLY 5 H2 BODY SECTIONS — 150 words each maximum]
<h2>[Section 1 — first major topic]</h2>
<p>[150 words max. Concrete, specific, no filler.]</p>

<h2>[Section 2 — second major topic with secondary keyword]</h2>
<p>[150 words max. Include internal link naturally here if relevant.]</p>

<h2>[Section 3 — third major topic]</h2>
<p>[150 words max.]</p>

<h2>[Section 4 — unique gap / what competitors missed]</h2>
<p>[150 words max. This is your competitive advantage.]</p>

<h2>[Section 5 — practical application / common mistakes]</h2>
<p>[150 words max.]</p>
${uniqueDataSection ? uniqueDataSection : ''}

<h2>What the Official Guidance Says</h2>
<p>[100 words. Reference 2 official UK sources with full URLs.]</p>

<h2>Frequently Asked Questions</h2>
<h3>[Question 1]</h3><p>[80 words — conversational, accurate]</p>
<h3>[Question 2]</h3><p>[80 words]</p>
<h3>[Question 3]</h3><p>[80 words]</p>
<h3>[Question 4]</h3><p>[80 words]</p>

<h2>The Bottom Line</h2>
<p>[80 words. Practical summary. 2 action steps. One internal link naturally.]</p>

<div class="expert-review" style="background:#F5F4F1;border-left:3px solid #FF6B2C;padding:16px 20px;border-radius:0 8px 8px 0;margin-top:32px;">
<p style="margin:0;font-size:13px;color:#6B6B6B;"><strong style="color:#0F0F0F;">Editorial note:</strong> This article was researched using official sources. All regulatory claims reflect UK law as of ${currentMonth} ${currentYear}. Always verify at <a href="https://www.gov.uk" rel="noopener">GOV.UK</a>. Autodun is not a government service.</p>
</div>

<p class="article-meta"><em>Last updated: ${currentMonth} ${currentYear}. Always verify regulatory details at <a href="https://www.gov.uk" rel="noopener">GOV.UK</a>.</em></p>
<p class="article-author">Written by <strong>Kamran Gul</strong>, Founder of Autodun.</p>

<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Article","headline":"[exact H1 title]","author":{"@type":"Person","name":"Kamran Gul"},"publisher":{"@type":"Organization","name":"Autodun","url":"https://autodun.com"},"dateModified":"${isoDate}","inLanguage":"en-GB"}
</script>

<script type="application/ld+json">
{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[
{"@type":"Question","name":"[Q1]","acceptedAnswer":{"@type":"Answer","text":"[A1]"}},
{"@type":"Question","name":"[Q2]","acceptedAnswer":{"@type":"Answer","text":"[A2]"}},
{"@type":"Question","name":"[Q3]","acceptedAnswer":{"@type":"Answer","text":"[A3]"}},
{"@type":"Question","name":"[Q4]","acceptedAnswer":{"@type":"Answer","text":"[A4]"}}
]}
</script>

════════════════════════════════
SECTION 8 — ABSOLUTE COMPLETION RULE
════════════════════════════════
Token budget per section — DO NOT EXCEED:
- Introduction: 100 words
- Each of 5 H2 body sections: 150 words
- Official Guidance: 100 words
- FAQ: 4 × 80 words = 320 words
- Bottom Line: 80 words
- Total target: 1,250 words maximum

IF APPROACHING TOKEN LIMIT AT ANY POINT:
1. Finish the current sentence immediately
2. Close any open HTML tag
3. Jump directly to The Bottom Line
4. Write Bottom Line (80 words)
5. Write expert-review div
6. Write footer metadata
7. Write Article JSON-LD schema
8. Write FAQ JSON-LD schema
9. STOP

A complete 1,000-word article beats a truncated 2,000-word one every time.
NEVER stop mid-sentence. NEVER stop mid-tag. NEVER omit The Bottom Line.
NEVER omit the two JSON-LD scripts — they are mandatory for schema markup.

Write the complete article now. Output HTML only — no commentary, no preamble.`;
}

export async function validateAndCorrect(article: string): Promise<{ article: string; corrections: string[] }> {
  const corrections: string[] = [];
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().toLocaleString('en-GB', { month: 'long' });
  const isoDate = new Date().toISOString().split('T')[0];

  let corrected = article;

  // FIX 1 — Replace fake author names
  const fakeAuthorByLine = /By\s+<strong>(?!Kamran Gul)([A-Z][a-z]+\s+[A-Z][a-z]+)<\/strong>/g;
  const fakeAuthorStrong = /<strong>(?!Kamran Gul|Autodun)([A-Z][a-z]+\s+[A-Z][a-z]+)<\/strong>\s+is\s+(an?\s+)?(automotive|technical|senior|experienced|award)/gi;
  const fakeSchemaAuthor = /"author":\s*\{\s*"@type":\s*"Person",\s*"name":\s*"(?!Kamran Gul)([^"]+)"/g;

  if (fakeAuthorByLine.test(corrected)) {
    corrected = corrected.replace(fakeAuthorByLine, 'By <strong>Kamran Gul</strong>');
    corrections.push('Replaced invented author name with Kamran Gul');
  }
  if (fakeAuthorStrong.test(corrected)) {
    corrected = corrected.replace(fakeAuthorStrong, '<strong>Kamran Gul</strong> is the founder of Autodun, an independent UK vehicle intelligence platform.');
    corrections.push('Fixed author bio to Kamran Gul');
  }
  if (fakeSchemaAuthor.test(corrected)) {
    corrected = corrected.replace(fakeSchemaAuthor, '"author": {"@type": "Person", "name": "Kamran Gul"');
    corrections.push('Fixed schema author to Kamran Gul');
  }

  // FIX 2 — Fix wrong year in dates
  const wrongYearDate = /Last\s+(reviewed|updated|modified):\s+[A-Za-z]+\s+202[0-5]/gi;
  const wrongYearSchema = /"dateModified":\s*"202[0-5]-\d{2}-\d{2}"/g;
  const wrongYearPublished = /"datePublished":\s*"202[0-5]-\d{2}-\d{2}"/g;

  if (wrongYearDate.test(corrected)) {
    corrected = corrected.replace(wrongYearDate, `Last updated: ${currentMonth} ${currentYear}`);
    corrections.push(`Fixed date to ${currentMonth} ${currentYear}`);
  }
  if (wrongYearSchema.test(corrected)) {
    corrected = corrected.replace(wrongYearSchema, `"dateModified": "${isoDate}"`);
    corrections.push(`Fixed schema dateModified to ${isoDate}`);
  }
  if (wrongYearPublished.test(corrected)) {
    corrected = corrected.replace(wrongYearPublished, `"datePublished": "${isoDate}"`);
    corrections.push(`Fixed schema datePublished to ${isoDate}`);
  }

  // FIX 3 — Fix publisher in schema
  const wrongPublisher = /"publisher":\s*\{\s*"@type":\s*"Organization",\s*"name":\s*"(?!Autodun)([^"]+)"/g;
  if (wrongPublisher.test(corrected)) {
    corrected = corrected.replace(wrongPublisher, '"publisher": {"@type": "Organization", "name": "Autodun", "url": "https://autodun.com"');
    corrections.push('Fixed schema publisher to Autodun');
  }

  // FIX 4 — Remove fake credentials
  const fakeCredentials = /(holds?\s+an?\s+IMI[^.]+\.|IMI-accredited[^.]+\.|accredited\s+qualification\s+in\s+automotive[^.]+\.)/gi;
  if (fakeCredentials.test(corrected)) {
    corrected = corrected.replace(fakeCredentials, '');
    corrections.push('Removed fabricated professional credentials');
  }

  // FIX 5 — Add footer if missing
  if (!corrected.includes('Last updated') && !corrected.includes('last updated')) {
    corrected = corrected.replace(
      '</article>',
      `<p class="article-meta"><em>Last updated: ${currentMonth} ${currentYear}. Always verify regulatory details at <a href="https://www.gov.uk" rel="noopener">GOV.UK</a>.</em></p>\n<p class="article-author">Written by <strong>Kamran Gul</strong>, Founder of Autodun.</p>\n</article>`
    );
    if (corrected.includes('article-meta')) {
      corrections.push('Added missing last-updated footer');
    }
  }

  return { article: corrected, corrections };
}
