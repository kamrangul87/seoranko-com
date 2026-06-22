/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { urls, domain, githubRepo, githubToken, githubBranch } = body;

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return NextResponse.json({ error: 'urls array is required' }, { status: 400 });
    }

    const baseUrl = domain
      ? `https://${(domain as string).replace(/^https?:\/\//, '').replace(/\/$/, '')}`
      : '';
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    const urlEntries = urls
      .map((url: string, i: number) => {
        const isHome = baseUrl && (url === baseUrl || url === `${baseUrl}/`);
        const priority = isHome || i === 0 ? '1.0' : '0.8';
        const changefreq = isHome || i === 0 ? 'daily' : 'weekly';
        const safeUrl = url.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `  <url>
    <loc>${safeUrl}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
      })
      .join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        xsi:schemaLocation="http://www.sitemaps.org/schemas/sitemap/0.9
        http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd">
${urlEntries}
</urlset>`;

    // Push to GitHub if credentials provided
    if (githubRepo && githubToken) {
      try {
        const repoVal = (githubRepo as string).replace(/^https?:\/\/(www\.)?github\.com\//, '');
        const slashIdx = repoVal.indexOf('/');
        const owner = repoVal.slice(0, slashIdx);
        const repo = repoVal.slice(slashIdx + 1);
        const branch = (githubBranch as string) || 'main';
        const filePath = 'public/sitemap.xml';

        const headers: Record<string, string> = {
          Authorization: `token ${githubToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/vnd.github.v3+json',
        };

        let sha = '';
        const getRes = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`,
          { headers, signal: AbortSignal.timeout(8000) }
        );
        if (getRes.ok) {
          const existing = await getRes.json();
          sha = existing.sha;
        }

        const pushBody: any = {
          message: `SEO: update sitemap.xml (${urls.length} URLs) via SEORANKO`,
          content: Buffer.from(xml).toString('base64'),
          branch,
        };
        if (sha) pushBody.sha = sha;

        const pushRes = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`,
          { method: 'PUT', headers, body: JSON.stringify(pushBody), signal: AbortSignal.timeout(10000) }
        );

        if (pushRes.ok) {
          return NextResponse.json({
            success: true,
            xml,
            pushed: true,
            path: `${owner}/${repo}/${filePath}`,
          });
        }
        const pushErr = await pushRes.json().catch(() => ({}));
        return NextResponse.json({
          success: true,
          xml,
          pushed: false,
          pushError: pushErr.message || `GitHub ${pushRes.status}`,
        });
      } catch (err: any) {
        return NextResponse.json({
          success: true,
          xml,
          pushed: false,
          pushError: err.message,
        });
      }
    }

    return NextResponse.json({ success: true, xml });
  } catch (error: any) {
    console.error('[generate-sitemap]', error);
    return NextResponse.json({ error: error.message || 'Generate failed' }, { status: 500 });
  }
}
