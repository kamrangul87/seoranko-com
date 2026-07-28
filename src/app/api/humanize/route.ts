import { NextRequest, NextResponse } from 'next/server';
import { humanizeArticle } from '@/lib/humanizer';
import { checkContentIdentity } from '@/lib/content-identity-guard';

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { html = '', keyword = '', level = 'medium' } = body;

    if (!html.trim()) {
      return NextResponse.json({ error: 'html is required' }, { status: 400 });
    }

    if (!['light', 'medium', 'aggressive'].includes(level)) {
      return NextResponse.json({ error: 'level must be light, medium, or aggressive' }, { status: 400 });
    }

    const result = await humanizeArticle(html, {
      level: level as 'light' | 'medium' | 'aggressive',
      primaryKeyword: keyword,
    });

    // Content identity guard — humanising must not swap in a different document.
    const identityCheck = checkContentIdentity(html, null, result.humanizedHtml, null);

    if (!identityCheck.isSameDocument) {
      console.error('[humanize] identity guard blocked result', {
        similarityScore: identityCheck.similarityScore
      });
      return NextResponse.json({
        blocked: true,
        warning: identityCheck.warning,
        similarityScore: identityCheck.similarityScore
      }, { status: 200 });
    }

    return NextResponse.json({
      ...result,
      warning: identityCheck.warning,
      similarityScore: identityCheck.similarityScore
    });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[humanize]', err);
    return NextResponse.json({ error: err?.message || 'Humanization failed' }, { status: 500 });
  }
}
