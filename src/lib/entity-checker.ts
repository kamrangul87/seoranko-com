/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Shared entity presence checker.
 * Searches for Wikipedia, Reddit, LinkedIn presence of a brand name.
 * Results are cached in entity_cache with a 24-hour TTL.
 * Used by: site-audit, article-competitor, ranking-agent, discovery, dashboard.
 */
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!, maxRetries: 2 });
const FAST_MODEL = 'claude-haiku-4-5-20251001';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface EntityPresence {
  wikipedia: boolean;
  reddit: boolean;
  linkedin: boolean;
  score: number;            // 0 | 33 | 66 | 100
  recommendations: string[];
}

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } }
  );
}

function cacheKey(brandName: string): string {
  return brandName.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 80);
}

function computeScore(wikipedia: boolean, reddit: boolean, linkedin: boolean): number {
  return [wikipedia, reddit, linkedin].filter(Boolean).length * 33;
}

function buildResult(wikipedia: boolean, reddit: boolean, linkedin: boolean): EntityPresence {
  const score = computeScore(wikipedia, reddit, linkedin);
  const recommendations: string[] = [];
  if (!wikipedia) recommendations.push('Create or contribute to a Wikipedia page about your brand to build entity authority');
  if (!reddit)    recommendations.push('Build Reddit presence — participate in relevant subreddits or create a brand subreddit');
  if (!linkedin)  recommendations.push('Set up an official LinkedIn company page to strengthen professional entity signals');
  return { wikipedia, reddit, linkedin, score, recommendations };
}

/**
 * Check whether a brand has an established entity presence on Wikipedia, Reddit, and LinkedIn.
 * Results are cached for 24 hours to avoid repeated API calls.
 */
export async function checkEntityPresence(brandName: string): Promise<EntityPresence> {
  const key = cacheKey(brandName);
  const supabase = getSupabase();

  // Try cache first
  try {
    const { data: cached } = await supabase
      .from('entity_cache')
      .select('wikipedia, reddit, linkedin, checked_at')
      .eq('brand_key', key)
      .single();

    if (cached?.checked_at) {
      const age = Date.now() - new Date(cached.checked_at).getTime();
      if (age < CACHE_TTL_MS) {
        return buildResult(cached.wikipedia, cached.reddit, cached.linkedin);
      }
    }
  } catch { /* cache miss — proceed to live check */ }

  // Live web search
  try {
    const res = await anthropic.messages.create({
      model: FAST_MODEL,
      max_tokens: 250,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 } as any],
      messages: [{
        role: 'user',
        content: `Does the brand "${brandName}" have a verified presence on: 1) Wikipedia (an article about this brand), 2) Reddit (subreddit or company page), 3) LinkedIn (official company page)? Return ONLY JSON: {"wikipedia":boolean,"reddit":boolean,"linkedin":boolean}`,
      }],
    });

    const text = res.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
    const start = text.indexOf('{');
    const end   = text.lastIndexOf('}');

    if (start !== -1 && end !== -1) {
      const { wikipedia = false, reddit = false, linkedin = false } = JSON.parse(text.slice(start, end + 1));
      const score = computeScore(wikipedia, reddit, linkedin);

      // Write to cache (non-fatal)
      void Promise.resolve(supabase.from('entity_cache').upsert({
        brand_key:  key,
        wikipedia,
        reddit,
        linkedin,
        score,
        checked_at: new Date().toISOString(),
      }, { onConflict: 'brand_key' })).catch(() => {});

      return buildResult(wikipedia, reddit, linkedin);
    }
  } catch (err) {
    console.error('[entity-checker] error:', err);
  }

  return buildResult(false, false, false);
}

/**
 * Lightweight cache-only lookup — returns null if no cached result exists.
 * Safe to call anywhere without triggering a live API call.
 */
export async function getCachedEntityPresence(brandName: string): Promise<EntityPresence | null> {
  const key = cacheKey(brandName);
  const supabase = getSupabase();
  try {
    const { data } = await supabase
      .from('entity_cache')
      .select('wikipedia, reddit, linkedin')
      .eq('brand_key', key)
      .single();
    if (!data) return null;
    return buildResult(data.wikipedia, data.reddit, data.linkedin);
  } catch {
    return null;
  }
}
