/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';

const BRANCH = 'seoranko-install';
const SNIPPET_BASE = 'https://seoranko.com/seoranko.js';

// ── GitHub REST helpers ────────────────────────────────────────────────────────

function ghHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
}

async function ghGet(path: string, token: string) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: ghHeaders(token),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GitHub ${res.status} on GET ${path}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function ghPost(path: string, token: string, body: any) {
  const res = await fetch(`https://api.github.com${path}`, {
    method: 'POST',
    headers: ghHeaders(token),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GitHub ${res.status} on POST ${path}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function ghPut(path: string, token: string, body: any) {
  const res = await fetch(`https://api.github.com${path}`, {
    method: 'PUT',
    headers: ghHeaders(token),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GitHub ${res.status} on PUT ${path}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

// ── Layout file candidates per framework ──────────────────────────────────────

const LAYOUT_CANDIDATES = [
  // Next.js App Router
  { path: 'src/app/layout.tsx', type: 'nextjs-app' },
  { path: 'src/app/layout.jsx', type: 'nextjs-app' },
  { path: 'app/layout.tsx',     type: 'nextjs-app' },
  { path: 'app/layout.jsx',     type: 'nextjs-app' },
  // Next.js Pages Router
  { path: 'pages/_document.tsx', type: 'nextjs-pages' },
  { path: 'pages/_document.jsx', type: 'nextjs-pages' },
  { path: 'src/pages/_document.tsx', type: 'nextjs-pages' },
  { path: 'src/pages/_document.jsx', type: 'nextjs-pages' },
  // Astro
  { path: 'src/layouts/Layout.astro',     type: 'astro' },
  { path: 'src/layouts/BaseLayout.astro', type: 'astro' },
  { path: 'src/layouts/Base.astro',       type: 'astro' },
  // Plain HTML
  { path: 'index.html', type: 'html' },
  { path: 'public/index.html', type: 'html' },
];

// ── Script insertion ───────────────────────────────────────────────────────────

function buildScriptTag(siteId: string, indent = '  '): string {
  return `${indent}<script src="${SNIPPET_BASE}" data-site-id="${siteId}" async></script>`;
}

function insertScript(content: string, siteId: string, layoutType: string): string {
  const tag = buildScriptTag(siteId);

  // Already installed?
  if (content.includes('seoranko.js')) return content;

  // Next.js Pages Router — insert before </Head> (Next.js Head component)
  if (layoutType === 'nextjs-pages' && content.includes('</Head>')) {
    return content.replace('</Head>', `${tag}\n      </Head>`);
  }

  // Explicit </head> tag
  if (content.includes('</head>')) {
    return content.replace('</head>', `${tag}\n    </head>`);
  }

  // Next.js App Router layout — may have <head> component or implicit head.
  // Look for opening <head> tag and insert after it.
  if (content.includes('<head>')) {
    return content.replace('<head>', `<head>\n      ${tag}`);
  }

  // No <head> at all — insert before <body (common in App Router without explicit head)
  if (content.includes('<body')) {
    return content.replace('<body', `<head>\n      ${tag}\n    </head>\n    <body`);
  }

  // Astro / fallback — append before </html>
  if (content.includes('</html>')) {
    return content.replace('</html>', `  ${tag}\n</html>`);
  }

  // Last resort: prepend
  return tag + '\n' + content;
}

// ── MAIN HANDLER ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { repo, token, site_id } = await req.json();

    if (!repo || !token || !site_id) {
      return NextResponse.json({ error: 'repo, token, site_id are required' }, { status: 400 });
    }
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
      return NextResponse.json({ error: 'repo must be in owner/repo format' }, { status: 400 });
    }

    // 1. Get default branch and HEAD SHA
    const repoData = await ghGet(`/repos/${repo}`, token);
    const defaultBranch: string = repoData.default_branch || 'main';
    const refData = await ghGet(`/repos/${repo}/git/ref/heads/${defaultBranch}`, token);
    const headSha: string = refData.object.sha;

    // 2. Create (or reset) the seoranko-install branch
    let branchExists = false;
    try {
      await ghGet(`/repos/${repo}/git/ref/heads/${BRANCH}`, token);
      branchExists = true;
    } catch { /* branch doesn't exist yet */ }

    if (branchExists) {
      // Force-update existing branch to HEAD of default branch
      await fetch(`https://api.github.com/repos/${repo}/git/refs/heads/${BRANCH}`, {
        method: 'PATCH',
        headers: ghHeaders(token),
        body: JSON.stringify({ sha: headSha, force: true }),
        signal: AbortSignal.timeout(10000),
      });
    } else {
      await ghPost(`/repos/${repo}/git/refs`, token, {
        ref: `refs/heads/${BRANCH}`,
        sha: headSha,
      });
    }

    // 3. Detect layout file
    let layoutFile: { path: string; type: string } | null = null;
    let fileContent = '';
    let fileSha = '';

    for (const candidate of LAYOUT_CANDIDATES) {
      try {
        const data = await ghGet(`/repos/${repo}/contents/${candidate.path}?ref=${BRANCH}`, token);
        fileContent = Buffer.from(data.content, 'base64').toString('utf-8');
        fileSha = data.sha;
        layoutFile = candidate;
        break;
      } catch { /* file not found, try next */ }
    }

    if (!layoutFile) {
      return NextResponse.json({
        error: 'Could not find a layout file. Supported: Next.js App Router (layout.tsx), Pages Router (_document.tsx), Astro (layouts/*.astro), or index.html.',
      }, { status: 422 });
    }

    // 4. Check if already installed
    if (fileContent.includes('seoranko.js')) {
      return NextResponse.json({ error: `SEORANKO is already installed in ${layoutFile.path}` }, { status: 409 });
    }

    // 5. Insert script and commit
    const updatedContent = insertScript(fileContent, site_id, layoutFile.type);
    const encodedContent = Buffer.from(updatedContent).toString('base64');

    await ghPut(`/repos/${repo}/contents/${layoutFile.path}`, token, {
      message: `Install SEORANKO SEO auto-fix script into ${layoutFile.path}`,
      content: encodedContent,
      sha: fileSha,
      branch: BRANCH,
    });

    // 6. Open pull request
    const pr = await ghPost(`/repos/${repo}/pulls`, token, {
      title: 'Install SEORANKO SEO auto-fix',
      head: BRANCH,
      base: defaultBranch,
      body: `## Install SEORANKO SEO Auto-Fix

This PR adds the SEORANKO script tag to \`${layoutFile.path}\`.

**What it does:**
- Loads asynchronously — zero impact on page speed or Lighthouse score
- Fetches active SEO fixes for each page from SEORANKO's CDN (cached 60s)
- Applies fixes in milliseconds: page title, meta description, H1, canonical URL, Open Graph tags, Twitter cards, schema markup
- Fixes are managed from your SEORANKO dashboard — no further code changes needed

**The change:**
Added one \`<script>\` tag inside \`<head>\` in \`${layoutFile.path}\`.

Merge this PR then deploy to activate real-time SEO fixes on your site.`,
    });

    return NextResponse.json({ pr_url: pr.html_url });

  } catch (e: any) {
    console.error('[install/github-pr]', e.message);
    return NextResponse.json({ error: e.message || 'Failed to open PR' }, { status: 500 });
  }
}
