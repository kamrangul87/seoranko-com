/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { normalizeDomain } from '@/lib/supabase/audit-db';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!, maxRetries: 2 });
const MAIN_MODEL = 'claude-sonnet-4-6';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } }
  );
}

export interface CitationResult {
  topic: string;
  mentioned: boolean;
  cited: boolean;
  competitorsCited: string[];
  rawSnippet: string;
}

async function testCitation(
  brandName: string,
  domain: string,
  topic: string,
): Promise<CitationResult> {
  const query = `${topic} — which tools or companies do you recommend?`;

  try {
    const res = await anthropic.messages.create({
      model: MAIN_MODEL,
      max_tokens: 600,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 2 } as any],
      messages: [{ role: 'user', content: query }],
    });

    const textBlocks = res.content.filter((b: any) => b.type === 'text').map((b: any) => b.text);
    const fullText = textBlocks.join('\n');
    const textLower = fullText.toLowerCase();

    const brandLower = brandName.toLowerCase();
    const domainLower = domain.toLowerCase();

    const mentioned = textLower.includes(brandLower) || textLower.includes(domainLower);

    // "cited" = directly referenced with a URL or strong named mention
    const urlPattern = new RegExp(domainLower.replace(/\./g, '\\.'), 'i');
    const cited = urlPattern.test(fullText) || (mentioned && (
      fullText.includes(`[${brandName}`) || fullText.includes(`"${brandName}"`)
    ));

    // Extract competitor names: words before/after "recommend", "use", "try"
    const competitorMatches = fullText.match(
      /\b([A-Z][a-zA-Z0-9]{2,20}(?:\s[A-Z][a-zA-Z0-9]{2,15})?)\b(?=\s+is|\s+offers|\s+provides|\s+lets\b|\s+allows|\s+helps)/g
    ) || [];
    const competitorsCited = Array.from(new Set(
      competitorMatches
        .map((s: string) => s.trim())
        .filter((s: string) => s.toLowerCase() !== brandLower && s.length > 2 && s.length < 40)
    )).slice(0, 5);

    const snippet = fullText.slice(0, 300).trim();

    return { topic, mentioned, cited, competitorsCited, rawSnippet: snippet };
  } catch (err) {
    console.error('[citations] test error for topic:', topic, err);
    return { topic, mentioned: false, cited: false, competitorsCited: [], rawSnippet: '' };
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { domain, brandName, topics } = body as {
      domain: string;
      brandName: string;
      topics: string[];
    };

    if (!domain || !brandName || !Array.isArray(topics) || topics.length === 0) {
      return NextResponse.json({ error: 'domain, brandName, and topics[] are required' }, { status: 400 });
    }

    const normDomain = normalizeDomain(domain);
    const topicsToTest = topics.slice(0, 5); // cap at 5 to control latency/cost

    // Run citation tests in parallel
    const results = await Promise.all(
      topicsToTest.map(topic => testCitation(brandName, normDomain, topic))
    );

    // Persist to Supabase (non-fatal)
    try {
      const supabase = getSupabase();
      const now = new Date().toISOString();
      await supabase.from('ai_citation_tests').insert(
        results.map(r => ({
          domain: normDomain,
          topic: r.topic,
          mentioned: r.mentioned,
          cited: r.cited,
          competitors_cited: r.competitorsCited,
          tested_at: now,
        }))
      );
    } catch (dbErr) {
      console.warn('[citations] DB insert failed:', dbErr);
    }

    const mentionedCount = results.filter(r => r.mentioned).length;
    const citedCount = results.filter(r => r.cited).length;

    return NextResponse.json({
      success: true,
      domain: normDomain,
      brandName,
      results,
      summary: {
        topicsTested: results.length,
        mentioned: mentionedCount,
        cited: citedCount,
        mentionRate: Math.round((mentionedCount / results.length) * 100),
        citationRate: Math.round((citedCount / results.length) * 100),
      },
    });
  } catch (err: any) {
    console.error('[citations] POST error:', err);
    return NextResponse.json({ error: err.message || 'Citation test failed' }, { status: 500 });
  }
}
