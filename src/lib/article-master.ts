/* eslint-disable @typescript-eslint/no-explicit-any */
import Anthropic from '@anthropic-ai/sdk';

// maxRetries lets the SDK auto-retry 429s using the server's Retry-After header.
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!, maxRetries: 5 });

import { MODEL_FOR } from '@/lib/model-router';
import { sanitiseForTransport } from '@/lib/sanitise-text';
import { normalizeMarketForAuthority, marketLabel } from '@/lib/markets';

export type ArticleMode = 'generate' | 'competitor' | 'improve';

// Was hardcoded to DVSA/gov.uk-only worked examples throughout the prompt
// regardless of what market the article was actually targeting — the
// general rules (RULE 3, RULE 8 below) already handled other markets
// reasonably, but the SAFE CITATION FORMATS section models pattern-match
// most strongly against showed only UK examples, biasing every article
// toward UK sourcing even when market was e.g. "Germany" or "Pakistan".
// Scoped to the same markets the deployment brief specified (UK/US/DE),
// plus a market-agnostic fallback for everything else — not attempting to
// hand-write authority examples for all 14 LOCATION_CODES entries.
interface AuthorityGuidance {
  citationExamples: string[]
  domainPattern: string
  financialFigureSource: string
}

const AUTHORITY_GUIDANCE: Record<string, AuthorityGuidance> = {
  'united kingdom': {
    citationExamples: [
      '"According to DVSA guidance at gov.uk/guidance/mot-testing-guide..."',
      '"The official MOT inspection manual published at gov.uk states..."',
      '"GOV.UK confirms that..." with a link to gov.uk',
    ],
    domainPattern: '.gov.uk, .ac.uk, or a named official regulatory body (e.g. gov.uk, DVSA, HMRC, NHS)',
    financialFigureSource: 'GOV.UK',
  },
  'united states': {
    citationExamples: [
      '"According to FTC guidance at ftc.gov..."',
      '"The official CDC guidelines published at cdc.gov state..."',
      '".gov confirms that..." with a link to the relevant federal agency',
    ],
    domainPattern: '.gov, .edu, or a named federal agency (e.g. FTC, DOT, CDC, IRS)',
    financialFigureSource: 'the relevant .gov source',
  },
  germany: {
    citationExamples: [
      '"According to the Bundesamt guidance at bund.de..."',
      '"The official federal guidance published at bund.de states..."',
      '"Bund.de confirms that..." with a link to the relevant Bundesamt',
    ],
    domainPattern: '.de official government domains or a named Bundesamt (federal office)',
    financialFigureSource: 'the relevant official .de government source',
  },
  global: {
    citationExamples: [
      'Named official government or regulatory sources for the target market, with a link where available — e.g. "According to [Official Body] at [official domain]..."',
    ],
    domainPattern: 'official government or regulatory sources for the target market — no specific institution assumed',
    financialFigureSource: 'the relevant official government source for that market',
  },
}

function getAuthorityGuidance(market: string): AuthorityGuidance {
  const key = normalizeMarketForAuthority(market)
  return AUTHORITY_GUIDANCE[key] || AUTHORITY_GUIDANCE.global
}

export interface InternalLink {
  url: string
  anchorText: string
  context: string
}

