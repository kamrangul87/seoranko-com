import sharp from 'sharp';
import { randomUUID } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import { parse, HTMLElement } from 'node-html-parser';
import { MODEL_FOR } from '@/lib/model-router';
import {
  buildStockSearchQuery,
  stockRelevanceScore,
  isAcceptableStockPhoto,
  isEvChargingTopic,
} from '@/lib/stock-image-relevance';

// ── Blog-standard size presets ────────────────────────────────────────────────

export const BLOG_SIZES = {
  hero:      { width: 1200, height: 630 },
  content:   { width: 800,  height: 533 },
  thumbnail: { width: 400,  height: 400 },
  mobile:    { width: 600,  height: 315 },
} as const;

export type BlogSizeKey = keyof typeof BLOG_SIZES;
export type ImageTier = 'free' | 'premium';

export type ArticleNiche =
  | 'automotive' | 'health' | 'finance' | 'technology' | 'food'
  | 'travel' | 'business' | 'lifestyle' | 'education' | 'other';

// Niche-specific visual language — appended to every prompt for consistent style
const NICHE_VISUAL: Record<ArticleNiche, string> = {
  automotive:  'professional automotive photography, dealership lighting, clean composition, shallow depth of field',
  health:      'clinical photography, soft natural light, professional medical setting, clean neutral background',
  finance:     'modern office photography, professional business setting, clean minimal aesthetic, natural window light',
  technology:  'modern tech photography, clean studio lighting, product focus, dark or pure white background',
  food:        'food photography, natural side lighting, appetizing composition, shallow depth of field',
  travel:      'travel photography, golden hour natural light, wide angle landscape, vibrant colours',
  business:    'professional corporate photography, bright office environment, natural light, confident subjects',
  lifestyle:   'lifestyle photography, candid warm natural light, authentic moments, editorial feel',
  education:   'academic photography, bright natural light, clean classroom or study setting, focused subjects',
  other:       'professional editorial photography, natural lighting, clean composition, sharp focus',
};

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GeneratedImage {
  id: string;
  url: string;
  width: number;
  height: number;
  alt: string;
  caption: string;
  placement: string;
  prompt: string;
}

export interface ImageStats {
  requested: number;
  generated: number;
  failures: string[];
}

export interface ArticleImageSet {
  hero: GeneratedImage;
  content: GeneratedImage[];
  mobile?: GeneratedImage;
  niche: ArticleNiche;
  styleDescriptor: string;
  imageStats: ImageStats;
}

export interface ImageFailure {
  failed: true;
  reason: string;
}

// ── Supabase client (server-side only) ───────────────────────────────────────

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );
}

// ── Cost / usage logging ──────────────────────────────────────────────────────

async function logGeneration(entry: {
  tier: ImageTier;
  provider?: string;
  niche: ArticleNiche;
  success: boolean;
  duration_ms: number;
  keyword?: string;
  size_key?: string;
  storage_path?: string;
  error_reason?: string;
}): Promise<void> {
  try {
    await getSupabase().from('image_generation_logs').insert(entry);
  } catch {
    // Non-critical — never block image generation on logging failure
  }
}

// ── Niche detection + shared style descriptor ─────────────────────────────────
// One Haiku call per article; result appended to all prompts for visual consistency

export async function detectNicheAndStyle(
  keyword: string,
  topic: string,
): Promise<{ niche: ArticleNiche; styleDescriptor: string }> {
  // EV / vehicle charging must not be classified as "technology" — that niche
  // visual language biases stock search toward phones/gadgets ("charger").
  if (isEvChargingTopic(keyword, topic)) {
    return {
      niche: 'automotive',
      styleDescriptor: 'electric vehicle charging photography, outdoor driveway or public charge point, natural light',
    }
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

  const res = await anthropic.messages.create({
    model: MODEL_FOR.imagePromptGeneration,
    max_tokens: 120,
    messages: [{
      role: 'user',
      content: `Classify the niche of this article and generate a short visual style descriptor for consistent AI image generation across all images in the article.

Topic: "${keyword}". Context: ${topic.slice(0, 200)}

Valid niches: automotive, health, finance, technology, food, travel, business, lifestyle, education, other
Important: EV chargers, electric vehicles, wallboxes, and charge points are automotive — never technology.

Return ONLY valid JSON, no markdown:
{"niche":"<niche>","styleDescriptor":"<12–18 word consistent visual style, e.g. warm natural lighting, shallow depth of field, editorial style>"}`,
    }],
  });

  const text = res.content[0].type === 'text' ? res.content[0].text : '{}';
  try {
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    let niche = (parsed.niche as ArticleNiche) in NICHE_VISUAL
      ? (parsed.niche as ArticleNiche)
      : 'other';
    if (isEvChargingTopic(keyword, topic)) niche = 'automotive'
    const styleDescriptor =
      typeof parsed.styleDescriptor === 'string' && parsed.styleDescriptor.trim()
        ? parsed.styleDescriptor.trim()
        : 'professional editorial photography, natural lighting';
    return { niche, styleDescriptor };
  } catch {
    return { niche: 'other', styleDescriptor: 'professional editorial photography, natural lighting' };
  }
}

// ── Niche-aware prompt builder ────────────────────────────────────────────────

async function buildImagePrompts(
  keyword: string,
  topic: string,
  count: number,
  niche: ArticleNiche,
  styleDescriptor: string,
): Promise<{ placement: string; prompt: string; alt: string; caption: string }[]> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const nicheStyle = NICHE_VISUAL[niche];
  const fullStyle = `${nicheStyle}, ${styleDescriptor}`;

  const res = await anthropic.messages.create({
    model: MODEL_FOR.imagePromptGeneration,
    // 2000 tokens prevents truncation for 4-5 prompts (~150 tokens each + JSON overhead was
    // cutting off the JSON array at 800, causing parse failure and hero-only fallback)
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: `Generate exactly ${count} image prompts for a blog article about "${keyword}".

Niche: ${niche}. Topic context: ${topic.slice(0, 200)}

Mandatory visual style — append exactly to EVERY prompt: "${fullStyle}"

Return ONLY valid JSON array with exactly ${count} items, no markdown:
[
  {
    "placement": "hero",
    "prompt": "<specific subject for this image>, ${fullStyle}, no text, no logos, no watermarks",
    "alt": "<SEO alt text under 125 chars>",
    "caption": "<concise caption for the article>"
  }
]

Rules:
- First item must have placement "hero", remaining ${count - 1} items have placement "content"
- Each prompt must describe a distinct scene/angle (no repetition)
- The mandatory visual style must appear verbatim at the end of each prompt
- Subject MUST literally depict "${keyword}" — the real-world thing a reader expects for this keyword
${isEvChargingTopic(keyword, topic)
  ? `- CRITICAL for EV/charging topics: show electric vehicles, wallbox home chargers, public charge points, or charging cables plugged into cars. NEVER show phones, tablets, earbuds, AirPods, USB cables, or consumer gadget chargers — stock libraries confuse "charger" with phone accessories.`
  : `- Do not substitute a lookalike subject (e.g. phone chargers for EV chargers, generic offices for a specific industry)`}
- No markdown, no explanation`,
    }],
  });

  const text = res.content[0].type === 'text' ? res.content[0].text : '[]';
  try {
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('empty');
    // Pad to requested count if Haiku returned fewer (truncation recovery)
    while (parsed.length < count) {
      const i = parsed.length;
      parsed.push({
        placement: 'content',
        prompt: `${keyword}, additional scene ${i}, ${fullStyle}, no text`,
        alt: `${keyword} image ${i + 1}`,
        caption: keyword,
      });
    }
    return parsed as { placement: string; prompt: string; alt: string; caption: string }[];
  } catch {
    // Full fallback: build count prompts manually
    return Array.from({ length: count }, (_, i) => ({
      placement: i === 0 ? 'hero' : 'content',
      prompt: `${keyword}, ${fullStyle}, no text`,
      alt: `${keyword} ${i === 0 ? 'featured image' : `image ${i + 1}`}`,
      caption: keyword,
    }));
  }
}

