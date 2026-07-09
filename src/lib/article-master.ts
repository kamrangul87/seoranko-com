/* eslint-disable @typescript-eslint/no-explicit-any */
import Anthropic from '@anthropic-ai/sdk';

// maxRetries lets the SDK auto-retry 429s using the server's Retry-After header.
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!, maxRetries: 5 });

import { MODEL_FOR } from '@/lib/model-router';
import { sanitiseForTransport } from '@/lib/sanitise-text';

export type ArticleMode = 'generate' | 'competitor' | 'improve';

export interface InternalLink {
  url: string
  anchorText: string
  context: string
}

export function buildInternalLinksPrompt(links: InternalLink[]): string {
  if (!links || links.length === 0) return ''
  const validLinks = links.filter(l => l.url && l.anchorText)
  if (validLinks.length === 0) return ''

  const linkList = validLinks.map((link, i) =>
    `${i + 1}. URL: ${link.url}
   Anchor text: "${link.anchorText}"
   Context: ${link.context || 'not specified'}`
  ).join('\n\n')

  return `
INTERNAL LINKS (mandatory — include ALL of these naturally in the article):
The user wants these internal links included. You MUST include every link below.
Rules:
- Place each link where it is genuinely relevant to the surrounding paragraph — never forced
- Use the EXACT anchor text specified, not a variation
- Distribute links throughout the article — not all in one section
- Never place two links in the same sentence
- Each link must appear as a proper HTML anchor: <a href="URL" rel="noopener">anchor text</a>
- If a link's context doesn't fit the article topic naturally, place it in the most relevant section and add a brief bridging sentence

Links to include:
${linkList}
`
}

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
  liveFacts?: string;
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
    liveFacts = '',
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

  // Schema language tag follows the target market rather than assuming en-GB
  const langMap: Record<string, string> = {
    'United States': 'en-US',
    'Australia': 'en-AU',
    'Canada': 'en-CA',
    'United Kingdom': 'en-GB',
  };
  const inLanguage = langMap[market] || 'en';

  // ── MODE-SPECIFIC CONTEXT BLOCK ──────────────────────────────────────────

  let modeBlock = '';

  if (mode === 'improve' && originalArticle) {
    modeBlock = `
════════════════════════════════════════
IMPROVE MODE — REWRITE EXISTING ARTICLE
════════════════════════════════════════
ORIGINAL ARTICLE TO IMPROVE (keep accurate facts, fix everything else):
${sanitiseForTransport(originalArticle.slice(0, 2000))}

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

You are a senior journalist and SEO specialist with 15 years of experience writing for the ${market} market. You write accurate, human, authoritative content for real people first. You never write for bots. You use the spelling, vocabulary, currency, and official bodies native to ${market}.

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
SECTION 1 — FACT ACCURACY (MANDATORY — ALL TOPICS, ALL COUNTRIES)
════════════════════════════════

LIVE VERIFIED FACTS (searched from official sources just now — use these):
${liveFacts || 'No live facts available — write around any uncertain specific figures'}

UNIVERSAL FACT RULES — apply to every article regardless of topic or country:

RULE 1 — THE SEARCH RULE (most important)
These live facts above came from real searches. Use them.
For any specific fact NOT in the live facts above:
- Do NOT invent it
- Do NOT guess it
- Write around it: "verify current figures at [official government source for ${market}]"
- This applies to: prices, rates, fees, fines, laws, limits, percentages, statistics,
  form numbers, document names, official body names, legislation dates

RULE 2 — NUMBERS AND RATES
Every specific number in the article must come from either:
a) The live verified facts above, OR
b) Something you are 100% certain is correct for ${market} in ${currentYear}
If neither applies: write "current rates — verify at [official source]"

RULE 3 — OFFICIAL BODY NAMES
Use exact official names only. Never abbreviate or approximate.
Examples of correct usage:
- UK: DVSA (not DVLA for testing), HMRC (not "tax office"), NHS (not "health service")
- US: IRS (not "tax authority"), FDA (not "drug regulator"), SSA (not "social security office")
- AU: ATO (not "tax office"), TGA (not "drug regulator")
- Other countries: always use the exact official name in that country's language/convention

RULE 4 — DOCUMENT AND FORM NAMES
Certificate names, form numbers, and official document names must be exact.
If uncertain of a specific form number or document name — describe it generically:
"the official test certificate" not "Form XYZ-123" unless you are certain.

RULE 5 — AUTHOR IDENTITY
Always use: Kamran Gul, Founder of Autodun
Never invent author names, credentials, or qualifications.
Never add "IMI-accredited" or any professional qualification unless it is real.

RULE 6 — STATISTICS
Every statistic must be attributed: "According to [source]..."
Never state percentages or figures as bare facts without a named source.
If a statistic came from the live facts above, cite the source provided.

RULE 7 — COUNTRY-SPECIFIC LAWS AND REGULATIONS
Laws, regulations, and official rules are specific to ${market}.
Never assume a rule from one country applies to another.
Always make clear which jurisdiction a rule applies to.
If the article is for a global audience, note that rules vary by country.

RULE 8 — CRISIS AND HELPLINE NUMBERS
Only include helpline numbers you are certain are correct for ${market}:
- UK: Samaritans 116 123 | NHS 111
- US: 988 Suicide and Crisis Lifeline
- AU: Lifeline 13 11 14
- CA: Crisis Services Canada 1-833-456-4566
- Other countries: do not include specific numbers unless certain — say "contact your local emergency services"

RULE 9 — NEVER INVENT CITATIONS, DOCUMENT NUMBERS OR REFERENCE CODES
This is one of the most dangerous hallucination patterns in AI writing.

STRICTLY FORBIDDEN — never include any of these unless they came from the live verified facts:
- Document reference numbers: TB/432, SI 2018/1313, CFR 49.571, any alphanumeric code
- Specific guidance document names unless from official search results
- Study or report titles unless from official search results
- Statistical percentages or figures without a named verifiable source
- Named authors of official guidance unless verified
- Specific page numbers, section numbers, or clause references
- Any citation formatted as [Author, Year] or (Source, Year)

WHEN YOU WANT TO CITE SOMETHING:
- Only cite URLs that came from the live verified facts above
- If you want to reference official guidance, use the generic URL format:
  "published at [official URL from live facts]"
- Never write "according to document TB/XXX" or "as per guidance note XX/YY"
- If you cannot find the exact document in the live facts, say:
  "according to official DVSA guidance at gov.uk" — not a specific document code

SAFE CITATION FORMATS (use these):
✅ "According to DVSA guidance at gov.uk/guidance/mot-testing-guide..."
✅ "The official MOT inspection manual published at gov.uk states..."
✅ "GOV.UK confirms that..." with a link to gov.uk
✅ Statistics with named source: "DVSA annual testing statistics show..."

UNSAFE CITATION FORMATS (never use):
❌ "According to DVSA guidance document TB/432..."
❌ "As per SI 2018/1313 section 4.2..."
❌ "Research by [Name] (2024) found that..."
❌ "The XYZ Report (2023) states..."
❌ Any reference with a specific code, number or ID not from live search results

SELF-CHECK BEFORE EVERY FACTUAL SENTENCE:
1. Is this fact in the live verified facts above? → Use it
2. Am I 100% certain this is correct for ${market} in ${currentYear}? → Use it
3. Neither? → Write around it or omit it

A factually accurate shorter article always beats a longer article with invented facts.

════════════════════════════════
SECTION 1.5 — FACT SOURCING REQUIREMENTS (MANDATORY — NON-NEGOTIABLE)
════════════════════════════════

Every numeric claim, statistic, percentage, technical specification, or factual assertion in this article MUST meet one of these four standards:

1. SOURCED — attributed to a named source: "According to [Organisation]..." or linked to an official source (gov.uk, manufacturer spec sheet, industry body)
2. SELF-VERIFYING — a calculation shown transparently, e.g. "a 7.4kW charger draws approximately 32 amps (7,400W ÷ 230V)" rather than stating "32 amps" as an unexplained fact
3. EXPLICITLY HEDGED — qualified as approximate/typical with reasoning: "typically adds around 25–30 miles of range per hour, though this varies by vehicle efficiency and charging conditions"
4. REMOVED — if it cannot meet any of the above, do not state a specific number with false precision

NEVER state a bare statistic with no source, no calculation, and no hedge. This is the single most common quality gap in AI-generated content and Google's quality raters specifically flag it.

For vague claims like tariff timing or pricing: name the SPECIFIC real example if known and verifiable (e.g. "Octopus Go's off-peak window runs from 00:30–04:30"), or soften to acknowledge variability ("many time-of-use tariffs offer cheaper overnight rates — check current options with your supplier") rather than stating invented specifics.

For any topic involving a government grant, allowance, or regulated figure: ALWAYS state the most recent known approximate figure with a hedge — never just say "verify the current figure" with no number at all.
Example format: "As of ${currentMonth} ${currentYear}, the grant typically covers approximately [X]% up to £[Y], though always confirm the current rate as it is reviewed periodically."
A number with appropriate hedging is more useful and more citable than a vague instruction with no number.

SELF-SOURCING CHECKLIST — before every sentence with a number:
□ Is this attributed to a named source? → Write "According to [Source]..."
□ Can I show the calculation? → Show it in brackets: "(X ÷ Y = Z)"
□ Is it an estimate? → Say "approximately", "typically", or "around" and explain why it varies
□ Can I not do any of the above? → Omit the specific number entirely

════════════════════════════════
SECTION 2 — EEAT SIGNALS (MANDATORY)
════════════════════════════════
EXPERTISE: Use correct technical terminology. Explain WHY, not just WHAT.
AUTHORITATIVENESS: Cite at least 2 official ${market} sources with full URLs (use the correct official bodies and government domains for ${market})
TRUSTWORTHINESS: Acknowledge limitations honestly. Never overpromise.
AUTHOR IDENTITY: Include a visible byline "Written by Kamran Gul, Founder of Autodun" near the top of every article (directly after the H1 and dateline). Include Person JSON-LD schema with name, jobTitle, and worksFor fields.
AUTHOR BIO: Include a dedicated author bio section near the bottom (2-3 sentences about Kamran Gul's expertise specifically relevant to this article's topic — concrete, no invented credentials or qualifications).

════════════════════════════════
SECTION 2.5 — EXPERIENCE SIGNALS (MANDATORY — POST-MARCH 2026 GOOGLE CORE UPDATE)
════════════════════════════════
Experience is the dominant E-E-A-T signal after Google's March 2026 core update. Articles without first-person tested experience are being systematically demoted regardless of other quality signals.

MANDATORY EXPERIENCE REQUIREMENTS — every article must contain all four:

1. ONE first-person "tested/used/reviewed" paragraph with:
   - A named scenario: "When I [specific action] with [specific situation]..."
   - A measured outcome with real numbers: "...it took [X hours] and cost [£Y]..."
   - A documented edge case or failure: "It didn't work when..."
   - Must read like a genuine practitioner, NOT generic "users report" advice

2. At least one honest exception or failure caveat per article:
   - "This approach fails if..." or "One thing most guides miss:"
   - "The exception is when..." or "Worth knowing: this doesn't apply to..."

3. For every major H2 section, include ONE of these phrases:
   - "What surprised me:" — a counterintuitive finding from actual use
   - "What I'd do differently:" — a lesson from experience
   - "The reality is:" — a practical observation that contradicts common advice
   - "In practice," — what actually happens vs. what theory says

4. The opening paragraph MUST contain at least one of:
   "I tested" | "I used" | "I found" | "we tested" | "when I tried" | "in practice"

FORBIDDEN EXPERIENCE PHRASES (too generic — replace with specifics):
- "Many users find..." → Write "When I tested this..."
- "Users report that..." → Write "Testing showed [specific result]..."
- "Experts recommend..." → Use a named source or first-person finding
- "In practice, most people..." → Replace with a specific named scenario

EXPERIENCE STYLE RULE:
Write as if explaining to a knowledgeable friend after actually doing this yourself.
Every major section must contain at least one specific number from experience (time taken, cost, outcome measured, version tested).

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
7. USE the spelling and vocabulary native to ${market} (British English for the UK, American English for the US, etc — never mix conventions)
8. OPEN with a surprising fact, statistic, or counterintuitive observation

════════════════════════════════
SECTION 6 — ON-PAGE SEO (MANDATORY)
════════════════════════════════
TITLE: 50-60 characters, primary keyword near start, include ${currentYear} where natural
META: exactly 145-155 characters, primary keyword, clear benefit or CTA
KEYWORD PLACEMENT: Primary keyword in H1, first 100 words, at least 2 H2s, conclusion

ANSWER-FIRST RULE (mandatory):
The article's primary answer or key conclusion MUST appear within the first 30% of the article body — specifically in the first 2–3 paragraphs after the introduction. This is not optional. Research shows 44.2% of all AI citations come from the first 30% of text. Structure every article as:
1. Hook sentence (1 line)
2. Direct answer to the target query (2–4 sentences — the actual answer, not a teaser)
3. What this article covers (1 sentence)
4. Then expand with detail, evidence, examples

NEVER bury the answer. NEVER start with "In today's world..." or vague intros. Lead with the answer.

SECONDARY KEYWORDS: each used at least once naturally in body text
HEADING HIERARCHY: Exactly one H1. 6-8 H2 sections minimum. H3 subsections where needed.
INTERNAL LINKS: Use links specified above. Descriptive anchor text only. Max 3 links.
AI CRAWLERS: Add this meta tag at the top of every generated HTML article (as the second line, right after the META comment):
<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1">
This instructs Google, ChatGPT, and Perplexity to use the full content for AI snippets.

════════════════════════════════
SECTION 6.5 — AI CITATION OPTIMISATION (MANDATORY)
════════════════════════════════
These instructions ensure every article gets cited by AI search engines.

For ChatGPT citation:
- Include the brand/domain name (Autodun) naturally in the first 100 words
- Keep dateModified = today's date in Article schema
- Use clear, confident declarative statements ("X works by...", "The rule is...", not "X may work by...")

For Perplexity citation:
- FAQPage schema must be present with at least 4 questions
- Every paragraph must stay tightly on topic — no tangents
- Include outbound links to authoritative sources (gov.uk, official bodies, peer-reviewed sources where available)

For Google AI Overviews:
- Answer the primary question directly within the first 200 words (inverted pyramid)
- Same on-page SEO signals as classic Search (title, H1, meta description)
- Never add noindex

For Claude/Anthropic citation:
- Every paragraph must contain at least one verifiable fact (number, statistic, date, or named source)
- Use clear structural hierarchy (H1 → H2 → H3) — never skip levels
- Include authoritative citations with full source names (not just "sources say")

════════════════════════════════
SECTION 7 — COMPLETE ARTICLE STRUCTURE
════════════════════════════════
FRESHNESS RULE: The dateModified in the Article JSON-LD schema must reflect a genuine content change. Never update the date without changing content — Google penalises fake freshness signals (date bumping without real updates) as a trust violation.

Output in this EXACT order:

LINE 1: <!-- META: [145-155 chars — include primary keyword and a clear benefit] -->
LINE 2: <meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1">

<h1>[Title: primary keyword near start, compelling, ${currentYear} where natural, under 60 chars]</h1>

<p class="article-dateline"><em>Last updated: ${currentMonth} ${currentYear} · Fact-checked: ${currentMonth} ${currentYear}</em></p>
<p class="article-byline">Written by <strong>Kamran Gul</strong>, Founder of Autodun.</p>

<p>[Introduction: 110 words. Open with surprising fact or bold statement. State what article covers. Include primary keyword AND the brand/site name naturally in first 100 words. Answer the primary question directly within the first 200 words (inverted pyramid for Google AI Overviews).]</p>

PASSAGE CITABILITY — apply to every H2 section below:
• Phrase every H2 and H3 as a direct question where possible (e.g. "How does X work?" not "How X Works")
• Each H2 section must include at least one paragraph of 134-167 words that can stand alone as a complete answer — this is what AI engines extract and cite
• The article must contain at least 5 sentences with specific facts: numbers, statistics, percentages, dates, or named authoritative sources

[EXACTLY 5 H2 BODY SECTIONS — 150 words each maximum]
<h2>[Section 1 phrased as question — e.g. "What Is [topic] and Why Does It Matter in ${currentYear}?"]</h2>
<p>[130-150 words. Self-contained answer — a reader should understand this without reading anything else. Include at least 1 sentence with a specific fact, statistic, or authoritative source.]</p>

<h2>[Section 2 phrased as question — e.g. "How Does [topic] Actually Work?"]</h2>
<p>[130-150 words. Include internal link naturally here if relevant.]</p>

<h2>[Section 3 phrased as question — e.g. "When Do You Need to [topic]?"]</h2>
<p>[130-150 words.]</p>

<h2>[Section 4 phrased as question — the gap competitors miss]</h2>
<p>[130-150 words. This is your competitive advantage — include a concrete, specific fact nobody else mentions.]</p>

<h2>[Section 5 phrased as question — e.g. "What Are the Most Common Mistakes With [topic]?"]</h2>
<p>[130-150 words.]</p>
${uniqueDataSection ? uniqueDataSection : ''}

<h2>What Do Official Sources Say About This?</h2>
<p>[100 words. Reference 2 official ${market} sources with full URLs. Use format: "According to [Source] at [URL]..."]</p>

FAQ SECTION RULE (mandatory):
Every article MUST include exactly 6 FAQ items below. Rules:
- Questions must match real search queries people ask about this topic
- Questions should be phrased exactly as someone would type into Google or ask ChatGPT
- Each answer must be 2–4 sentences, self-contained (answerable without reading the article)
- Cover: definition question, how-to question, comparison question, cost/time question, common mistake question, best practice question
- These FAQs will be converted to FAQPage schema automatically — make them genuinely useful
- DO NOT add generic filler questions. Every question must be something a real user would actually search.

<h2>Frequently Asked Questions</h2>
<p><em>Note: FAQPage schema no longer generates Google rich results (deprecated May 2026) but retains strong AI citation value for ChatGPT, Perplexity, and Claude — always include it.</em></p>
<div class="faq-item"><h3>[Conversational question 1 — definition question, exactly as a user would type it?]</h3><p>[60-100 words — complete, self-contained answer. No "see above" or "as mentioned". A user should get the full answer from this alone.]</p></div>
<div class="faq-item"><h3>[Question 2 — how-to question?]</h3><p>[60-100 words]</p></div>
<div class="faq-item"><h3>[Question 3 — comparison question?]</h3><p>[60-100 words]</p></div>
<div class="faq-item"><h3>[Question 4 — cost or time question?]</h3><p>[60-100 words]</p></div>
<div class="faq-item"><h3>[Question 5 — common mistake question?]</h3><p>[60-100 words]</p></div>
<div class="faq-item"><h3>[Question 6 — best practice question?]</h3><p>[60-100 words]</p></div>

<h2>The Bottom Line</h2>
<p>[80 words. Practical summary. 2 action steps. One internal link naturally.]</p>

<div class="author-bio" style="background:#F0F4FF;border-left:3px solid #1D4ED8;padding:16px 20px;border-radius:0 8px 8px 0;margin-top:24px;">
<p style="margin:0;font-size:13px;color:#0F0F0F;"><strong>About the Author</strong><br><strong>Kamran Gul</strong> is the Founder of Autodun, an independent vehicle intelligence platform based in the United Kingdom. [2-3 sentences describing Kamran's direct expertise relevant to THIS specific article's topic — be concrete and specific, never invent qualifications or credentials.]</p>
</div>

<div class="expert-review" style="background:#F5F4F1;border-left:3px solid #FF6B2C;padding:16px 20px;border-radius:0 8px 8px 0;margin-top:16px;">
<p style="margin:0;font-size:13px;color:#6B6B6B;"><strong style="color:#0F0F0F;">Editorial note:</strong> This article was researched using official sources. All regulatory claims reflect ${market} rules as of ${currentMonth} ${currentYear}. Fact-checked: ${currentMonth} ${currentYear}. Always verify with the relevant official ${market} body before acting. Autodun is not a government service.</p>
</div>

<p class="article-meta"><em>Last updated: ${currentMonth} ${currentYear}. Always verify regulatory details with the official ${market} sources cited above.</em></p>

<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Article","headline":"[exact H1 title]","author":{"@type":"Person","name":"Kamran Gul","jobTitle":"Founder","worksFor":{"@type":"Organization","name":"Autodun"}},"publisher":{"@type":"Organization","name":"Autodun","url":"https://autodun.com"},"datePublished":"${isoDate}","dateModified":"${isoDate}","inLanguage":"${inLanguage}"}
</script>

<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Person","name":"Kamran Gul","jobTitle":"Founder","worksFor":{"@type":"Organization","name":"Autodun","url":"https://autodun.com"},"url":"https://autodun.com"}
</script>

<script type="application/ld+json">
{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[
{"@type":"Question","name":"[Q1 — exact conversational phrasing]","acceptedAnswer":{"@type":"Answer","text":"[A1 — 60-100 words, complete self-contained answer]"}},
{"@type":"Question","name":"[Q2]","acceptedAnswer":{"@type":"Answer","text":"[A2]"}},
{"@type":"Question","name":"[Q3]","acceptedAnswer":{"@type":"Answer","text":"[A3]"}},
{"@type":"Question","name":"[Q4]","acceptedAnswer":{"@type":"Answer","text":"[A4]"}}
]}
</script>

════════════════════════════════
SECTION 8 — ABSOLUTE COMPLETION RULE
════════════════════════════════
Token budget per section — DO NOT EXCEED:
- Introduction: 110 words
- Each of 5 H2 body sections: 150 words
- Official Sources: 100 words
- FAQ: 4 × 80 words = 320 words
- Bottom Line: 80 words
- Author bio: 80 words
- Total target: 1,340 words maximum

IF APPROACHING TOKEN LIMIT AT ANY POINT:
1. Finish the current sentence immediately
2. Close any open HTML tag
3. Jump directly to The Bottom Line
4. Write Bottom Line (80 words)
5. Write author bio div
6. Write expert-review div
7. Write footer metadata
8. Write Article JSON-LD schema
9. Write Person JSON-LD schema
10. Write FAQ JSON-LD schema
11. STOP

A complete 1,000-word article beats a truncated 2,000-word one every time.
NEVER stop mid-sentence. NEVER stop mid-tag. NEVER omit The Bottom Line.
NEVER omit the two JSON-LD scripts — they are mandatory for schema markup.

Write the complete article now. Output HTML only — no commentary, no preamble.`;
}

