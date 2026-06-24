import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const domain = req.nextUrl.searchParams.get('domain')?.trim();
  if (!domain) return NextResponse.json({ found: false });

  const url = `https://${domain.replace(/^https?:\/\//, '')}`;

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SEORANKO-Verify/1.0)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return NextResponse.json({ found: false });
    const html = await res.text();
    const found = html.includes('seoranko.js');
    return NextResponse.json({ found });
  } catch {
    return NextResponse.json({ found: false });
  }
}
