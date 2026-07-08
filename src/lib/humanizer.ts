import Anthropic from '@anthropic-ai/sdk';
import { MODEL_FOR } from './model-router';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!, maxRetries: 3 });

export const BANNED_WORDS = [
  'delve', 'leverage', 'harness', 'robust', 'showcasing', 'vibrant', 'pivotal',
  'crucial', 'seamlessly', 'streamline', 'unlock', 'revolutionize', 'game-changer',
  'cutting-edge', 'groundbreaking', 'furthermore', 'moreover',
  'in conclusion', 'it is worth noting', 'it is important to note',
  "in today's fast-paced world", 'at the end of the day', 'moving forward', 'going forward',
];

const TRANSITION_STARTERS = [
  /^furthermore[,\s]/i, /^moreover[,\s]/i, /^in conclusion[,\s]/i,
  /^additionally[,\s]/i, /^consequently[,\s]/i, /^as a result[,\s]/i,
  /^in summary[,\s]/i, /^to summarize[,\s]/i, /^in addition[,\s]/i,
];

export interface HumanizerOptions {
  level: 'light' | 'medium' | 'aggressive';
  primaryKeyword?: string;
}

export interface HumanizerResult {
  humanizedHtml: string;
  humanScore: number;
  passesDetection: boolean;
  experienceScore: number;
  seoPreserved: {
    linksPreserved: boolean;
    keywordInFirstParagraph: boolean;
    statsPreserved: boolean;
    schemaPreserved: boolean;
  };
  bannedWordsRemoved: string[];
}

function preProcess(html: string): { html: string; bannedWordsFound: string[] } {
  let result = html;
  const bannedWordsFound: string[] = [];

  // Em dash → comma in flowing text
  result = result.replace(/ — /g, ', ');

  // Introduce contractions (sounds more human)
  result = result
    .replace(/\bdo not\b/g, "don't")
    .replace(/\bcannot\b/g, "can't")
    .replace(/\bdoes not\b/g, "doesn't")
    .replace(/\bthey are\b/g, "they're")
    .replace(/\byou are\b/g, "you're")
    .replace(/\bwe are\b/g, "we're");

  const textLower = html.toLowerCase();
  for (const word of BANNED_WORDS) {
    if (textLower.includes(word.toLowerCase())) {
      bannedWordsFound.push(word);
    }
  }

  return { html: result, bannedWordsFound };
}

function extractSeoSignals(html: string, keyword: string) {
  const linkMatches = Array.from(html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi));
  const links = linkMatches.map(m => ({ href: m[1], text: m[2].replace(/<[^>]+>/g, '').trim() }));

  const schemaMatches = Array.from(html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi));
  const schemas = schemaMatches.map(m => m[0]);

  const text = html.replace(/<[^>]+>/g, ' ');
  const stats = text.match(/\d+%|\$\d[\d,]*|£\d[\d,]*|\b\d{4}\b|\d+,\d{3}/g) || [];

  const firstParaMatch = html.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
  const firstParaText = firstParaMatch ? firstParaMatch[1].replace(/<[^>]+>/g, '').toLowerCase() : '';
  const keywordInFirstPara = keyword ? firstParaText.includes(keyword.toLowerCase()) : false;

  return { links, schemas, stats, keywordInFirstPara };
}

export function calculateHumanScore(html: string): number {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  let score = 20; // base score

  // Penalties
  const textLower = text.toLowerCase();
  let bannedCount = 0;
  for (const word of BANNED_WORDS) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'gi');
    const matches = textLower.match(regex);
    if (matches) bannedCount += matches.length;
  }
  score -= Math.min(bannedCount * 5, 30);

  const sentences = text.match(/[^.!?]+[.!?]+/g) || [];
  let transitionCount = 0;
  for (const sentence of sentences) {
    if (TRANSITION_STARTERS.some(r => r.test(sentence.trim()))) transitionCount++;
  }
  score -= Math.min(transitionCount * 5, 20);

  // Bonuses
  const words = text.split(/\s+/).filter(Boolean);
  const avgSentLen = sentences.length > 0 ? words.length / sentences.length : 0;
  if (avgSentLen >= 13 && avgSentLen <= 18) score += 20;

  const uniqueWords = new Set(words.map(w => w.toLowerCase())).size;
  const uniqueRatio = words.length > 0 ? uniqueWords / words.length : 0;
  if (uniqueRatio > 0.55) score += 20;

  if (/\b(I|we|our|my|us)\b/.test(text)) score += 15;
  if (/\d+%|\$\d|£\d|\b[1-9]\d{1,2}\b/.test(text)) score += 15;
  if (!html.includes(' — ') && !html.includes('—')) score += 10;

  return Math.max(0, Math.min(100, score));
}

const EXPERIENCE_MARKERS = [
  /\bI tested\b/i,
  /\bI tried\b/i,
  /\bI used\b/i,
  /\bI found\b/i,
  /\bI installed\b/i,
  /\bI reviewed\b/i,
  /\bI discovered\b/i,
  /\bwhen I\b/i,
  /\bwe tested\b/i,
  /\bwe found\b/i,
  /\bwe tried\b/i,
  /\bin my experience\b/i,
  /\bwhat surprised me\b/i,
  /\bwhat I.d do differently\b/i,
  /\bthe reality is\b/i,
];