// ── Low-level fetchers ────────────────────────────────────────────────────────

// Deliberately specific phrases, not bare words like "content" or "policy" —
// those substring-match unrelated errors. Case in point: Gemini's quota
// error body repeats "generate_content_free_tier_requests" many times,
// which matched a bare "content" and made a 429 RESOURCE_EXHAUSTED get
// misclassified as a safety block (bug found 2026-08-05). Quota/rate-limit
// signals are excluded explicitly so this can't happen again even if a
// future error message happens to contain one of these phrases too.
const SAFETY_SIGNALS = ['safety filter', 'content policy', 'nsfw', 'prohibited content', 'blocked by', 'content violation', 'moderation'];
const NON_SAFETY_OVERRIDE = ['resource_exhausted', 'quota', 'rate limit', 'rate_limit', '429'];

function isSafetyError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  if (msg.startsWith('safety_blocked:')) return true;
  if (NON_SAFETY_OVERRIDE.some(k => msg.includes(k))) return false;
  return SAFETY_SIGNALS.some(k => msg.includes(k));
}

// TIER 0 — Gemini 2.5 Flash Image (Google AI Studio, free tier: daily rate
// limits, no per-image cost). Note: the deployment doc that requested this
// named "Gemini 2.0 Flash" via the `@google/generative-ai` package — that
// package is legacy and 2.0 Flash's image mode was an experimental preview.
// Verified current (Aug 2026): `@google/genai` + model `gemini-2.5-flash-image`
// is the production-GA free-tier successor; used here instead.
// Width/height aren't passed to Gemini — the existing pipeline already
// resizes/crops every provider's output to the target size via sharp below.
// Strips brand names / dramatic wording that trip Gemini's (stricter than
// Flux's) safety filter, and drops down to the core subject clause only.
function softenPromptForSafety(prompt: string): string {
  return prompt
    .replace(/\bTesla\b/gi, 'electric vehicle')
    .replace(/\b(crisis|emergency|danger(ous)?|risk|threat)\b/gi, 'situation')
    .replace(/\bgrid\b/gi, 'power network')
    .split(',').slice(0, 2).join(',')
    .trim();
}

export async function generateImageGemini(prompt: string, isRetry = false): Promise<Buffer> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured');

  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-image',
    contents: prompt,
  });

  // Structured safety signals — check these directly rather than sniffing
  // error message text, which is how a quota error got misclassified as a
  // safety block before (see isSafetyError above).
  const blockReason = response.promptFeedback?.blockReason;
  const finishReason = response.candidates?.[0]?.finishReason;
  const wasBlocked = !!blockReason || finishReason === 'SAFETY';

  if (wasBlocked && !isRetry) {
    console.warn(`[image-generator] Gemini safety-blocked (${blockReason || finishReason}), retrying with softened prompt`);
    return generateImageGemini(softenPromptForSafety(prompt), true);
  }
  if (wasBlocked) {
    throw new Error(`SAFETY_BLOCKED: Gemini blocked this prompt twice (${blockReason || finishReason})`);
  }

  const parts = response.candidates?.[0]?.content?.parts || [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const imagePart = parts.find((p: any) => p.inlineData?.data);
  if (!imagePart?.inlineData?.data) {
    throw new Error('Gemini returned no image data (unrecognised response shape)');
  }

  return Buffer.from(imagePart.inlineData.data, 'base64');
}

