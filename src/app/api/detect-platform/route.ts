import { NextRequest, NextResponse } from 'next/server';

export interface DetectedPlatform {
  platform: 'wordpress' | 'shopify' | 'wix' | 'squarespace' | 'webflow' | 'nextjs' | 'ghost' | 'html';
  confidence: 'high' | 'medium' | 'low';
  installMethod: 'plugin' | 'app' | 'github_pr' | 'snippet';
  name: string;
}

const INSTALL_METHODS: Record<DetectedPlatform['platform'], DetectedPlatform['installMethod']> = {
  wordpress:   'plugin',
  shopify:     'app',
  nextjs:      'github_pr',
  ghost:       'snippet',
  wix:         'snippet',
  squarespace: 'snippet',
  webflow:     'snippet',
  html:        'snippet',
};

const PLATFORM_NAMES: Record<DetectedPlatform['platform'], string> = {
  wordpress:   'WordPress',
  shopify:     'Shopify',
  wix:         'Wix',
  squarespace: 'Squarespace',
  webflow:     'Webflow',
  nextjs:      'Next.js',
  ghost:       'Ghost',
  html:        'HTML / Custom',
};

function detect(html: string, headers: Headers): DetectedPlatform['platform'] {
  // WordPress
  if (
    html.includes('/wp-content/') ||
    html.includes('/wp-includes/') ||
    html.includes('wp-json') ||
    /generator.*WordPress/i.test(html)
  ) return 'wordpress';

  // Shopify
  if (
    html.includes('cdn.shopify.com') ||
    html.includes('Shopify.theme') ||
    html.includes('/cdn/shop/')
  ) return 'shopify';

  // Wix
  if (
    html.includes('static.wixstatic.com') ||
    html.includes('wix.com') ||
    headers.get('x-wix-published-version') !== null
  ) return 'wix';

  // Squarespace
  if (
    html.includes('squarespace.com') ||
    html.includes('Static.SQUARESPACE') ||
    html.includes('squarespace-cdn.com')
  ) return 'squarespace';

  // Webflow
  if (
    html.includes('webflow.com') ||
    html.includes('data-wf-page') ||
    html.includes('assets.website-files.com')
  ) return 'webflow';

  // Next.js
  if (
    html.includes('__NEXT_DATA__') ||
    html.includes('/_next/')
  ) return 'nextjs';

  // Ghost
  if (
    html.includes('/ghost/') ||
    /generator.*Ghost/i.test(html)
  ) return 'ghost';

  return 'html';
}

export async function GET(req: NextRequest) {
  const domain = new URL(req.url).searchParams.get('domain')?.trim();
  if (!domain) {
    return NextResponse.json({ error: 'domain is required' }, { status: 400 });
  }

  const url = domain.startsWith('http') ? domain : `https://${domain}`;

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SEORANKO-Detect/1.0)' },
      signal: AbortSignal.timeout(8000),
      redirect: 'follow',
    });

    const html = await res.text();
    const platform = detect(html.slice(0, 50000), res.headers);

    const result: DetectedPlatform = {
      platform,
      confidence: platform === 'html' ? 'low' : 'high',
      installMethod: INSTALL_METHODS[platform],
      name: PLATFORM_NAMES[platform],
    };

    return NextResponse.json(result);
  } catch {
    return NextResponse.json({
      platform: 'html',
      confidence: 'low',
      installMethod: 'snippet',
      name: 'HTML / Custom',
    } satisfies DetectedPlatform);
  }
}
