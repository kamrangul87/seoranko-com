import { MODEL_FOR } from '@/lib/model-router';
import { getAnthropicClient } from '@/lib/anthropic'
import { LOCATION_CODES } from '@/lib/rank-tracker';

// maxRetries lets the SDK auto-retry 429s using the server's Retry-After header.
const anthropic = getAnthropicClient({ maxRetries: 5 });

export async function getTopCompetitorUrls(keyword: string, market: string): Promise<string[]> {
  // Was a 4-country ternary falling through to 2826 (UK) for everything
  // else — uses the canonical LOCATION_CODES map instead.
  const marketKey = market.trim().toLowerCase();
  const locationCode =
    LOCATION_CODES[marketKey]?.code ??
    Object.values(LOCATION_CODES).find(v => v.name.toLowerCase() === marketKey)?.code ??
    LOCATION_CODES.global.code;

  try {
    const response = await fetch('https://api.dataforseo.com/v3/serp/google/organic/live/advanced', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(
          `${process.env.DATAFORSEO_EMAIL}:${process.env.DATAFORSEO_PASSWORD}`
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
    model: MODEL_FOR.nlpExtraction,
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
    model: MODEL_FOR.nlpExtraction,
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