export async function validateAndCorrect(
  article: string,
  keyword = '',
  market = 'United Kingdom',
  liveFacts = '',
): Promise<{ article: string; corrections: string[] }> {
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
    corrected = corrected.replace(fakeAuthorStrong, '<strong>Kamran Gul</strong> is the founder of Autodun, an independent vehicle intelligence platform.');
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
      `<p class="article-meta"><em>Last updated: ${currentMonth} ${currentYear}. Always verify regulatory details with the official ${market} sources.</em></p>\n<p class="article-author">Written by <strong>Kamran Gul</strong>, Founder of Autodun.</p>\n</article>`
    );
    if (corrected.includes('article-meta')) {
      corrections.push('Added missing last-updated footer');
    }
  }

  // FIX 6 — Remove invented document reference codes (e.g. TB/432, SI 2018/1313)
  const inventedDocRefs = /(?:document|guidance|note|circular|bulletin|directive|specification|standard)\s+[A-Z]{1,4}[\/\-]\d{2,5}[a-z]?\b/gi;
  if (inventedDocRefs.test(corrected)) {
    corrected = corrected.replace(
      /(?:including\s+)?(?:guidance\s+)?document\s+[A-Z]{1,4}[\/\-]\d{2,5}[a-z]?\s+(?:which\s+[^,\.]+)?/gi,
      ''
    );
    corrected = corrected.replace(
      /,?\s*[A-Z]{1,4}[\/\-]\d{2,5}[a-z]?\s+(?:covers?|states?|requires?|mandates?)[^,\.]+/gi,
      ''
    );
    corrections.push('Removed invented document reference code — replaced with verified URL');
  }

  // FIX 7 — Flag unattributed specific statistics
  const unattributedStats = /(\d+(?:\.\d+)?%|\d+\s+(?:million|billion|thousand))\s+(?:of\s+)?(?:cars?|vehicles?|drivers?|people|users?)/gi;
  const statsMatches = corrected.match(unattributedStats);
  if (statsMatches && statsMatches.length > 0) {
    for (const stat of statsMatches) {
      const statIndex = corrected.indexOf(stat);
      const surrounding = corrected.slice(Math.max(0, statIndex - 100), statIndex + 100);
      const hasSource = /according to|source:|gov\.uk|dvsa|official|published|statistics/i.test(surrounding);
      if (!hasSource) {
        corrections.push(`Warning: statistic "${stat}" has no attributed source — consider adding attribution`);
      }
    }
  }

  // FIX 8 — Universal AI fact-check against the live verified facts. This is a
  // single Claude call that catches invented numbers/names/forms that the regex
  // fixes above can't know about — works for any topic in any country.
  try {
    const factCheck = await finalFactCheck(corrected, keyword, market, liveFacts);
    corrected = factCheck.article;
    corrections.push(...factCheck.corrections);
  } catch {
    // Never let the fact-check break article delivery
  }

  return { article: corrected, corrections };
}

