import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';

export const BLOG_SIZES = {
  hero:      { width: 1200, height: 630 },
  content:   { width: 800,  height: 533 },
  thumbnail: { width: 400,  height: 400 },
  mobile:    { width: 600,  height: 315 },
} as const;

export type BlogSizeKey = keyof typeof BLOG_SIZES;
export type ImageTier = 'free' | 'premium';

export interface GeneratedImage {
  url: string;
  width: number;
  height: number;
  alt: string;
  caption: string;
  placement: string;
  prompt: string;
  id: string;
}

export interface ArticleImageSet {
  hero: GeneratedImage;
  content: GeneratedImage[];
  mobile?: GeneratedImage;
}

// ── Fetch image from Pollinations.ai (free tier) ──────────────────────────────
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
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Pollinations fetch failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// ── Generate image via Replicate Flux Schnell (premium tier) ──────────────────
export async function generateImageReplicate(
  prompt: string,
  width: number,
  height: number,
): Promise<Buffer> {
  const apiToken = process.env.REPLICATE_API_TOKEN;
  if (!apiToken) throw new Error('REPLICATE_API_TOKEN not configured');

  // Dynamic import avoids bundling Replicate in edge environments
  const { default: Replicate } = await import('replicate');
  const replicate = new Replicate({ auth: apiToken });

  const output = await replicate.run('black-forest-labs/flux-schnell', {
    input: {
      prompt,
      width: Math.round(width / 8) * 8,   // Flux requires multiple of 8
      height: Math.round(height / 8) * 8,
      num_outputs: 1,
      output_format: 'webp',
    },
  });

  const outputArr = Array.isArray(output) ? output : [output];
  const first = outputArr[0] as { blob: () => Promise<Blob>; url: () => URL };

  let buffer: Buffer;
  if (typeof first === 'string') {
    const res = await fetch(first);
    buffer = Buffer.from(await res.arrayBuffer());
  } else if (typeof first.blob === 'function') {
    const blob = await first.blob();
    buffer = Buffer.from(await blob.arrayBuffer());
  } else {
    const imageUrl = first.url().toString();
    const res = await fetch(imageUrl);
    buffer = Buffer.from(await res.arrayBuffer());
  }
  return buffer;
}

// ── Resize + convert to WebP via sharp, strip EXIF ───────────────────────────
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

// ── Upload WebP buffer to Supabase Storage and return public URL ──────────────
async function uploadToStorage(buffer: Buffer, storagePath: string): Promise<string> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );

  const { error } = await supabase.storage
    .from('article-images')
    .upload(storagePath, buffer, {
      contentType: 'image/webp',
      upsert: true,
    });

  if (error) throw new Error(`Storage upload failed: ${error.message}`);

  const { data } = supabase.storage.from('article-images').getPublicUrl(storagePath);
  return data.publicUrl;
}

// ── Build slug from keyword for storage path ──────────────────────────────────
function toSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

// ── Use Claude to generate descriptive image prompts ─────────────────────────
async function buildImagePrompts(
  keyword: string,
  topic: string,
  count: number,
): Promise<{ placement: string; prompt: string; alt: string; caption: string }[]> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

  const res = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 600,
    messages: [
      {
        role: 'user',
        content: `Generate ${count} photorealistic image prompts for a blog article about "${keyword}". Topic: ${topic}.

Return ONLY valid JSON array:
[
  {
    "placement": "hero|content|thumbnail",
    "prompt": "detailed photorealistic image generation prompt, professional blog quality, no text overlay",
    "alt": "SEO-friendly alt text under 125 chars",
    "caption": "short image caption for the article"
  }
]

First item must be "hero", remaining items "content". No markdown, no explanation.`,
      },
    ],
  });

  const text = res.content[0].type === 'text' ? res.content[0].text : '[]';
  try {
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch {
    return [
      {
        placement: 'hero',
        prompt: `Professional blog hero image about ${keyword}, photorealistic, clean background`,
        alt: `${keyword} featured image`,
        caption: keyword,
      },
    ];
  }
}