export function buildInternalLinksPrompt(
  links: InternalLink[],
  articleKeyword: string,
  articleTitle: string
): string {
  if (!links || links.length === 0) return ''
  const validLinks = links.filter(l => l.url && l.anchorText)
  if (validLinks.length === 0) return ''

  const linkList = validLinks.map((link, i) =>
    `${i + 1}. URL: ${link.url}
   Anchor text: "${link.anchorText}"
   What this page is about: ${link.context || 'not specified'}`
  ).join('\n\n')

  return `
INTERNAL LINKS — CRITICAL RULES (read carefully before placing any link):

The user has provided these internal links to include in the article about "${articleTitle}" (keyword: "${articleKeyword}"):

${linkList}

MANDATORY RELEVANCE CHECK — apply this rule to EVERY link before placing it:

Ask yourself: "Would a reader of THIS article, about THIS topic, genuinely benefit from clicking this link?"

ONLY place a link if ALL of these are true:
✓ The linked page is directly relevant to the article topic
✓ The anchor text flows naturally in the surrounding sentence
✓ A real editor would approve this link in a professional publication
✓ The link adds value for the reader — it is NOT just there for SEO

DO NOT place a link if ANY of these are true:
✗ The linked page is about a different product, service, or topic unrelated to this article
✗ Placing the link requires writing an awkward bridging sentence to make it fit
✗ The link would confuse or mislead a reader about what the linked page contains
✗ The linked page is an SEO tool but this article is about cars, health, travel, finance, etc.

EXAMPLE OF WRONG placement (never do this):
Article about: EV chargers
Link provided: seoranko.com (an SEO content tool)
WRONG: "For broader EV guidance, resources like Seoranko cover the charging landscape."
WHY WRONG: SEORANKO is an SEO tool, not an EV resource. This misleads readers and damages credibility.

EXAMPLE OF CORRECT placement:
Article about: EV chargers
Link provided: autodun.com/mot-checker (an MOT checker for UK vehicles)
CORRECT: Place in a section about vehicle maintenance, e.g. "Before a long EV journey, it's also worth ensuring your MOT is current — Autodun's [MOT checker](url) shows your vehicle's status instantly."
WHY CORRECT: Both are about UK vehicle ownership. The link is genuinely useful to the same reader.

IF A LINK IS NOT RELEVANT:
Do NOT place it anywhere. Do NOT force it in with a vague sentence.
Instead, at the end of the article add an HTML comment:
<!-- LINK SKIPPED: [url] — reason: not relevant to article topic "${articleKeyword}" -->

This comment will be logged and shown to the user so they know the link was not placed and why.

PLACEMENT RULES for links that DO pass the relevance check:
- Use the EXACT anchor text the user specified, not a variation
- Place naturally within existing paragraph text — never create a new paragraph just for a link
- If you have MULTIPLE different links to place, distribute them across different sections — not all in one section
- EACH UNIQUE URL MUST APPEAR AT MOST ONCE IN THE ENTIRE ARTICLE. Never place the same href twice, even in different sections (e.g. once mid-article AND again in the Bottom Line) — pick the single best-fitting location for that link and do not repeat it elsewhere, even if a later section's instructions mention "internal link naturally"
- Never place two links in the same sentence
- HTML format: <a href="URL" rel="noopener">anchor text</a>
- Maximum 1 link per paragraph
`
}

export interface ArticleMasterParams {
  mode: ArticleMode;
  keyword: string;
  secondaryKeywords?: string[];
  longTailKeywords?: string[];
  entities?: string[];
  topicalGaps?: string[];
  gapAnalysis?: { gapScore?: number; volume?: number; competitionLevel?: string; serpFeatures?: string[] };
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
  brandName?: string;
  brandDomain?: string;
}


