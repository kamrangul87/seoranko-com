import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';

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

export interface ArticleImageSet {
  hero: GeneratedImage;
  content: GeneratedImage[];
  mobile?: GeneratedImage;
  niche: ArticleNiche;
  styleDescriptor: string;
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
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

  const res = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 120,
    messages: [{
      role: 'user',
      content: `Classify the niche of this article and generate a short visual style descriptor for consistent AI image generation across all images in the article.

Topic: "${keyword}". Context: ${topic.slice(0, 200)}

Valid niches: automotive, health, finance, technology, food, travel, business, lifestyle, education, other

Return ONLY valid JSON, no markdown:
{"niche":"<niche>","styleDescriptor":"<12–18 word consistent visual style, e.g. warm natural lighting, shallow depth of field, editorial style>"}`,
    }],
  });

  const text = res.content[0].type === 'text' ? res.content[0].text : '{}';
  try {
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    const niche = (parsed.niche as ArticleNiche) in NICHE_VISUAL
      ? (parsed.niche as ArticleNiche)
      : 'other';
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
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 800,
    messages: [{
      role: 'user',
      content: `Generate ${count} image prompts for a blog article about "${keyword}".

Niche: ${niche}. Topic context: ${topic.slice(0, 200)}

Mandatory visual style — append exactly to EVERY prompt: "${fullStyle}"

Return ONLY valid JSON array, no markdown:
[
  {
    "placement": "hero",
    "prompt": "<specific subject for this image>, ${fullStyle}, no text, no logos, no watermarks",
    "alt": "<SEO alt text under 125 chars>",
    "caption": "<concise caption for the article>"
  }
]

Rules:
- First item must have placement "hero", rest "content"
- Each prompt must describe a distinct scene/angle (no repetition)
- The mandatory visual style must appear verbatim at the end of each prompt
- No markdown, no explanation`,
    }],
  });

  const text = res.content[0].type === 'text' ? res.content[0].text : '[]';
  try {
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('empty');
    return parsed;
  } catch {
    return [{
      placement: 'hero',
      prompt: `${keyword}, ${fullStyle}, no text`,
      alt: `${keyword} featured image`,
      caption: keyword,
    }];
  }
}

// ── Low-level fetchers ────────────────────────────────────────────────────────

const SAFETY_SIGNALS = ['safety', 'policy', 'content', 'nsfw', 'prohibited', 'blocked', 'refused', 'violation', 'moderat'];

function isSafetyError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return SAFETY_SIGNALS.some(k => msg.includes(k));
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

// ── Retry + cross-tier fallback wrapper ───────────────────────────────────────