// ── Main entry point ──────────────────────────────────────────────────────────
export async function generateArticleImages(opts: {
  topic: string;
  keyword: string;
  tier: ImageTier;
  count?: number;
  sessionId?: string;
}): Promise<ArticleImageSet> {
  const { topic, keyword, tier, count = 3, sessionId } = opts;
  const slug = toSlug(keyword);
  const folder = sessionId ? `${slug}/${sessionId}` : slug;

  // 1. Generate prompts via Claude
  const prompts = await buildImagePrompts(keyword, topic, count);

  // 2. For each prompt, generate + resize + upload
  const generateFn = tier === 'premium' ? generateImageReplicate : generateImagePollinations;

  const heroPromptData = prompts[0] || { placement: 'hero', prompt: `${keyword} professional`, alt: keyword, caption: keyword };
  const contentPrompts = prompts.slice(1);

  // Hero: 1200×630
  const heroRaw = await generateFn(heroPromptData.prompt, BLOG_SIZES.hero.width, BLOG_SIZES.hero.height);
  const heroWebP = await resizeAndOptimize(heroRaw, 'hero');
  const heroUrl = await uploadToStorage(heroWebP, `${folder}/hero.webp`).catch(() => '');

  // Mobile variant of hero: 600×315
  const mobileWebP = await resizeAndOptimize(heroRaw, 'mobile');
  const mobileUrl = await uploadToStorage(mobileWebP, `${folder}/mobile.webp`).catch(() => '');

  const hero: GeneratedImage = {
    id: 'hero',
    url: heroUrl,
    width: BLOG_SIZES.hero.width,
    height: BLOG_SIZES.hero.height,
    alt: heroPromptData.alt,
    caption: heroPromptData.caption,
    placement: 'Hero image (top of article)',
    prompt: heroPromptData.prompt,
  };

  // Content images: 800×533
  const contentImages: GeneratedImage[] = [];
  for (let i = 0; i < contentPrompts.length; i++) {
    const cp = contentPrompts[i];
    try {
      const raw = await generateFn(cp.prompt, BLOG_SIZES.content.width, BLOG_SIZES.content.height);
      const webp = await resizeAndOptimize(raw, 'content');
      const url = await uploadToStorage(webp, `${folder}/content-${i + 1}.webp`).catch(() => '');
      contentImages.push({
        id: `content-${i + 1}`,
        url,
        width: BLOG_SIZES.content.width,
        height: BLOG_SIZES.content.height,
        alt: cp.alt,
        caption: cp.caption,
        placement: `Content image ${i + 1}`,
        prompt: cp.prompt,
      });
    } catch (err) {
      console.warn(`[image-generator] content image ${i + 1} failed:`, err);
    }
  }

  const mobile: GeneratedImage = {
    id: 'mobile',
    url: mobileUrl,
    width: BLOG_SIZES.mobile.width,
    height: BLOG_SIZES.mobile.height,
    alt: heroPromptData.alt,
    caption: heroPromptData.caption,
    placement: 'Mobile hero',
    prompt: heroPromptData.prompt,
  };

  return { hero, content: contentImages, mobile };
}

// ── Inject image set into article HTML ───────────────────────────────────────
export function injectImagesIntoArticle(html: string, imageSet: ArticleImageSet): string {
  if (!html) return html;

  // Build hero figure with srcset
  const { hero, content, mobile } = imageSet;
  const heroFigure = hero.url
    ? `<figure class="article-hero-image" style="margin:0 0 2rem 0;">
  <img
    src="${hero.url}"
    srcset="${mobile?.url ? `${mobile.url} 600w, ` : ''}${hero.url} 1200w"
    sizes="(max-width:640px) 600px, 1200px"
    alt="${hero.alt}"
    width="${hero.width}"
    height="${hero.height}"
    loading="eager"
    decoding="async"
    style="width:100%;height:auto;border-radius:8px;"
  />
  ${hero.caption ? `<figcaption style="text-align:center;font-size:0.85rem;color:#6B6B6B;margin-top:0.5rem;">${hero.caption}</figcaption>` : ''}
</figure>\n`
    : '';

  // Insert hero before first <h1> or at start
  let result = html;
  if (heroFigure) {
    const h1Pos = result.search(/<h1[\s>]/i);
    if (h1Pos !== -1) {
      result = result.slice(0, h1Pos) + heroFigure + result.slice(h1Pos);
    } else {
      result = heroFigure + result;
    }
  }

  // Insert content images after 2nd and 4th H2
  if (content.length > 0) {
    const h2Regex = /<\/h2>/gi;
    let match: RegExpExecArray | null;
    let count = 0;
    const insertions: { pos: number; figure: string }[] = [];

    while ((match = h2Regex.exec(result)) !== null) {
      count++;
      const img = count === 2 ? content[0] : count === 4 ? content[1] : null;
      if (img?.url) {
        insertions.push({
          pos: match.index + match[0].length,
          figure: `\n<figure class="article-content-image" style="margin:1.5rem 0;">
  <img
    src="${img.url}"
    alt="${img.alt}"
    width="${img.width}"
    height="${img.height}"
    loading="lazy"
    decoding="async"
    style="width:100%;height:auto;border-radius:6px;"
  />
  ${img.caption ? `<figcaption style="text-align:center;font-size:0.85rem;color:#6B6B6B;margin-top:0.5rem;">${img.caption}</figcaption>` : ''}
</figure>\n`,
        });
      }
      if (count >= 4) break;
    }

    // Insert in reverse order so positions stay valid
    for (const ins of insertions.reverse()) {
      result = result.slice(0, ins.pos) + ins.figure + result.slice(ins.pos);
    }
  }

  return result;
}

// ── Build og:image meta + ImageObject schema snippet ─────────────────────────
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