export function buildMasterPrompt(params: ArticleMasterParams): string {
  const {
    mode,
    keyword,
    secondaryKeywords = [],
    longTailKeywords = [],
    entities = [],
    topicalGaps = [],
    gapAnalysis,
    wordCount = 1500,
    tone = 'professional',
    market = 'Global',
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
    brandName = '',
    brandDomain = '',
  } = params;

  const displayBrand = brandName.trim() || 'the publisher'
  const displayMarket = marketLabel(market) || market
  const safeWordCount = Math.min(Math.max(wordCount, 1500), 3000);

  // Article structure now scales with the requested word count instead of
  // being hardcoded in several places that never agreed with each other.
  // Confirmed root cause of articles running ~2x the requested length:
  // one section said "6-8 H2 sections minimum" unconditionally, another
  // said "EXACTLY 5" with its own fixed 1,340-word budget, and the FAQ
  // rule said "exactly 6 items" while the token budget said "4" — none of
  // them referenced safeWordCount, so the model satisfied the more
  // detailed structural mandates over the vaguer top-level word target.
  const h2SectionCount = safeWordCount <= 1000 ? 4 : safeWordCount <= 1800 ? 5 : safeWordCount <= 2500 ? 6 : 7;
  const faqItemCount = safeWordCount <= 1000 ? 4 : safeWordCount <= 1800 ? 5 : 6;
  const introWords = 110;
  const officialSourcesWords = 100;
  const bottomLineWords = 80;
  const authorBioWords = 80;
  const faqWordsEach = 80;
  const fixedBudget = introWords + officialSourcesWords + bottomLineWords + authorBioWords + (faqItemCount * faqWordsEach);
  const wordsPerH2Section = Math.max(100, Math.round((safeWordCount - fixedBudget) / h2SectionCount));
  const computedTotalBudget = fixedBudget + (h2SectionCount * wordsPerH2Section);

  const authorityGuidance = getAuthorityGuidance(market);
  // Raised from 12 — a real cluster brief can run to 14+ terms (confirmed:
  // "ev charger" generated with a 14-term cluster silently lost several past
  // the old cap). 20 gives realistic cluster sizes headroom; anything beyond
  // that is genuinely excessive for a single article and gets logged, not
  // silently dropped.
  const SECONDARY_KEYWORD_CAP = 20;
  if (secondaryKeywords.length > SECONDARY_KEYWORD_CAP) {
    console.warn(`[article-master] ${secondaryKeywords.length - SECONDARY_KEYWORD_CAP} secondary keyword(s) dropped (cap ${SECONDARY_KEYWORD_CAP}): ${secondaryKeywords.slice(SECONDARY_KEYWORD_CAP).join(', ')}`);
  }
  const secondaryList = secondaryKeywords.slice(0, SECONDARY_KEYWORD_CAP).join(', ');
  const longTailList = longTailKeywords.slice(0, 6).join(', ');
  const entitiesList = entities.slice(0, 8).join(', ');
  const gapsList = topicalGaps.slice(0, 6).join(', ');
  // Ranking-opportunity framing from the NLP Analyser's gap analysis, when
  // the article was generated from that brief — entities/topicalGaps above
  // already flow in regardless; this adds the WHY (volume, competition,
  // gap score) and target SERP features on top, when available.
  const gapAnalysisNote = gapAnalysis && (gapAnalysis.gapScore != null || gapAnalysis.volume != null)
    ? `\nRANKING OPPORTUNITY: this keyword has ${gapAnalysis.volume != null ? `${gapAnalysis.volume.toLocaleString()}/month search volume` : 'search volume'}${gapAnalysis.competitionLevel ? ` with ${gapAnalysis.competitionLevel} competition` : ''}${gapAnalysis.gapScore != null ? ` (gap score ${gapAnalysis.gapScore}/100)` : ''} — a genuine ranking opportunity if the content is comprehensive enough to close the gap above.${gapAnalysis.serpFeatures?.length ? `\nTARGET SERP FEATURES: structure content to be eligible for: ${gapAnalysis.serpFeatures.join(', ')}.` : ''}`
    : '';
  const competitorList = competitorTopics.slice(0, 5).join(', ');
  const questionsList = questionsAnswered.slice(0, 5).join(' | ');
  const links = internalLinks || '';

  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().toLocaleString('en-GB', { month: 'long' });

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
5. Always use author: Kamran Gul${displayBrand !== 'the publisher' ? `, ${displayBrand}` : ''} — never invent names
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

CRITICAL — NO TRUNCATED WORDS OR MERGED SENTENCES:
Never truncate a word mid-way through (e.g. "significant" becoming
"ificant"). Never merge two sentences without a space or the correct
punctuation between them (e.g. "reinforcement.t network" should be
"reinforcement. The network"). Before finalising each paragraph,
re-read it as a human would and confirm every word is complete and
every sentence boundary has proper spacing and capitalisation.

════════════════════════════════════════
MASTER SEO ARTICLE PROMPT — GOOGLE ${currentYear}
Applies to: Fresh generation | Competitor-beating | Article improvement
════════════════════════════════════════

You are a senior journalist and SEO specialist with 15 years of experience writing for the ${market} market. You write accurate, human, authoritative content for real people first. You never write for bots. You use the spelling, vocabulary, currency, and official bodies native to ${market}.

PRIMARY KEYWORD: ${keyword}
TOPIC LOCK (non-negotiable): Write exclusively about "${keyword}" for ${market}. The H1, every H2, and every paragraph must stay on this exact topic. Do not switch subjects.
${secondaryList ? `
SECONDARY KEYWORDS — MANDATORY: every keyword below (or a natural variant —
e.g. "installing an EV charger" satisfies "ev charger installation") MUST
appear at least once somewhere in the article. Distribute them across
different sections rather than clustering them in one paragraph; do not
force any single sentence to contain more than one: ${secondaryList}` : ''}
KEY ENTITIES (mention where relevant): ${entitiesList}${gapsList ? `
SUBTOPICS TO COVER — competitors rank for this keyword covering these angles;
work relevant ones in as sections, FAQ items, or supporting paragraphs, not
forced in artificially, but this is what closes the content gap rather than
just targeting the keyword phrase itself: ${gapsList}` : ''}${gapAnalysisNote}
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
Always use: Kamran Gul${displayBrand !== 'the publisher' ? `, ${displayBrand}` : ''}
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
  "according to official guidance from [named regulatory body]" — not a specific document code

SAFE CITATION FORMATS for ${market} (use these):
${authorityGuidance.citationExamples.map(e => `✅ ${e}`).join('\n')}
✅ Statistics with named source: "[Named Body]'s official statistics show..."

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
AUTHOR IDENTITY: Include a visible byline "Written by Kamran Gul${displayBrand !== 'the publisher' ? `, ${displayBrand}` : ''}" near the top of every article (directly after the H1 and dateline).
AUTHOR BIO: Include a dedicated author bio section near the bottom (2-3 sentences about Kamran Gul's expertise specifically relevant to this article's topic — concrete, no invented credentials or qualifications${displayBrand !== 'the publisher' ? `; mention ${displayBrand} where relevant` : ''}).

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

HEADING STRUCTURE RULE (mandatory):
- Every H2 heading MUST be phrased as a question or contain a question word (How, What, Why, When, Where, Which, Who)
- Minimum 4 of 6 H2 headings must be question-format
- Never skip heading levels: H1 → H2 → H3 only, never H1 → H3

HEADING RHYTHM RULE (mandatory):
Do not let more than 2 H2 headings open with the same question word.
Vary across How, What, Why, When, Should, Which — question-format still
satisfies the rule above with any of these, not just "What". Example:
instead of two headings both starting "What Is..." and "What Are...",
write one as "What Is..." and the other as "How Can You Avoid..." —
same information, varied rhythm.

SCANNABILITY RULE (mandatory) — apply to every H2 section:
Within the 130-150 word budget per section, break the section into 2-3
short paragraphs rather than one dense block, OR use an actual <ul>/<ol>
list where the section naturally contains a list of items, steps, or
comparable options (e.g. "the three most common mistakes," "eligibility
criteria," "X vs Y"). Bold (<strong>) the 1-2 most important terms or
figures per section — the specific numbers, named entities, or key terms
a reader scanning quickly should catch even without reading every
sentence. Readers arrive from AI Overviews, social links, and newsletters
as often as from classic search — each section must work on a fast scan,
not only on a full read.

AUTHORITY LINKS RULE (mandatory):
- Every article MUST include at least 2 external links to authoritative sources for ${market}: ${authorityGuidance.domainPattern}
- Link text must be descriptive — never use "click here", "here", "read more", or "this"
- Format: <a href="URL" rel="noopener">Descriptive anchor text</a>
- If the topic involves regulations specific to ${market}, always link to the specific official page, not the homepage

FINANCIAL FIGURES RULE:
Any time you state a specific grant amount, percentage, or currency figure
that could change (government grants, tax rates, official caps),
either link directly to ${authorityGuidance.financialFigureSource} in the same sentence, or
add "(verify with the official source)" immediately after the figure. A figure with
no source and no verification note will be flagged as a publishing
blocker.

SECONDARY KEYWORDS: each used at least once naturally in body text
PRIMARY KEYWORD DENSITY: weave "${keyword}" naturally, aiming for roughly 0.5-1.5% of body text — do not force it beyond that.${longTailList ? `
LONG-TAIL KEYWORDS (ranking surface area, not primary-keyword substitutes): ${longTailList}
Each long-tail term above should appear 1-2 times total — ideally as a natural subheading, FAQ question, or a single sentence addressing that specific angle. Never repeat a long-tail term more than twice; that dilutes the primary keyword's relevance signal and reads as stuffing.` : ''}

HEDGING WORD LIMIT — ENFORCE WHILE WRITING:
Do not use "typically" more than 4 times in the entire article.
Do not use "generally", "usually", "often", or "may" more than
3 times each. When you're about to write a hedge word, first check:
can this be a direct, confident statement instead? Prefer "A 7kW
charger requires a dedicated circuit" over "A 7kW charger typically
requires a dedicated circuit" wherever the fact is well-established.
Count your hedge words as you write — if you're approaching the
limit, rewrite the sentence to be direct instead.
HEADING HIERARCHY: Exactly one H1. ${h2SectionCount} H2 sections (sized to the target word count — see the section budget below). H3 subsections where needed.
INTERNAL LINKS: Use links specified above. Descriptive anchor text only. Max 3 links.
AI CRAWLERS: Add this meta tag at the top of every generated HTML article (as the second line, right after the META comment):
<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1">
This instructs Google, ChatGPT, and Perplexity to use the full content for AI snippets.

════════════════════════════════
SECTION 6.5 — AI CITATION OPTIMISATION (MANDATORY)
════════════════════════════════
These instructions ensure every article gets cited by AI search engines.

For ChatGPT citation:
- Include the brand or site name naturally in the first 100 words
- Keep dateModified = today's date in Article schema
- Use clear, confident declarative statements ("X works by...", "The rule is...", not "X may work by...")

For Perplexity citation:
- FAQPage schema must be present with at least 4 questions
- Every paragraph must stay tightly on topic — no tangents
- Include outbound links to authoritative sources for ${market} (${authorityGuidance.domainPattern}, peer-reviewed sources where available)

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
<p class="article-byline">Written by <strong>Kamran Gul</strong>${displayBrand !== 'the publisher' ? `, ${displayBrand}` : ''}.</p>

<p>[Introduction: 110 words. Open with surprising fact or bold statement. State what article covers. Include primary keyword AND the brand/site name naturally in first 100 words. Answer the primary question directly within the first 200 words (inverted pyramid for Google AI Overviews).]</p>

PASSAGE CITABILITY — apply to every H2 section below:
• Phrase every H2 and H3 as a direct question where possible (e.g. "How does X work?" not "How X Works")
• Each H2 section must include at least one paragraph of 134-167 words that can stand alone as a complete answer — this is what AI engines extract and cite
• The article must contain at least 5 sentences with specific facts: numbers, statistics, percentages, dates, or named authoritative sources

${(() => {
  const sectionAngles = [
    { title: `Section phrased as question — e.g. "What Is [topic] and Why Does It Matter in ${currentYear}?"`, note: `Self-contained answer — a reader should understand this without reading anything else. Include at least 1 sentence with a specific fact, statistic, or authoritative source.` },
    { title: `Section phrased as question — e.g. "How Does [topic] Actually Work?"`, note: `If an internal link is relevant AND has not already been placed elsewhere in the article, include it naturally here. Do not repeat a link already placed in an earlier section.` },
    { title: `Section phrased as question — e.g. "When Do You Need to [topic]?"`, note: `` },
    { title: `Section phrased as question — the gap competitors miss`, note: `This is your competitive advantage — include a concrete, specific fact nobody else mentions.` },
    { title: `Section phrased as question — e.g. "How Can You Avoid the Most Common Mistakes With [topic]?"`, note: `` },
    { title: `Section phrased as question — cost, timing, or practical logistics angle`, note: `` },
    { title: `Section phrased as question — a deeper angle beyond the basics, for longer/more thorough coverage`, note: `` },
  ];
  const chosen = sectionAngles.slice(0, h2SectionCount);
  return chosen.map((s) => `<h2>[${s.title}]</h2>
<p>[${wordsPerH2Section - 20}-${wordsPerH2Section} words. ${s.note}]</p>`).join('\n\n');
})()}
${uniqueDataSection ? uniqueDataSection : ''}

<h2>How Do Official Sources Back This Up?</h2>
<p>[100 words. Reference 2 official ${market} sources with full URLs. Use format: "According to [Source] at [URL]..."]</p>

FAQ SECTION RULE (mandatory):
Every article MUST include exactly ${faqItemCount} FAQ items below. Rules:
- Questions must match real search queries people ask about this topic
- Questions should be phrased exactly as someone would type into Google or ask ChatGPT
- Each answer must be 2–4 sentences, self-contained (answerable without reading the article)
- Cover a mix of: definition, how-to, comparison, cost/time, common mistake, and best-practice questions — pick the ${faqItemCount} most useful for this topic
- These FAQs will be converted to FAQPage schema automatically — make them genuinely useful
- DO NOT add generic filler questions. Every question must be something a real user would actually search.

<h2>Frequently Asked Questions</h2>
${Array.from({ length: faqItemCount }, (_, i) =>
  `<div class="faq-item"><h3>[Conversational question ${i + 1} — exactly as a user would type it?]</h3><p>[${faqWordsEach - 20}-${faqWordsEach + 20} words — complete, self-contained answer. No "see above" or "as mentioned". A user should get the full answer from this alone.]</p></div>`
).join('\n')}

<h2>The Bottom Line</h2>
<p>[80 words. Practical summary. 2 action steps. Only include an internal link here if it has NOT already appeared earlier in the article — never repeat the same link twice.]</p>

<div class="author-bio" style="background:#F0F4FF;border-left:3px solid #1D4ED8;padding:16px 20px;border-radius:0 8px 8px 0;margin-top:24px;">
<p style="margin:0;font-size:13px;color:#0F0F0F;"><strong>About the Author</strong><br><strong>Kamran Gul</strong>${displayBrand !== 'the publisher' ? ` writes for ${displayBrand}${brandDomain ? ` (${brandDomain})` : ''}` : ''}. [2-3 sentences describing Kamran's direct expertise relevant to THIS specific article's topic — be concrete and specific, never invent qualifications or credentials.]</p>
</div>

<div class="expert-review" style="background:#F5F4F1;border-left:3px solid #FF6B2C;padding:16px 20px;border-radius:0 8px 8px 0;margin-top:16px;">
<p style="margin:0;font-size:13px;color:#6B6B6B;"><strong style="color:#0F0F0F;">Editorial note:</strong> This article was researched using official sources. All regulatory claims reflect ${displayMarket} rules as of ${currentMonth} ${currentYear}. Fact-checked: ${currentMonth} ${currentYear}. Always verify with the relevant official ${displayMarket} body before acting.${displayBrand !== 'the publisher' ? ` ${displayBrand} is not a government service.` : ''}</p>
</div>

<p class="article-meta"><em>Last updated: ${currentMonth} ${currentYear}. Always verify regulatory details with the official ${market} sources cited above.</em></p>

DO NOT write any <script type="application/ld+json"> blocks yourself. All
structured data (Article, FAQPage, BreadcrumbList, Organization schema) is
generated separately by code from the article's actual title, meta
description, brand, and FAQ content, and is injected automatically after you
finish writing. Any JSON-LD you write here would be redundant, incomplete,
and hardcoded to the wrong brand — leave it out entirely and end the article
content at the article-meta paragraph above.

════════════════════════════════
SECTION 8 — ABSOLUTE COMPLETION RULE
════════════════════════════════
Token budget per section — DO NOT EXCEED:
- Introduction: ${introWords} words
- Each of ${h2SectionCount} H2 body sections: ${wordsPerH2Section} words
- Official Sources: ${officialSourcesWords} words
- FAQ: ${faqItemCount} × ${faqWordsEach} words = ${faqItemCount * faqWordsEach} words
- Bottom Line: ${bottomLineWords} words
- Author bio: ${authorBioWords} words
- Total target: ${safeWordCount} words maximum — HARD LIMIT; section budgets above sum to ~${computedTotalBudget} words; do not exceed ${safeWordCount} words under any circumstances

IF APPROACHING TOKEN LIMIT AT ANY POINT:
1. Finish the current sentence immediately
2. Close any open HTML tag
3. Jump directly to The Bottom Line
4. Write Bottom Line (80 words)
5. Write author bio div
6. Write expert-review div
7. Write footer metadata
8. STOP

A complete 1,000-word article beats a truncated 2,000-word one every time.
NEVER stop mid-sentence. NEVER stop mid-tag. NEVER omit The Bottom Line.
Do not write JSON-LD schema scripts even when truncating — see SECTION 7:
that markup is generated separately by code, not by you, under any
circumstances.

════════════════════════════════
SECTION 9 — FINAL SELF-REVIEW (MANDATORY)
════════════════════════════════
Before finalizing, re-read your own draft as a skeptical editor who owes you
no kindness. Check specifically for:
- Any meta-commentary or notes-to-self that a reader should never see
- The same link or URL used more than once
- Any specific number, statistic, or named study with no real, checkable
  source
- Any sentence that doesn't parse as a complete grammatical unit on its own
Fix anything you find before returning output.

Write the complete article now. Output HTML only — no commentary, no preamble.`;
}

export async function validateAndCorrect(
  article: string,
  keyword = '',
  market = 'Global',
  liveFacts = '',
): Promise<{ article: string; corrections: string[] }> {
  const corrections: string[] = [];
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().toLocaleString('en-GB', { month: 'long' });
  const isoDate = new Date().toISOString().split('T')[0];

  let corrected = article;

  // FIX 1 — Replace fake author names (HTML + plain text + About the Author)
  const fakeAuthorByLine = /By\s+<strong>(?!Kamran Gul)([A-Z][a-z]+\s+[A-Z][a-z]+)<\/strong>/g;
  const fakeAuthorPlain = /\bBy\s+(?!Kamran Gul)([A-Z][a-z]+\s+[A-Z][a-z]+)(?=\s*[|,]|\s*$)/g;
  const fakeAuthorStrong = /<strong>(?!Kamran Gul|Autodun)([A-Z][a-z]+\s+[A-Z][a-z]+)<\/strong>\s+is\s+(an?\s+)?(automotive|technical|senior|experienced|award|financial)/gi;
  const fakeSchemaAuthor = /"author":\s*\{\s*"@type":\s*"Person",\s*"name":\s*"(?!Kamran Gul)([^"]+)"/g;
  const fakeBylineBlock = /<p[^>]*>\s*<strong>Byline:<\/strong>[\s\S]*?<\/p>/gi;
  const fakeAboutAuthor = /<h2[^>]*>\s*About the Author\s*<\/h2>[\s\S]*?(?=<h2|$)/gi;

  if (fakeBylineBlock.test(corrected)) {
    corrected = corrected.replace(fakeBylineBlock, '');
    corrections.push('Removed invented byline block');
  }
  if (fakeAboutAuthor.test(corrected)) {
    corrected = corrected.replace(
      fakeAboutAuthor,
      '<h2>About the Author</h2>\n<p><strong>Kamran Gul</strong> is the founder of Autodun, an independent vehicle intelligence platform.</p>\n'
    );
    corrections.push('Replaced fake About the Author section with Kamran Gul');
  }
  if (fakeAuthorPlain.test(corrected)) {
    corrected = corrected.replace(fakeAuthorPlain, 'By Kamran Gul');
    corrections.push('Replaced plain-text invented author with Kamran Gul');
  }
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