// TIER — Pexels stock photo fallback (free, no attribution required for
// commercial use). Returns raw bytes like the other providers so it flows
// through the same resize/upload/storage pipeline below, rather than
// depending on Pexels' own CDN staying up forever.
interface StockPhotoResult { buffer: Buffer; altText: string }

async function fetchPexelsPhoto(
  prompt: string,
  width: number,
  height: number,
  keyword = '',
): Promise<StockPhotoResult> {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) throw new Error('PEXELS_API_KEY not configured');

  const searchQuery = buildStockSearchQuery(keyword || prompt, prompt);
  console.log(`[image-generator] Pexels search query: "${searchQuery}" (from prompt: "${prompt.slice(0, 80)}...")`);
  const res = await fetch(
    `https://api.pexels.com/v1/search?query=${encodeURIComponent(searchQuery)}&per_page=8&orientation=${width > height ? 'landscape' : 'square'}`,
    { headers: { Authorization: apiKey }, signal: AbortSignal.timeout(10_000) }
  );
  if (!res.ok) throw new Error(`Pexels search failed: ${res.status}`);

  const data = await res.json();
  const photos: Array<{ alt?: string; src?: { large2x?: string; large?: string } }> = data.photos || [];
  const ranked = photos
    .map(photo => ({
      photo,
      alt: photo?.alt || searchQuery,
      score: stockRelevanceScore(photo?.alt || '', keyword, prompt),
    }))
    .filter(p => isAcceptableStockPhoto(p.alt, keyword, prompt))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  if (!best) throw new Error(`Pexels found no on-topic photo for "${searchQuery}"`);

  const imageUrl = best.photo?.src?.large2x || best.photo?.src?.large;
  if (!imageUrl) throw new Error(`Pexels found no photo for "${searchQuery}"`);

  const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(15_000) });
  if (!imgRes.ok) throw new Error(`Pexels image fetch failed: ${imgRes.status}`);
  return { buffer: Buffer.from(await imgRes.arrayBuffer()), altText: best.alt };
}

export async function generateImagePexels(prompt: string, width: number, height: number): Promise<Buffer> {
  return (await fetchPexelsPhoto(prompt, width, height)).buffer;
}

// TIER — Unsplash, the second independent real-photo database. Queried in
// parallel with Pexels (see queryStockParallel below) so a topic having zero
// results on one stock source doesn't sink the whole slot — a plain database
// lookup against millions of pre-approved photos carries essentially none of
// the failure risk generation does (no safety filters, no quota, no timeout
// risk beyond a slow network). Free tier: 50 requests/hour, no credit card —
// worth watching if generation volume grows, since that's a tighter budget
// than Pexels' (200/hour). Skipped automatically if the key isn't set.
async function fetchUnsplashPhoto(
  prompt: string,
  width: number,
  height: number,
  keyword = '',
): Promise<StockPhotoResult> {
  const accessKey = process.env.UNSPLASH_ACCESS_KEY;
  if (!accessKey) throw new Error('UNSPLASH_ACCESS_KEY not configured');

  const searchQuery = buildStockSearchQuery(keyword || prompt, prompt);
  console.log(`[image-generator] Unsplash search query: "${searchQuery}"`);
  const res = await fetch(
    `https://api.unsplash.com/search/photos?query=${encodeURIComponent(searchQuery)}&per_page=8&orientation=${width > height ? 'landscape' : 'squarish'}`,
    { headers: { Authorization: `Client-ID ${accessKey}` }, signal: AbortSignal.timeout(10_000) }
  );
  if (!res.ok) throw new Error(`Unsplash search failed: ${res.status}`);

  const data = await res.json();
  const photos: Array<{ alt_description?: string; description?: string; urls?: { regular?: string } }> = data.results || [];
  const ranked = photos
    .map(photo => {
      const alt = photo?.alt_description || photo?.description || searchQuery;
      return {
        photo,
        alt,
        score: stockRelevanceScore(alt, keyword, prompt),
      };
    })
    .filter(p => isAcceptableStockPhoto(p.alt, keyword, prompt))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  if (!best) throw new Error(`Unsplash found no on-topic photo for "${searchQuery}"`);

  const imageUrl = best.photo?.urls?.regular;
  if (!imageUrl) throw new Error(`Unsplash found no photo for "${searchQuery}"`);

  const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(15_000) });
  if (!imgRes.ok) throw new Error(`Unsplash image fetch failed: ${imgRes.status}`);
  return { buffer: Buffer.from(await imgRes.arrayBuffer()), altText: best.alt };
}

export async function generateImageUnsplash(prompt: string, width: number, height: number): Promise<Buffer> {
  return (await fetchUnsplashPhoto(prompt, width, height)).buffer;
}

