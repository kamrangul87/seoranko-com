import Anthropic from '@anthropic-ai/sdk';

// maxRetries lets the SDK auto-retry 429s using the server's Retry-After header.
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!, maxRetries: 5 });

// Auxiliary JSON/extraction calls run on Haiku — a SEPARATE rate-limit bucket
// from Sonnet — so they don't eat the Sonnet input-token budget the main
// article generation needs. Quality-critical writing stays on Sonnet.
const FAST_MODEL = 'claude-haiku-4-5-20251001';

export async function getTopCompetitorUrls(keyword: string, market: string): Promise<string[]> {
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

export async function fetchCompetitorContent(url: string): Promise<string> {
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

export interface CompetitorNLP {
  commonTopics: string[];
  contentGaps: string[];
  weaknesses: string[];
  entities: string[];
}

export async function extractCompetitorNLP(competitorTexts: string[], keyword: string): Promise<CompetitorNLP> {
  const combined = competitorTexts
    .map((t, i) => `COMPETITOR ${i + 1}:\n${t}`)
    .join('\n\n---\n\n');

  const response = await anthropic.messages.create({
    model: FAST_MODEL,
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

export interface UniqueAngle {
  hook: string;
  uniqueSection: string;
  uniqueContent: string;
}

export async function generateUniqueAngle(
  keyword: string,
  gaps: string[],
  weaknesses: string[],
): Promise<UniqueAngle> {
  const response = await anthropic.messages.create({
    model: FAST_MODEL,
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