function detectExperienceScore(html: string): number {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const matched = EXPERIENCE_MARKERS.filter(m => m.test(text)).length;
  if (matched === 0) return 0;
  if (matched === 1) return 35;
  if (matched === 2) return 60;
  if (matched === 3) return 78;
  return Math.min(95, 60 + matched * 8);
}

export async function humanizeArticle(html: string, options: HumanizerOptions): Promise<HumanizerResult> {
  const { level, primaryKeyword = '' } = options;

  const { html: preprocessed, bannedWordsFound } = preProcess(html);
  const seoSignals = extractSeoSignals(preprocessed, primaryKeyword);

  // Light mode: skip Claude if already passing
  const preLightScore = calculateHumanScore(preprocessed);
  if (level === 'light' && preLightScore >= 72 && bannedWordsFound.length === 0) {
    return {
      humanizedHtml: preprocessed,
      humanScore: preLightScore,
      passesDetection: preLightScore >= 72,
      experienceScore: detectExperienceScore(preprocessed),
      seoPreserved: {
        linksPreserved: true,
        keywordInFirstParagraph: seoSignals.keywordInFirstPara,
        statsPreserved: true,
        schemaPreserved: seoSignals.schemas.length > 0,
      },
      bannedWordsRemoved: bannedWordsFound,
    };
  }

  const model = level === 'light' ? MODEL_FOR.bannedWordDetection : MODEL_FOR.humanizationRewrite;
  const intensity = level === 'aggressive' ? 'Aggressively' : level === 'medium' ? 'Moderately' : 'Lightly';

  const systemPrompt = `You are an expert human writing editor. Your job is to make AI-generated HTML articles sound like they were written by a real human expert journalist.

RULES (follow all strictly):
1. NEVER use these words or phrases: delve, leverage, harness, robust, showcasing, vibrant, pivotal, crucial, seamlessly, streamline, unlock, revolutionize, game-changer, cutting-edge, groundbreaking, furthermore, moreover, "in conclusion", "it is worth noting", "it is important to note", "at the end of the day", "moving forward", "going forward"
2. Use natural sentence variety — mix short punchy sentences (5-8 words) with longer detailed ones (20-25 words)
3. Add occasional first-person voice (we, our) where it fits the context naturally
4. Replace em dashes (—) with commas or rephrase
5. Start paragraphs with strong topic sentences, not transition words
6. Keep ALL HTML tags, links (<a href>), headings (h1/h2/h3), schema scripts, and attributes EXACTLY as they are
7. Do NOT change any URL, anchor text, or content inside <a> tags
8. Do NOT change any <script> blocks — schema markup must survive unchanged
9. Do NOT add or remove sections — only rewrite text within <p> tags
10. Output ONLY the rewritten HTML — no explanations, no markdown fences`;

  const userPrompt = `${intensity} rewrite the prose in this HTML article to sound like a human expert wrote it. Follow all 10 rules.
${primaryKeyword ? `Target keyword (must appear in first paragraph): "${primaryKeyword}"` : ''}
${seoSignals.links.length > 0 ? `Preserve these links: ${seoSignals.links.slice(0, 5).map(l => l.href).join(', ')}` : ''}

HTML:
${preprocessed}`;

  let humanizedHtml = preprocessed;
  try {
    const response = await anthropic.messages.create({
      model,
      max_tokens: 8000,
      system: [{ type: 'text' as const, text: systemPrompt, cache_control: { type: 'ephemeral' as const } }],
      messages: [{ role: 'user', content: userPrompt }],
    });
    const responseText = response.content[0].type === 'text' ? response.content[0].text.trim() : '';
    if (responseText.length > preprocessed.length * 0.4) {
      humanizedHtml = responseText.replace(/^```html?\n?/i, '').replace(/```\s*$/, '').trim();
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cacheHit = ((response.usage as any).cache_read_input_tokens ?? 0) > 0;
    console.log(`[model-router] task=humanizationRewrite model=${model} inputTokens=${response.usage.input_tokens} cacheHit=${cacheHit}`);
  } catch (err) {
    console.warn('[humanizer] Claude rewrite failed, using pre-processed HTML:', err);
  }

  // Re-inject any schemas that got dropped
  const postSignals = extractSeoSignals(humanizedHtml, primaryKeyword);
  if (seoSignals.schemas.length > 0 && postSignals.schemas.length < seoSignals.schemas.length) {
    for (const schema of seoSignals.schemas) {
      const schemaId = schema.slice(30, 80);
      if (!humanizedHtml.includes(schemaId)) {
        humanizedHtml += '\n' + schema;
      }
    }
  }

  const finalSignals = extractSeoSignals(humanizedHtml, primaryKeyword);
  const linksPreserved = seoSignals.links.every(l => humanizedHtml.includes(l.href));
  const statsPreserved = seoSignals.stats.length === 0 || seoSignals.stats.some(s => humanizedHtml.includes(s));
  const schemaPreserved = finalSignals.schemas.length >= seoSignals.schemas.length || seoSignals.schemas.length === 0;

  const humanScore = calculateHumanScore(humanizedHtml);

  return {
    humanizedHtml,
    humanScore,
    passesDetection: humanScore >= 72,
    experienceScore: detectExperienceScore(humanizedHtml),
    seoPreserved: {
      linksPreserved,
      keywordInFirstParagraph: finalSignals.keywordInFirstPara,
      statsPreserved,
      schemaPreserved,
    },
    bannedWordsRemoved: bannedWordsFound,
  };
}