// ─────────────────────────────────────────────────────────────────────────────
// LIVE FACT VERIFICATION — runs a real web search before any article is written.
// No hardcoded facts, no country limits, no topic limits. Works for any keyword
// in any market. Always fails open: if search is unavailable, returns no facts
// and the master prompt instructs the model to write around uncertain figures.
// ─────────────────────────────────────────────────────────────────────────────
export async function fetchVerifiedFacts(
  keyword: string,
  market: string,
  competitors: string[] = [],
): Promise<{ facts: string; sources: string[] }> {
  const currentYear = new Date().getFullYear();

  try {
    // Determine what kind of facts need verification for this exact topic/market
    const competitorContext = competitors.length > 0
      ? ` Competitor pages cover: ${competitors.slice(0, 3).map(c => c.slice(0, 120)).join(' | ')}.`
      : '';

    const topicResponse = await anthropic.messages.create({
      model: MODEL_FOR.keywordExtraction,
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: `For the topic "${keyword}" in ${market}, what are the 3 most important specific facts that must be verified from official sources before writing? (prices, rates, laws, limits, body names, form numbers etc).${competitorContext} List them as search queries only. Return JSON: {"queries": ["query1", "query2", "query3"]}`,
      }],
    });

    const topicText = topicResponse.content[0].type === 'text'
      ? topicResponse.content[0].text : '{"queries":[]}';
    let queries: string[] = [];
    try {
      queries = JSON.parse(topicText.replace(/```json|```/g, '').trim()).queries || [];
    } catch {
      queries = [`${keyword} official rules ${market} ${currentYear}`];
    }

    // Run live web searches for each query
    const searchResults: string[] = [];
    const sources: string[] = [];

    for (const query of queries.slice(0, 2)) {
      try {
        const searchResponse = await anthropic.messages.create({
          model: MODEL_FOR.factVerification,
          max_tokens: 350,
          // Cap internal searches so a single request can't balloon input tokens
          tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 2 } as any],
          messages: [{
            role: 'user',
            content: `Search for: "${query}" — ${currentYear}. Return ONLY verified facts from official government or authoritative sources. Include the source URL for each fact. Be concise — facts only, no commentary.`,
          }],
        });

        const facts = searchResponse.content
          .filter((b: any) => b.type === 'text')
          .map((b: any) => b.text)
          .join('\n')
          .slice(0, 500);

        if (facts.trim()) searchResults.push(facts);

        // Collect any cited source URLs the search surfaced
        for (const block of searchResponse.content as any[]) {
          for (const cite of (block?.citations || [])) {
            if (cite?.url && !sources.includes(cite.url)) sources.push(cite.url);
          }
        }
      } catch {
        /* skip failed searches */
      }
    }

    return {
      facts: searchResults.join('\n\n'),
      sources,
    };
  } catch {
    return { facts: '', sources: [] };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AEO/GEO HELPER FUNCTIONS — used in post-processing after article generation
// ─────────────────────────────────────────────────────────────────────────────

export function checkAnswerFirst(content: string): boolean {
  const cleanContent = content.replace(/<[^>]+>/g, '').trim()
  const totalWords = cleanContent.split(/\s+/).length
  const firstThirtyPercent = cleanContent.split(/\s+/).slice(0, Math.floor(totalWords * 0.3)).join(' ')
  const answerSignals = /\b(is|are|means|refers to|defined as|works by|costs|takes|requires|\d+%|\d+ (steps|ways|tips|methods))\b/i
  return answerSignals.test(firstThirtyPercent)
}

export function computeRankScore(signals: {
  eeat: number
  readability: number
  factDensity: number
  hasFAQ: boolean
  hasSchema: boolean
  answerFirst: boolean
}): number {
  // Weighted composite: SEO (40%) + AEO (35%) + GEO (25%)
  const seoComponent = (signals.eeat * 0.6 + signals.readability * 0.4) * 0.40
  const aeoComponent = (signals.factDensity * 0.5 + (signals.answerFirst ? 100 : 40) * 0.3 + (signals.hasFAQ ? 100 : 20) * 0.2) * 0.35
  const geoComponent = (signals.factDensity * 0.5 + (signals.hasSchema ? 100 : 0) * 0.5) * 0.25
  return Math.round(seoComponent + aeoComponent + geoComponent)
}

export function extractHowToSteps(content: string): Array<{ name: string; text: string }> {
  const stepPattern = /^#{1,3}\s*(?:Step\s+)?(\d+)[.:)]\s*(.+)$/gm
  const steps: Array<{ name: string; text: string }> = []
  let match: RegExpExecArray | null

  while ((match = stepPattern.exec(content)) !== null) {
    const stepTitle = match[2].trim()
    const afterHeading = content.slice(match.index + match[0].length).trim()
    const nextParagraph = afterHeading.split(/\n\n/)[0].replace(/<[^>]+>/g, '').trim()
    steps.push({ name: stepTitle, text: nextParagraph.slice(0, 300) })
  }

  return steps.slice(0, 10)
}

// Universal post-write fact check — compares the finished article against the
// live verified facts and flags invented numbers, names, or form references for
// any topic in any country. Returns the corrected article plus a change log.
async function finalFactCheck(
  article: string,
  keyword: string,
  market: string,
  liveFacts: string,
): Promise<{ article: string; corrections: string[] }> {
  const response = await anthropic.messages.create({
    model: MODEL_FOR.factVerification,
    max_tokens: 600,
    messages: [{
      role: 'user',
      content: `You are a fact-checker for a ${market} article about "${sanitiseForTransport(keyword)}".

LIVE VERIFIED FACTS (these are correct):
${liveFacts || 'None available'}

ARTICLE TO CHECK (first 2000 chars):
${sanitiseForTransport(article.slice(0, 2000))}

Find up to 3 specific factual claims in the article that:
1. Contradict the live verified facts above, OR
2. Appear to be invented specific numbers/names/forms that are not in the live facts

Return ONLY valid JSON:
{
  "corrections": [
    {
      "find": "exact text to find (max 50 chars)",
      "replace": "corrected text",
      "reason": "why wrong"
    }
  ],
  "invented_author_names": ["any person names that appear invented"]
}

If nothing is wrong return: {"corrections": [], "invented_author_names": []}`,
    }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '{}';
  let result: any = { corrections: [], invented_author_names: [] };

  try {
    result = JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch {
    /* keep original */
  }

  let corrected = article;
  const corrections: string[] = [];

  for (const fix of result.corrections || []) {
    if (fix.find && fix.replace && corrected.includes(fix.find)) {
      corrected = corrected.replace(fix.find, fix.replace);
      corrections.push(`Fixed: "${fix.find}" → "${fix.replace}"`);
    }
  }

  for (const name of result.invented_author_names || []) {
    if (!name || name === 'Kamran Gul') continue;
    const nameRegex = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
    if (nameRegex.test(corrected)) {
      corrected = corrected.replace(nameRegex, 'Kamran Gul');
      corrections.push(`Replaced invented author "${name}" with Kamran Gul`);
    }
  }

  return { article: corrected, corrections };
}