export async function generateImagePollinations(
  prompt: string,
  width: number,
  height: number,
): Promise<Buffer> {
  const url =
    `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}` +
    `?width=${width}&height=${height}&nologo=true&model=flux`;

  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    if (res.status === 400 || res.status === 422 || res.status === 451) {
      throw new Error(`content_policy: Pollinations blocked this prompt (HTTP ${res.status})`);
    }
    throw new Error(`Pollinations fetch failed: ${res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

export async function generateImageReplicate(
  prompt: string,
  width: number,
  height: number,
): Promise<Buffer> {
  const apiToken = process.env.REPLICATE_API_TOKEN;
  if (!apiToken) throw new Error('REPLICATE_API_TOKEN not configured');

  const { default: Replicate } = await import('replicate');
  const replicate = new Replicate({ auth: apiToken });

  const output = await replicate.run('black-forest-labs/flux-schnell', {
    input: {
      prompt,
      width:  Math.round(width  / 8) * 8,
      height: Math.round(height / 8) * 8,
      num_outputs: 1,
      output_format: 'webp',
    },
  });

  const outputArr = Array.isArray(output) ? output : [output];
  const first = outputArr[0] as { blob: () => Promise<Blob>; url: () => URL };

  if (typeof first === 'string') {
    const r = await fetch(first, { signal: AbortSignal.timeout(15_000) });
    return Buffer.from(await r.arrayBuffer());
  } else if (typeof first.blob === 'function') {
    const blob = await first.blob();
    return Buffer.from(await blob.arrayBuffer());
  } else {
    const r = await fetch(first.url().toString(), { signal: AbortSignal.timeout(15_000) });
    return Buffer.from(await r.arrayBuffer());
  }
}

// ── Stock-first provider strategy ───────────────────────────────────────────
// Real-photo stock search (Pexels + Unsplash) is the PRIMARY path for every
// image: a database lookup against millions of pre-approved photos carries
// none of generation's failure modes (safety filters, quota, rate limits).
// Gemini is an OPTIONAL, non-blocking enhancement tried only for the hero
// image, racing in parallel against stock with a short timeout — if it wins
// within budget and isn't safety-blocked it's preferred for the hero only;
// any Gemini failure just means the stock result (already in flight) is
// used. Content images never touch generation at all. pollinations.ai
// (zero-config, no key needed) and Replicate (paid, opt-in) remain as a
// sequential last-resort tail if both stock sources come up empty.
//
// This replaced an earlier "Gemini-first, stock-fallback" design after
// production logs showed Gemini's free-tier quota was exhausted (limit: 0)
// on every single call for this account — meaning 3 of 4 images per article
// were paying Gemini's latency only to fail every time before ever reaching
// Pexels.

interface ImageProvider {
  name: string;
  tier: ImageTier;
  available: boolean;
  fn: (prompt: string, width: number, height: number) => Promise<Buffer>;
}

// Rough relevance signal: does the stock photo's own alt/description text
// share real subject words with what the image is actually meant to show?
// A caption about "DC fast charger display screen" pairing with an
// unrelated phone/cable product shot is rejected via stock-image-relevance.
interface ProviderAttempt {
  buffer: Buffer;
  provider: string;
}

// PRIMARY: Pexels + Unsplash queried concurrently (only the ones with a key
// configured). When both return a result, the one whose alt text actually
// shares subject words with the intended prompt/keyword wins — not just
// "Pexels always wins if present". Either succeeding alone is still enough.
async function queryStockParallel(
  prompt: string,
  width: number,
  height: number,
  niche: ArticleNiche,
  sizeKey: BlogSizeKey,
  keyword: string,
): Promise<ProviderAttempt | null> {
  // Confirmed from production logs: Pexels times out ("operation was
  // aborted due to timeout") on some requests with no retry — a single
  // transient network blip was killing that slot outright. Retry once,
  // but only for timeout-flavored errors; retrying "no photo found" or a
  // missing API key wouldn't fix anything and just wastes the time budget.
  function isTimeoutError(err: unknown): boolean {
    if (err instanceof Error) {
      return err.name === 'TimeoutError' || /timeout|aborted/i.test(err.message);
    }
    return false;
  }

  async function attempt(name: string, fn: () => Promise<StockPhotoResult>): Promise<(ProviderAttempt & { relevance: number }) | null> {
    const t0 = Date.now();
    try {
      const { buffer, altText } = await fn();
      void logGeneration({ tier: 'free', provider: name, niche, success: true, duration_ms: Date.now() - t0, keyword, size_key: sizeKey });
      return { buffer, provider: name, relevance: stockRelevanceScore(altText, keyword, prompt) };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      void logGeneration({ tier: 'free', provider: name, niche, success: false, duration_ms: Date.now() - t0, keyword, size_key: sizeKey, error_reason: reason });

      if (isTimeoutError(err)) {
        console.warn(`[image-generator] ${name} timed out, retrying once:`, reason);
        const t1 = Date.now();
        try {
          const { buffer, altText } = await fn();
          void logGeneration({ tier: 'free', provider: name, niche, success: true, duration_ms: Date.now() - t1, keyword, size_key: sizeKey });
          return { buffer, provider: name, relevance: stockRelevanceScore(altText, keyword, prompt) };
        } catch (retryErr) {
          const retryReason = retryErr instanceof Error ? retryErr.message : String(retryErr);
          void logGeneration({ tier: 'free', provider: name, niche, success: false, duration_ms: Date.now() - t1, keyword, size_key: sizeKey, error_reason: retryReason });
          console.warn(`[image-generator] ${name} retry also failed:`, retryReason);
          return null;
        }
      }

      console.warn(`[image-generator] ${name} failed:`, reason);
      return null;
    }
  }

  const jobs: Promise<(ProviderAttempt & { relevance: number }) | null>[] = [];
  if (process.env.PEXELS_API_KEY) {
    jobs.push(attempt('pexels', () => fetchPexelsPhoto(prompt, width, height, keyword)));
  }
  if (process.env.UNSPLASH_ACCESS_KEY) {
    jobs.push(attempt('unsplash', () => fetchUnsplashPhoto(prompt, width, height, keyword)));
  }
  if (jobs.length === 0) return null;

  const results = (await Promise.all(jobs)).filter((r): r is ProviderAttempt & { relevance: number } => r !== null);
  if (results.length === 0) return null;

  // Prefer on-topic matches. Never ship a negatively scored photo (e.g. iPhone
  // cable for "ev charger") — fall through to generation tail instead.
  const acceptable = results.filter(r => r.relevance >= 0)
  if (acceptable.length === 0) {
    console.warn(`[image-generator] all stock results off-topic for "${keyword}" — trying generation tail`)
    return null
  }
  acceptable.sort((a, b) => b.relevance - a.relevance);
  if (acceptable.length > 1) {
    console.log(`[image-generator] stock relevance: ${acceptable.map(r => `${r.provider}=${r.relevance}`).join(', ')} — picked ${acceptable[0].provider}`);
  }
  return { buffer: acceptable[0].buffer, provider: acceptable[0].provider };
}

const GEMINI_HERO_TIMEOUT_MS = 12_000;

// ENHANCEMENT (hero only, non-blocking): races against the timeout, not
// against stock — stock is already running concurrently in the caller, so
// Gemini succeeding or failing here never adds latency beyond its own budget.
async function tryGeminiForHero(
  prompt: string,
  niche: ArticleNiche,
  keyword: string,
): Promise<ProviderAttempt | null> {
  if (!process.env.GEMINI_API_KEY) return null;
  const t0 = Date.now();
  try {
    const buffer = await Promise.race([
      generateImageGemini(prompt),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Gemini hero enhancement timed out')), GEMINI_HERO_TIMEOUT_MS)),
    ]);
    void logGeneration({ tier: 'free', provider: 'gemini', niche, success: true, duration_ms: Date.now() - t0, keyword, size_key: 'hero' });
    return { buffer, provider: 'gemini' };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    void logGeneration({ tier: 'free', provider: 'gemini', niche, success: false, duration_ms: Date.now() - t0, keyword, size_key: 'hero', error_reason: reason });
    console.warn('[image-generator] Gemini hero enhancement failed, stock result wins:', reason);
    return null;
  }
}

async function generateWithRetryAndFallback(
  prompt: string,
  width: number,
  height: number,
  tier: ImageTier,
  niche: ArticleNiche,
  sizeKey: BlogSizeKey,
  keyword: string,
): Promise<{ buffer: Buffer; tierUsed: ImageTier; providerUsed: string } | ImageFailure> {
  const isHero = sizeKey === 'hero';

  const stockPromise = queryStockParallel(prompt, width, height, niche, sizeKey, keyword);
  const winner = isHero
    ? await Promise.all([stockPromise, tryGeminiForHero(prompt, niche, keyword)]).then(([stock, gemini]) => gemini || stock)
    : await stockPromise;

  if (winner) {
    return { buffer: winner.buffer, tierUsed: 'free', providerUsed: winner.provider };
  }

  // FALLBACK TAIL — both stock sources (and Gemini, for hero) came up empty.
  // Tried sequentially since these are genuinely last-resort, not primary.
  const tailChain: ImageProvider[] = [
    { name: 'pollinations', tier: 'free', available: true, fn: generateImagePollinations },
  ];
  if (tier === 'premium') {
    tailChain.push({ name: 'replicate', tier: 'premium', available: !!process.env.REPLICATE_API_TOKEN, fn: generateImageReplicate });
  }

  let lastReason = `Pexels, Unsplash${isHero ? ', and Gemini' : ''} all failed or returned no results`;
  let lastWasSafetyBlock = false;

  for (const provider of tailChain.filter(p => p.available)) {
    const t0 = Date.now();
    try {
      const buffer = await provider.fn(prompt, width, height);
      void logGeneration({ tier: provider.tier, provider: provider.name, niche, success: true, duration_ms: Date.now() - t0, keyword, size_key: sizeKey });
      return { buffer, tierUsed: provider.tier, providerUsed: provider.name };
    } catch (err) {
      const duration_ms = Date.now() - t0;
      const reason = err instanceof Error ? err.message : String(err);
      lastReason = reason;
      lastWasSafetyBlock = isSafetyError(err);
      void logGeneration({ tier: provider.tier, provider: provider.name, niche, success: false, duration_ms, keyword, size_key: sizeKey, error_reason: reason });
      console.warn(`[image-generator] ${provider.name} failed, trying next provider:`, reason);
    }
  }

  if (lastWasSafetyBlock) {
    return {
      failed: true,
      reason: 'Image generation was blocked by content safety filters on every available provider — try rephrasing your topic',
    };
  }
  return { failed: true, reason: `All image providers failed: ${lastReason}` };
}

// ── Resize + WebP optimise via sharp ─────────────────────────────────────────

export async function resizeAndOptimize(
  buffer: Buffer,
  sizeKey: BlogSizeKey,
  quality = 85,
): Promise<Buffer> {
  const { width, height } = BLOG_SIZES[sizeKey];
  return sharp(buffer)
    .resize(width, height, { fit: 'cover', position: 'centre' })
    .webp({ quality })
    .toBuffer();
}

// ── Storage path: article-images/{YYYY-MM}/{siteId}/{slug}-{instanceId}/{size}.webp
//
// The slug alone used to be the whole folder key, with no per-article
// uniqueness at all — every article generated for the same (or a similar)
// keyword landed at the exact same path, and since uploads use upsert:true,
// each new generation silently overwrote the previous one's images.
// Confirmed happening in practice: "ev charger station" was regenerated
// across 5+ separate sessions this project and every one of them reused
// literally the same 4 files. articleInstanceId disambiguates each
// generation while keeping the slug for human-browsability in the Storage UI.

function buildStoragePath(keyword: string, sizeKey: string, siteId: string, articleInstanceId: string): string {
  const now = new Date();
  const yyyyMM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const slug = keyword.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  return `${yyyyMM}/${siteId}/${slug}-${articleInstanceId.slice(0, 8)}/${sizeKey}.webp`;
}

async function uploadToStorage(buffer: Buffer, storagePath: string): Promise<string> {
  const supabase = getSupabase();
  const { error } = await supabase.storage
    .from('article-images')
    .upload(storagePath, buffer, { contentType: 'image/webp', upsert: true });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  const { data } = supabase.storage.from('article-images').getPublicUrl(storagePath);
  return data.publicUrl;
}

// A Storage upload failure after a SUCCESSFUL generation is a different,
// usually more transient problem than generation itself failing — retrying
// the same upload once is the right response, not silently substituting a
// completely different image from another provider (which is what the old
// pollinations.ai URL "fallback" here actually did, and never verified the
// replacement image would even load).
async function uploadToStorageWithRetry(buffer: Buffer, storagePath: string): Promise<string | null> {
  try {
    return await uploadToStorage(buffer, storagePath);
  } catch (err) {
    console.warn(`[image-generator] upload failed for ${storagePath}, retrying once:`, err);
    await new Promise(r => setTimeout(r, 1000));
    try {
      return await uploadToStorage(buffer, storagePath);
    } catch (retryErr) {
      console.warn(`[image-generator] upload retry also failed for ${storagePath}:`, retryErr);
      return null;
    }
  }
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function generateArticleImages(opts: {
  topic: string;
  keyword: string;
  tier: ImageTier;
  count?: number;
  siteId?: string;
  articleInstanceId?: string; // uniquely disambiguates this generation's storage folder — see buildStoragePath
}): Promise<ArticleImageSet> {
  const { topic, keyword, tier, count = 3, siteId = 'shared', articleInstanceId = randomUUID() } = opts;

  // Step 1: Detect niche + build shared style descriptor (single Haiku call)
  const { niche, styleDescriptor } = await detectNicheAndStyle(keyword, topic);
  console.log(`[image-generator] niche=${niche} style="${styleDescriptor}"`);

  const configured = [
    process.env.PEXELS_API_KEY && 'pexels',
    process.env.UNSPLASH_ACCESS_KEY && 'unsplash',
    process.env.GEMINI_API_KEY && 'gemini(hero-only)',
    process.env.REPLICATE_API_TOKEN && tier === 'premium' && 'replicate',
  ].filter(Boolean);
  console.log(`[image-generator] providers configured: ${configured.join(', ') || 'none — pollinations.ai only'}`);

  // Step 2: Build niche-aware, style-consistent prompts
  const prompts = await buildImagePrompts(keyword, topic, count, niche, styleDescriptor);
  const heroPrompt = prompts[0] ?? {
    placement: 'hero',
    prompt: `${keyword}, ${NICHE_VISUAL[niche]}, ${styleDescriptor}, no text`,
    alt: `${keyword} featured image`,
    caption: keyword,
  };
  const contentPrompts = prompts.slice(1);

  console.log(`[image-generator] requesting ${count} images (hero + ${count - 1} content) for "${keyword}"`);

  // Step 3: Generate all raw images SEQUENTIALLY with 1.5s delay to avoid Pollinations rate limits
  const allResults: ({ buffer: Buffer; tierUsed: ImageTier } | ImageFailure)[] = [];
  const allSlots = [
    { prompt: heroPrompt.prompt, width: BLOG_SIZES.hero.width, height: BLOG_SIZES.hero.height, sizeKey: 'hero' as BlogSizeKey },
    ...contentPrompts.map(cp => ({ prompt: cp.prompt, width: BLOG_SIZES.content.width, height: BLOG_SIZES.content.height, sizeKey: 'content' as BlogSizeKey })),
  ];
  for (let i = 0; i < allSlots.length; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, 1500));
    const slot = allSlots[i];
    const result = await generateWithRetryAndFallback(slot.prompt, slot.width, slot.height, tier, niche, slot.sizeKey, keyword);
    allResults.push(result);
  }
  const [heroResult, ...contentResults] = allResults;

  // Track which images failed at the generation stage (before Pollinations fallback)
  const heroFailed = 'failed' in heroResult;
  const contentFailureReasons: string[] = [];
  contentResults.forEach((r, i) => {
    if ('failed' in r) {
      contentFailureReasons.push(`content image ${i + 1}: ${'reason' in r ? r.reason : 'unknown error'}`);
    }
  });
  const imageStats: ImageStats = {
    requested: count,
    generated: count - (heroFailed ? 1 : 0) - contentFailureReasons.length,
    failures: [
      ...(heroFailed ? [`hero: ${'reason' in heroResult ? heroResult.reason : 'unknown'}`] : []),
      ...contentFailureReasons,
    ],
  };
  console.log('[image-generator] stats:', {
    requested: imageStats.requested,
    succeeded: imageStats.generated,
    failed: imageStats.failures.length,
    failureReasons: imageStats.failures,
  });

  // Step 4: Process hero — resize to hero + mobile in parallel, upload in parallel.
  // No pollinations.ai URL fallback here anymore — that used to construct a
  // live external prompt URL that was never actually verified to resolve,
  // including when the entire provider chain (which already tries
  // pollinations.ai as a real, buffer-fetched tail provider) had already
  // failed, meaning it was betting on the same already-failing service
  // succeeding a second time under a different code path. An empty URL is
  // tracked in imageStats.failures below and surfaced through the existing
  // Quality Gate image-completeness check instead of silently patched over.
  let heroUrl = '';
  let mobileUrl = '';
  if (!('failed' in heroResult)) {
    const [heroWebP, mobileWebP] = await Promise.all([
      resizeAndOptimize(heroResult.buffer, 'hero'),
      resizeAndOptimize(heroResult.buffer, 'mobile', 80),
    ]);
    const [heroUploaded, mobileUploaded] = await Promise.all([
      uploadToStorageWithRetry(heroWebP, buildStoragePath(keyword, 'hero', siteId, articleInstanceId)),
      uploadToStorageWithRetry(mobileWebP, buildStoragePath(keyword, 'mobile', siteId, articleInstanceId)),
    ]);
    heroUrl = heroUploaded ?? '';
    mobileUrl = mobileUploaded ?? '';
    if (!heroUrl) {
      imageStats.failures.push('hero: generated successfully but Storage upload failed twice');
      imageStats.generated -= 1;
    }
  } else {
    console.warn(`[image-generator] hero failed: ${heroResult.reason}`);
  }

  const hero: GeneratedImage = {
    id: 'hero',
    url: heroUrl,
    width: BLOG_SIZES.hero.width,
    height: BLOG_SIZES.hero.height,
    alt: heroPrompt.alt,
    caption: heroPrompt.caption,
    placement: 'Hero image (top of article)',
    prompt: heroPrompt.prompt,
  };

  const mobile: GeneratedImage = {
    id: 'mobile',
    url: mobileUrl,
    width: BLOG_SIZES.mobile.width,
    height: BLOG_SIZES.mobile.height,
    alt: heroPrompt.alt,
    caption: heroPrompt.caption,
    placement: 'Mobile hero',
    prompt: heroPrompt.prompt,
  };

  // Step 5: Process content images in parallel. Same principle as the hero
  // above — no pollinations.ai URL fallback; a slot that fails generation or
  // fails Storage upload (after one retry) gets an empty url, tracked in
  // imageStats.failures, surfaced through the Quality Gate rather than
  // silently patched with an unverified external URL.
  const contentImages: GeneratedImage[] = (
    await Promise.all(
      contentResults.map(async (result, i) => {
        const cp = contentPrompts[i];

        if ('failed' in result) {
          console.warn(`[image-generator] content ${i + 1} failed: ${result.reason}`);
          return {
            id: `content-${i + 1}`,
            url: '',
            width: BLOG_SIZES.content.width as number,
            height: BLOG_SIZES.content.height as number,
            alt: cp.alt,
            caption: cp.caption,
            placement: `Content image ${i + 1}`,
            prompt: cp.prompt,
          };
        }
        try {
          const webp = await resizeAndOptimize(result.buffer, 'content');
          const url = await uploadToStorageWithRetry(
            webp,
            buildStoragePath(keyword, `content-${i + 1}`, siteId, articleInstanceId),
          );
          if (!url) {
            imageStats.failures.push(`content image ${i + 1}: generated successfully but Storage upload failed twice`);
            imageStats.generated -= 1;
          }
          const img: GeneratedImage = {
            id: `content-${i + 1}`,
            url: url ?? '',
            width: BLOG_SIZES.content.width as number,
            height: BLOG_SIZES.content.height as number,
            alt: cp.alt,
            caption: cp.caption,
            placement: `Content image ${i + 1}`,
            prompt: cp.prompt,
          };
          return img;
        } catch (err) {
          console.warn(`[image-generator] content ${i + 1} resize/upload failed:`, err);
          imageStats.failures.push(`content image ${i + 1}: resize/upload threw — ${err instanceof Error ? err.message : String(err)}`);
          imageStats.generated -= 1;
          return {
            id: `content-${i + 1}`,
            url: '',
            width: BLOG_SIZES.content.width as number,
            height: BLOG_SIZES.content.height as number,
            alt: cp.alt,
            caption: cp.caption,
            placement: `Content image ${i + 1}`,
            prompt: cp.prompt,
          };
        }
      }),
    )
  ).filter((img): img is NonNullable<typeof img> => img !== null) as GeneratedImage[];

  return { hero, content: contentImages, mobile, niche, styleDescriptor, imageStats };
}

// ── Inject images into article HTML ──────────────────────────────────────────

function escapeHtmlAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildHeroFigure(hero: GeneratedImage, mobile: GeneratedImage | undefined): string {
  if (!hero.url) return '';
  const heroAlt = escapeHtmlAttr(hero.alt || '');
  const heroCaption = hero.caption ? escapeHtmlAttr(hero.caption) : '';
  return `<figure class="article-hero-image" style="margin:0 0 2rem 0;">
  <img
    src="${hero.url}"
    srcset="${mobile?.url ? `${mobile.url} 600w, ` : ''}${hero.url} 1200w"
    sizes="(max-width:640px) 600px, 1200px"
    alt="${heroAlt}"
    width="${hero.width}"
    height="${hero.height}"
    loading="eager"
    decoding="async"
    style="width:100%;height:auto;border-radius:8px;"
  />
  ${heroCaption ? `<figcaption style="text-align:center;font-size:0.85rem;color:#6B6B6B;margin-top:0.5rem;">${heroCaption}</figcaption>` : ''}
</figure>`;
}

function buildContentFigure(img: GeneratedImage): string {
  const imgAlt = escapeHtmlAttr(img.alt || '');
  const imgCaption = img.caption ? escapeHtmlAttr(img.caption) : '';
  return `<figure class="article-content-image" style="margin:1.5rem 0;">
  <img
    src="${img.url}"
    alt="${imgAlt}"
    width="${img.width}"
    height="${img.height}"
    loading="lazy"
    decoding="async"
    style="width:100%;height:auto;border-radius:6px;"
  />
  ${imgCaption ? `<figcaption style="text-align:center;font-size:0.85rem;color:#6B6B6B;margin-top:0.5rem;">${imgCaption}</figcaption>` : ''}
</figure>`;
}

// Finds the DOM node a content figure should land after within one H2
// section: the section's first <p>, or the heading itself if the section
// has no paragraph at all (an image is never dropped for lack of a <p>).
// Walking element siblings (not string positions) means this is immune to
// however node-html-parser re-serializes whitespace/attributes — unlike the
// regex version this replaces, which located `</p>` by raw string offset.
function findSectionAnchor(h2: HTMLElement): HTMLElement {
  let node: HTMLElement | null = h2;
  let sibling = h2.nextElementSibling;
  while (sibling && sibling.tagName?.toLowerCase() !== 'h2') {
    if (sibling.tagName?.toLowerCase() === 'p') return sibling;
    node = sibling;
    sibling = sibling.nextElementSibling;
  }
  return node ?? h2;
}

// Pure: never mutates the input ArticleImageSet, and returns a NEW HTML
// string rather than editing `html` in place — a prior string-slicing
// implementation here mutated positions as a side effect of insertion
// order, which made it unsafe to call more than once against the same
// article state or to reason about independently of caller ordering.
export function injectImagesIntoArticle(html: string, imageSet: ArticleImageSet): string {
  if (!html) return html;

  const { hero, content, mobile } = imageSet;
  const root = parse(html);

  const heroFigureHtml = buildHeroFigure(hero, mobile);
  if (heroFigureHtml) {
    const h1 = root.querySelector('h1');
    if (h1) {
      h1.insertAdjacentHTML('beforebegin', heroFigureHtml + '\n');
    } else {
      root.insertAdjacentHTML('afterbegin', heroFigureHtml + '\n');
    }
  }

  if (content.length > 0) {
    // FAQ section excluded: it's immediately followed by a disclaimer <p>,
    // so the same after-first-paragraph rule would land an image between
    // that disclaimer and the first FAQ item — FAQs are meant to be
    // scanned immediately, not interrupted.
    const h2Sections = root.querySelectorAll('h2').filter(h2 =>
      h2.textContent.trim().toLowerCase() !== 'frequently asked questions'
    );

    if (h2Sections.length > 0) {
      // Distribute images evenly: pick one H2 per image, never reusing the
      // same section. When there are fewer H2s than content images, later
      // images are skipped gracefully.
      const usedIndices = new Set<number>();
      content.forEach((img, i) => {
        if (!img.url) return;
        const targetIdx = Math.min(
          Math.floor((i / content.length) * h2Sections.length),
          h2Sections.length - 1,
        );
        let idx = targetIdx;
        while (idx < h2Sections.length && usedIndices.has(idx)) idx++;
        if (idx >= h2Sections.length) {
          idx = targetIdx - 1;
          while (idx >= 0 && usedIndices.has(idx)) idx--;
        }
        if (idx < 0 || idx >= h2Sections.length) return; // no more H2 slots

        usedIndices.add(idx);
        const anchor = findSectionAnchor(h2Sections[idx]);
        anchor.insertAdjacentHTML('afterend', '\n' + buildContentFigure(img));
      });
    } else if (content[0]?.url) {
      // No H2s — append first content image after the article's first <p>
      const firstP = root.querySelector('p');
      if (firstP) {
        firstP.insertAdjacentHTML('afterend', '\n' + buildContentFigure(content[0]));
      }
    }
  }

  return root.toString();
}

// ── og:image meta + ImageObject schema ───────────────────────────────────────

export function buildImageMeta(imageSet: ArticleImageSet, keyword: string): string {
  if (!imageSet.hero.url) return '';

  const imageObject = {
    '@type': 'ImageObject',
    url: imageSet.hero.url,
    width: imageSet.hero.width,
    height: imageSet.hero.height,
    description: imageSet.hero.alt || keyword,
  };

  return (
    `<!--SEORANKO_OG_IMAGE:${imageSet.hero.url}-->` +
    `<!--SEORANKO_IMAGE_SCHEMA:${JSON.stringify(imageObject)}-->`
  );
}

// ── Simple sequential image generation (for regenerate-images API) ────────────

export interface ImageRequest {
  prompt: string
  width: number
  height: number
  slot: 'hero' | 'content1' | 'content2' | 'content3'
}

export interface ImageResult {
  slot: string
  url: string | null
  success: boolean
  error?: string
}

function buildPollinationsUrl(prompt: string, width: number, height: number): string {
  const cleanPrompt = prompt
    .replace(/[^\w\s,.-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400)
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(cleanPrompt)}?width=${width}&height=${height}&nologo=true&model=flux`
}

async function verifyImageUrl(url: string, timeoutMs = 15000): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    const response = await fetch(url, { method: 'HEAD', signal: controller.signal })
    clearTimeout(timeout)
    return response.ok
  } catch {
    return false
  }
}

