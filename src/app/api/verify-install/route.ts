import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

type Reason = 'script_not_found' | 'wrong_site_id' | 'site_unreachable';

function normalizeSiteId(domain: string): string {
  try {
    const full = domain.startsWith('http') ? domain : `https://${domain}`;
    return new URL(full).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return domain.replace(/^www\./, '').toLowerCase().replace(/\/$/, '');
  }
}

// Fetch the homepage HTML, retrying up to maxAttempts times on failure.
async function fetchHomepage(url: string, maxAttempts = 3): Promise<string | null> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SEORANKO-Verify/1.0)' },
        signal: AbortSignal.timeout(10000),
        redirect: 'follow',
      });
      if (!res.ok) {
        if (attempt === maxAttempts) return null;
        continue;
      }
      return await res.text();
    } catch {
      if (attempt === maxAttempts) return null;
      // brief pause before retry
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
  return null;
}

// Returns true only when the HTML contains a <script> tag that references
// seoranko.js AND carries the expected data-site-id value.
function checkScript(html: string, siteId: string): { hasScript: boolean; hasCorrectId: boolean } {
  // Find every <script ... > tag in the document
  const scriptTagRe = /<script\b[^>]*>/gi;
  let hasScript = false;
  let hasCorrectId = false;
  let match: RegExpExecArray | null;

  while ((match = scriptTagRe.exec(html)) !== null) {
    const tag = match[0];
    if (!tag.includes('seoranko.js')) continue;
    hasScript = true;
    // Check data-site-id attribute — accept both single and double quotes
    const idRe = /data-site-id=["']([^"']+)["']/i;
    const idMatch = idRe.exec(tag);
    if (idMatch && idMatch[1].trim().toLowerCase() === siteId) {
      hasCorrectId = true;
      break;
    }
  }

  return { hasScript, hasCorrectId };
}

async function markVerified(siteId: string): Promise<void> {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } }
    );
    await supabase
      .from('seo_sites')
      .upsert(
        { site_id: siteId, domain: siteId, verified: true },
        { onConflict: 'site_id', ignoreDuplicates: false }
      );
  } catch {
    // Non-fatal — verification result is still returned to the caller
  }
}

export async function GET(req: NextRequest) {
  const rawDomain = req.nextUrl.searchParams.get('domain')?.trim();
  if (!rawDomain) {
    return NextResponse.json({ verified: false, reason: 'site_unreachable' as Reason });
  }

  const siteId = normalizeSiteId(rawDomain);
  const url = `https://${siteId}`;

  const html = await fetchHomepage(url);

  if (!html) {
    return NextResponse.json({ verified: false, reason: 'site_unreachable' as Reason });
  }

  const { hasScript, hasCorrectId } = checkScript(html, siteId);

  if (!hasScript) {
    return NextResponse.json({ verified: false, reason: 'script_not_found' as Reason });
  }

  if (!hasCorrectId) {
    return NextResponse.json({ verified: false, reason: 'wrong_site_id' as Reason });
  }

  // Script found with the correct site ID — mark verified in DB
  await markVerified(siteId);
  return NextResponse.json({ verified: true });
}
