import { NextRequest, NextResponse } from 'next/server';
import { humanizeArticle } from '@/lib/humanizer';

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

    return NextResponse.json(result);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[humanize]', err);
    return NextResponse.json({ error: err?.message || 'Humanization failed' }, { status: 500 });
  }
}