async function generateOneImage(request: ImageRequest, maxRetries = 3): Promise<ImageResult> {
  const url = buildPollinationsUrl(request.prompt, request.width, request.height)
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const works = await verifyImageUrl(url, 20000)
      if (works) return { slot: request.slot, url, success: true }
      if (attempt < maxRetries) await new Promise(r => setTimeout(r, attempt * 2000))
    } catch (err) {
      if (attempt === maxRetries) return { slot: request.slot, url: null, success: false, error: String(err) }
      await new Promise(r => setTimeout(r, attempt * 2000))
    }
  }
  return { slot: request.slot, url: null, success: false, error: 'Max retries reached' }
}

export async function generateArticleImagesFromRequests(requests: ImageRequest[]): Promise<ImageResult[]> {
  const results: ImageResult[] = []
  for (let i = 0; i < requests.length; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, 1500))
    results.push(await generateOneImage(requests[i]))
  }
  return results
}

export function buildArticleImageRequests(
  keyword: string,
  title: string,
  sections: string[]
): ImageRequest[] {
  const style = 'professional photography, clean composition, bright daylight, contemporary editorial style, no text, no logos, no watermarks'
  return [
    { slot: 'hero', prompt: `${title}, ${keyword}, ${style}`, width: 1200, height: 630 },
    { slot: 'content1', prompt: `${sections[0] || keyword}, ${style}`, width: 800, height: 533 },
    { slot: 'content2', prompt: `${sections[1] || keyword}, ${style}`, width: 800, height: 533 },
    { slot: 'content3', prompt: `${sections[2] || keyword}, ${style}`, width: 800, height: 533 },
  ]
}