async function generateWithRetryAndFallback(
  prompt: string,
  width: number,
  height: number,
  tier: ImageTier,
  niche: ArticleNiche,
  sizeKey: BlogSizeKey,
  keyword: string,
): Promise<{ buffer: Buffer; tierUsed: ImageTier } | ImageFailure> {
  const primaryFn  = tier === 'premium' ? generateImageReplicate : generateImagePollinations;
  const fallbackFn = tier === 'premium' ? generateImagePollinations : generateImageReplicate;
  const fallbackTier: ImageTier = tier === 'premium' ? 'free' : 'premium';

  // Primary tier — up to 2 attempts
  for (let attempt = 1; attempt <= 2; attempt++) {
    const t0 = Date.now();
    try {
      const buffer = await primaryFn(prompt, width, height);
      void logGeneration({ tier, niche, success: true, duration_ms: Date.now() - t0, keyword, size_key: sizeKey });
      return { buffer, tierUsed: tier };
    } catch (err) {
      const duration_ms = Date.now() - t0;
      const reason = err instanceof Error ? err.message : String(err);
      void logGeneration({ tier, niche, success: false, duration_ms, keyword, size_key: sizeKey, error_reason: reason });

      if (isSafetyError(err)) {
        return {
          failed: true,
          reason: 'Image generation was blocked by content safety filters — try rephrasing your topic',
        };
      }
      if (attempt < 2) {
        console.warn(`[image-generator] ${tier} attempt ${attempt} failed, retrying:`, reason);
      }
    }
  }

  // Cross-tier fallback — skip if fallback is premium and token is missing
  if (fallbackTier === 'premium' && !process.env.REPLICATE_API_TOKEN) {
    return { failed: true, reason: `Image generation failed after 2 attempts on ${tier} tier` };
  }

  console.warn(`[image-generator] falling back from ${tier} → ${fallbackTier}`);
  const t0 = Date.now();
  try {
    const buffer = await fallbackFn(prompt, width, height);
    void logGeneration({ tier: fallbackTier, niche, success: true, duration_ms: Date.now() - t0, keyword, size_key: sizeKey });
    return { buffer, tierUsed: fallbackTier };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    void logGeneration({ tier: fallbackTier, niche, success: false, duration_ms: Date.now() - t0, keyword, size_key: sizeKey, error_reason: reason });
    if (isSafetyError(err)) {
      return {
        failed: true,
        reason: 'Image generation was blocked by content safety filters — try rephrasing your topic',
      };
    }
    return { failed: true, reason: `Both ${tier} and ${fallbackTier} tiers failed: ${reason}` };
  }
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

// ── Storage path: article-images/{YYYY-MM}/{siteId}/{slug}/{size}.webp ────────

function buildStoragePath(keyword: string, sizeKey: string, siteId: string): string {
  const now = new Date();
  const yyyyMM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const slug = keyword.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  return `${yyyyMM}/${siteId}/${slug}/${sizeKey}.webp`;
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

// ── Main entry point ──────────────────────────────────────────────────────────

export async function generateArticleImages(opts: {
  topic: string;
  keyword: string;
  tier: ImageTier;
  count?: number;
  siteId?: string;
}): Promise<ArticleImageSet> {
  const { topic, keyword, tier, count = 3, siteId = 'shared' } = opts;

  // Step 1: Detect niche + build shared style descriptor (single Haiku call)
  const { niche, styleDescriptor } = await detectNicheAndStyle(keyword, topic);
  console.log(`[image-generator] niche=${niche} style="${styleDescriptor}"`);

  // Step 2: Build niche-aware, style-consistent prompts
  const prompts = await buildImagePrompts(keyword, topic, count, niche, styleDescriptor);
  const heroPrompt = prompts[0] ?? {
    placement: 'hero',
    prompt: `${keyword}, ${NICHE_VISUAL[niche]}, ${styleDescriptor}, no text`,
    alt: `${keyword} featured image`,
    caption: keyword,
  };
  const contentPrompts = prompts.slice(1);

  // Step 3: Generate all raw images in parallel (hero + all content simultaneously)
  const [heroResult, ...contentResults] = await Promise.all([
    generateWithRetryAndFallback(
      heroPrompt.prompt,
      BLOG_SIZES.hero.width,
      BLOG_SIZES.hero.height,
      tier, niche, 'hero', keyword,
    ),
    ...contentPrompts.map((cp) =>
      generateWithRetryAndFallback(
        cp.prompt,
        BLOG_SIZES.content.width,
        BLOG_SIZES.content.height,
        tier, niche, 'content', keyword,
      )
    ),
  ]);

  // Step 4: Process hero — resize to hero + mobile in parallel, upload in parallel
  let heroUrl = '';
  let mobileUrl = '';
  if (!('failed' in heroResult)) {
    const [heroWebP, mobileWebP] = await Promise.all([
      resizeAndOptimize(heroResult.buffer, 'hero'),
      resizeAndOptimize(heroResult.buffer, 'mobile', 80),
    ]);
    [heroUrl, mobileUrl] = await Promise.all([
      uploadToStorage(heroWebP, buildStoragePath(keyword, 'hero', siteId)).catch(() => ''),
      uploadToStorage(mobileWebP, buildStoragePath(keyword, 'mobile', siteId)).catch(() => ''),
    ]);
    // Fallback to Pollinations URL when storage upload fails
    if (!heroUrl) {
      heroUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(heroPrompt.prompt)}?width=${BLOG_SIZES.hero.width}&height=${BLOG_SIZES.hero.height}&nologo=true&model=flux`;
    }
    if (!mobileUrl) {
      mobileUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(heroPrompt.prompt)}?width=${BLOG_SIZES.mobile.width}&height=${BLOG_SIZES.mobile.height}&nologo=true&model=flux`;
    }
  } else {
    console.warn(`[image-generator] hero failed: ${heroResult.reason}`);
    // Even if generation failed, provide a Pollinations URL so injection works
    heroUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(heroPrompt.prompt)}?width=${BLOG_SIZES.hero.width}&height=${BLOG_SIZES.hero.height}&nologo=true&model=flux`;
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

  // Step 5: Process content images in parallel
  const contentImages: GeneratedImage[] = (
    await Promise.all(
      contentResults.map(async (result, i) => {
        const cp = contentPrompts[i];
        const fallbackUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(cp.prompt)}?width=${BLOG_SIZES.content.width}&height=${BLOG_SIZES.content.height}&nologo=true&model=flux`;

        if ('failed' in result) {
          console.warn(`[image-generator] content ${i + 1} failed: ${result.reason}`);
          // Use Pollinations fallback even when generation reported failure
          return {
            id: `content-${i + 1}`,
            url: fallbackUrl,
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
          const url = await uploadToStorage(
            webp,
            buildStoragePath(keyword, `content-${i + 1}`, siteId),
          ).catch(() => '');
          const img: GeneratedImage = {
            id: `content-${i + 1}`,
            url: url || fallbackUrl,
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
          return {
            id: `content-${i + 1}`,
            url: fallbackUrl,
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

  return { hero, content: contentImages, mobile, niche, styleDescriptor };
}

// ── Inject images into article HTML ──────────────────────────────────────────

function escapeHtmlAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function injectImagesIntoArticle(html: string, imageSet: ArticleImageSet): string {
  if (!html) return html;

  const { hero, content, mobile } = imageSet;

  const heroAlt = escapeHtmlAttr(hero.alt || '');
  const heroCaption = hero.caption ? escapeHtmlAttr(hero.caption) : '';

  const heroFigure = hero.url
    ? `<figure class="article-hero-image" style="margin:0 0 2rem 0;">
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
</figure>\n`
    : '';

  let result = html;
  if (heroFigure) {
    const h1Pos = result.search(/<h1[\s>]/i);
    result = h1Pos !== -1
      ? result.slice(0, h1Pos) + heroFigure + result.slice(h1Pos)
      : heroFigure + result;
  }

  // Insert content images evenly distributed across H2 sections
  if (content.length > 0) {
    const h2Regex = /<\/h2>/gi;
    let match: RegExpExecArray | null;
    const h2Positions: number[] = [];

    while ((match = h2Regex.exec(result)) !== null) {
      h2Positions.push(match.index + match[0].length);
    }

    const insertions: { pos: number; figure: string }[] = [];

    if (h2Positions.length > 0) {
      // Distribute images evenly: pick H2 positions at regular intervals
      const step = Math.max(1, Math.floor(h2Positions.length / (content.length + 1)));
      content.forEach((img, i) => {
        const targetH2Index = Math.min((i + 1) * step - 1, h2Positions.length - 1);
        // Avoid inserting two images at the same position
        const pos = h2Positions[targetH2Index];
        if (pos !== undefined && img.url && !insertions.some(ins => ins.pos === pos)) {
          const imgAlt = escapeHtmlAttr(img.alt || '');
          const imgCaption = img.caption ? escapeHtmlAttr(img.caption) : '';
          insertions.push({
            pos,
            figure: `\n<figure class="article-content-image" style="margin:1.5rem 0;">
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
</figure>\n`,
          });
        }
      });
    } else if (content[0]?.url) {
      // No H2s — append first content image after the hero area
      const bodyStart = result.search(/<p[\s>]/i);
      if (bodyStart !== -1) {
        const firstParaEnd = result.indexOf('</p>', bodyStart);
        if (firstParaEnd !== -1) {
          const c0Alt = escapeHtmlAttr(content[0].alt || '');
          const c0Caption = content[0].caption ? escapeHtmlAttr(content[0].caption) : '';
          insertions.push({
            pos: firstParaEnd + 4,
            figure: `\n<figure class="article-content-image" style="margin:1.5rem 0;">
  <img src="${content[0].url}" alt="${c0Alt}" width="${content[0].width}" height="${content[0].height}" loading="lazy" decoding="async" style="width:100%;height:auto;border-radius:6px;" />
  ${c0Caption ? `<figcaption style="text-align:center;font-size:0.85rem;color:#6B6B6B;margin-top:0.5rem;">${c0Caption}</figcaption>` : ''}
</figure>\n`,
          });
        }
      }
    }

    for (const ins of insertions.sort((a, b) => b.pos - a.pos)) {
      result = result.slice(0, ins.pos) + ins.figure + result.slice(ins.pos);
    }
  }

  return result;
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
