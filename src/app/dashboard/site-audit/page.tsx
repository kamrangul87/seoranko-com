/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';
import { useState, useEffect, useRef } from 'react';

const PLATFORMS = [
  {
    id: 'github', icon: '🐙', name: 'GitHub', desc: 'Static / Next.js', color: '#24292f',
    fields: [
      { key: 'repo', label: 'Repository (owner/repo)', placeholder: 'e.g. kamrangul87/my-website', type: 'text', hint: 'Must be owner/repo format — not a full URL' },
      { key: 'branch', label: 'Branch', placeholder: 'main', type: 'text', hint: '' },
      { key: 'token', label: 'Personal Access Token', placeholder: 'ghp_xxxxxxxxxxxx', type: 'password', hint: 'github.com/settings/tokens → repo → contents' },
      { key: 'path', label: 'File path in repo (optional)', placeholder: 'content/blog/article.html', type: 'text', hint: 'Leave blank to auto-generate from keyword slug' },
    ],
  },
  {
    id: 'wordpress', icon: '🌐', name: 'WordPress', desc: 'Self-hosted / .com', color: '#21759b',
    fields: [
      { key: 'url', label: 'Site URL', placeholder: 'https://yoursite.com', type: 'text', hint: '' },
      { key: 'username', label: 'Username', placeholder: 'admin', type: 'text', hint: '' },
      { key: 'password', label: 'Application Password', placeholder: 'xxxx xxxx xxxx', type: 'password', hint: 'WP Admin → Users → Profile → Application Passwords' },
    ],
  },
  {
    id: 'shopify', icon: '🛍️', name: 'Shopify', desc: 'Shopify blogs', color: '#96bf48',
    fields: [
      { key: 'store', label: 'Store domain', placeholder: 'your-store.myshopify.com', type: 'text', hint: '' },
      { key: 'token', label: 'Admin API Token', placeholder: 'shpat_xxxxxxxxxxxx', type: 'password', hint: 'Shopify Admin → Settings → Apps → Develop apps' },
      { key: 'blogId', label: 'Blog ID', placeholder: '123456789', type: 'text', hint: '' },
    ],
  },
  {
    id: 'ghost', icon: '👻', name: 'Ghost', desc: 'Ghost CMS', color: '#212121',
    fields: [
      { key: 'url', label: 'Ghost URL', placeholder: 'https://yoursite.ghost.io', type: 'text', hint: '' },
      { key: 'adminKey', label: 'Admin API Key', placeholder: 'id:secret', type: 'password', hint: 'Ghost Admin → Settings → Integrations' },
    ],
  },
  {
    id: 'webflow', icon: '🔷', name: 'Webflow', desc: 'Webflow CMS', color: '#4353ff',
    fields: [
      { key: 'token', label: 'API Token', placeholder: 'Webflow API token', type: 'password', hint: 'Webflow Dashboard → Account → Integrations → API Access' },
      { key: 'collectionId', label: 'CMS Collection ID', placeholder: 'Collection ID', type: 'text', hint: '' },
    ],
  },
  {
    id: 'contentful', icon: '📦', name: 'Contentful', desc: 'Headless CMS', color: '#2478cc',
    fields: [
      { key: 'spaceId', label: 'Space ID', placeholder: 'Space ID', type: 'text', hint: 'Contentful → Settings → General settings' },
      { key: 'token', label: 'Management Token', placeholder: 'Content Management Token', type: 'password', hint: 'Contentful → Settings → API keys → Content management tokens' },
      { key: 'contentType', label: 'Content Type ID', placeholder: 'blogPost', type: 'text', hint: '' },
    ],
  },
  {
    id: 'wix', icon: '🔶', name: 'Wix', desc: 'Wix blog', color: '#faad4d',
    fields: [
      { key: 'apiKey', label: 'API Key', placeholder: 'Wix API Key', type: 'password', hint: 'Wix Dashboard → Settings → Advanced → API Keys' },
      { key: 'siteId', label: 'Site ID', placeholder: 'Wix Site ID', type: 'text', hint: '' },
    ],
  },
  {
    id: 'manual', icon: '📋', name: 'No CMS', desc: 'Copy HTML', color: '#6B7280',
    fields: [],
    noConnect: true,
  },
];

export default function SiteAuditPage() {
  const [stage, setStage] = useState<'connect' | 'audit' | 'results'>('connect');

  // Stage 1 — platform connection
  const [selectedPlatform, setSelectedPlatform] = useState<string>('manual');
  const [platformFields, setPlatformFields] = useState<Record<string, string>>({});
  const [connecting, setConnecting] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'ok' | 'error'>('idle');
  const [connectionMsg, setConnectionMsg] = useState('');

  // Stage 2 — audit
  const [mode, setMode] = useState<'domain' | 'manual'>('domain');
  const [domain, setDomain] = useState('');
  const [urls, setUrls] = useState('');
  const [market, setMarket] = useState('United Kingdom');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState('');
  const [error, setError] = useState('');
  const [results, setResults] = useState<any>(null);
  const [discoverySource, setDiscoverySource] = useState('');
  const [discoveryError, setDiscoveryError] = useState('');
  const [expandedUrl, setExpandedUrl] = useState<string | null>(null);

  // Stage 3 — fix panel
  const [fixing, setFixing] = useState(false);
  const [fixResult, setFixResult] = useState<any>(null);
  const [showFixPanel, setShowFixPanel] = useState(false);
  const [fixingPage, setFixingPage] = useState<any>(null);
  const [fixStep, setFixStep] = useState(0);
  const [fixStageLabel, setFixStageLabel] = useState('');
  const [publishMode, setPublishMode] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishSuccess, setPublishSuccess] = useState('');

  // Generate sitemap state
  const [sitemapXml, setSitemapXml] = useState<string | null>(null);
  const [generatingSitemap, setGeneratingSitemap] = useState(false);
  const [sitemapMsg, setSitemapMsg] = useState('');

  // Score simulation (local update after fix)
  const [scoreSimMsg, setScoreSimMsg] = useState<string>('');

  // Last audit timestamp (from Supabase)
  const [lastAuditedAt, setLastAuditedAt] = useState<string | null>(null);

  // Ref so the auto-load effect only fires once on mount
  const didAutoLoad = useRef(false);

  // ── Persist domain/market to localStorage ──────────────────────────────────
  useEffect(() => {
    if (domain) localStorage.setItem('seoranko_audit_domain', domain);
  }, [domain]);
  useEffect(() => {
    localStorage.setItem('seoranko_audit_market', market);
  }, [market]);

  // ── On mount: restore last domain and auto-load from Supabase ─────────────
  useEffect(() => {
    if (didAutoLoad.current) return;
    didAutoLoad.current = true;

    const savedDomain = localStorage.getItem('seoranko_audit_domain') || '';
    const savedMarket = localStorage.getItem('seoranko_audit_market') || 'United Kingdom';
    if (!savedDomain) return;

    setDomain(savedDomain);
    setMarket(savedMarket);
    setStage('audit');
    setLoading(true);
    setProgress(30);
    setProgressLabel(`Loading saved results for ${savedDomain}...`);

    fetch('/api/site-audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: savedDomain, market: savedMarket, mode: 'cached' }),
    })
      .then(res => res.json())
      .then((data: any) => {
        if (data.success && data.results?.length > 0) {
          setProgress(100);
          setProgressLabel('Loaded!');
          setDiscoverySource(data.discoverySource || '');
          setDiscoveryError(data.discoveryError || '');
          setResults(data);
          if (data.lastAuditedAt) setLastAuditedAt(data.lastAuditedAt);
          setStage('results');
        }
      })
      .catch(() => { /* no saved data — stay on audit stage */ })
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function simulateScoreUpdate(page: any, data: any) {
    if (!results?.results || !data.fixedIssues?.length) return;

    const ISSUE_PATTERNS: Record<string, string[]> = {
      missing_title:            ['Missing title tag'],
      missing_h1:               ['Missing H1'],
      missing_meta_description: ['Missing meta description'],
      no_schema:                ['No structured data'],
      thin_content:             ['Thin content:', 'Low word count:'],
      no_internal_links:        ['No internal links'],
      missing_og_tags:          ['Missing Open Graph'],
      page_not_found:           ['Page not found (404)'],
    };

    const patternsToRemove: string[] = (data.fixedIssues as string[])
      .flatMap(key => ISSUE_PATTERNS[key] || []);

    const updatedPages = results.results.map((r: any) => {
      if (r.url !== page.url) return r;

      if (data.simulatedScore != null) {
        const estimatedWords = data.avgCompetitorWords
          ? Math.max(data.avgCompetitorWords, 1200)
          : Math.max(r.wordCount, 1500);
        return {
          ...r,
          score: data.simulatedScore,
          scoreBeforeFix: data.scoreBeforeFix ?? r.score,
          scoreAfterFix: data.simulatedScore,
          issues: [],
          hasSchema: true,
          hasFaq: true,
          httpStatus: 200,
          wordCount: estimatedWords,
          title: r.title || data.keyword || 'New page',
          fixedIssues: data.fixedIssues,
          status: 'fixed',
        };
      }

      const remainingIssues = r.issues.filter((iss: any) =>
        !patternsToRemove.some(pat => iss.message.startsWith(pat))
      );
      const newScore = Math.min(100, r.score + (data.scoreGain || 0));
      return {
        ...r,
        score: newScore,
        scoreBeforeFix: data.scoreBeforeFix ?? r.score,
        scoreAfterFix: data.scoreAfterFix ?? newScore,
        issues: remainingIssues,
        hasSchema: data.fixedIssues.includes('no_schema') ? true : r.hasSchema,
        fixedIssues: data.fixedIssues,
        status: 'fixed',
      };
    });

    const avg = Math.round(updatedPages.reduce((a: number, b: any) => a + b.score, 0) / updatedPages.length);
    setResults({
      ...results,
      results: updatedPages,
      summary: {
        ...results.summary,
        avgScore: avg,
        criticalIssues: updatedPages.filter((r: any) => r.score < 30).length,
        pagesNeedingAttention: updatedPages.filter((r: any) => r.score < 70).length,
        pagesWithSchema: updatedPages.filter((r: any) => r.hasSchema).length,
      },
    });

    setScoreSimMsg(
      data.commitUrl
        ? `✅ Fixed and pushed to GitHub${data.redeployTriggered ? ' · Vercel redeploy triggered' : ''} — scores updated. Deploy your site to make changes live.`
        : '✅ Content generated — scores updated. Publish to apply changes.'
    );
  }

  async function handleGenerateSitemap() {
    if (!results?.results) return;
    setGeneratingSitemap(true);
    setSitemapXml(null);
    setSitemapMsg('');
    const urls = results.results.map((r: any) => r.url);
    const githubConnected = selectedPlatform === 'github' && platformFields['github_repo'] && platformFields['github_token'];
    try {
      const res = await fetch('/api/site-audit/generate-sitemap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          urls,
          domain,
          ...(githubConnected ? {
            githubRepo: platformFields['github_repo'],
            githubToken: platformFields['github_token'],
            githubBranch: platformFields['github_branch'] || 'main',
          } : {}),
        }),
      });
      const data = await res.json();
      if (data.error) { setSitemapMsg('❌ ' + data.error); return; }
      setSitemapXml(data.xml);
      if (data.pushed) setSitemapMsg(`✅ Pushed to ${data.path}`);
    } catch (err: any) {
      setSitemapMsg('❌ ' + err.message);
    } finally {
      setGeneratingSitemap(false);
    }
  }

  function downloadSitemap() {
    if (!sitemapXml) return;
    const blob = new Blob([sitemapXml], { type: 'application/xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'sitemap.xml';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const pf = (key: string) => platformFields[`${selectedPlatform}_${key}`] || '';
  const setPf = (key: string, val: string) =>
    setPlatformFields(prev => ({ ...prev, [`${selectedPlatform}_${key}`]: val }));

  const getFixField = (platformId: string, key: string) =>
    platformFields[`${platformId}_${key}`] || '';

  // ── Stage 1: Test connection ───────────────────────────────────────────────
  async function handleConnect() {
    const plat = PLATFORMS.find(p => p.id === selectedPlatform);
    if (!plat) return;

    if (plat.noConnect || selectedPlatform === 'manual') {
      setConnectionStatus('ok');
      setConnectionMsg('No connection needed — you can copy the HTML after fixing.');
      setStage('audit');
      return;
    }

    setConnecting(true);
    setConnectionStatus('idle');
    setConnectionMsg('');

    try {
      if (selectedPlatform === 'github') {
        const repoVal = pf('repo').trim().replace(/^https?:\/\/(www\.)?github\.com\//, '');
        const token = pf('token').trim();
        if (!repoVal) throw new Error('Repository is required — enter in owner/repo format');
        if (!repoVal.includes('/')) throw new Error('Repository must be in owner/repo format (e.g. kamrangul87/my-website), not just the repo name');
        const slashIdx = repoVal.indexOf('/');
        const owner = repoVal.slice(0, slashIdx);
        const repo = repoVal.slice(slashIdx + 1);
        if (!owner || !repo) throw new Error('Repository must be in owner/repo format (e.g. kamrangul87/my-website)');
        if (!token) throw new Error('Personal Access Token is required — paste the ghp_... token from GitHub Settings → Developer settings → Personal access tokens');
        const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
          headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' },
        });
        if (!res.ok) throw new Error(`GitHub: ${res.status} — check repo name and token permissions (needs repo scope)`);
        const data = await res.json();
        setConnectionStatus('ok');
        setConnectionMsg(`Connected to ${data.full_name} (${data.visibility})`);

      } else if (selectedPlatform === 'wordpress') {
        if (!pf('url') || !pf('username') || !pf('password')) throw new Error('Fill in all WordPress fields');
        const base = pf('url').replace(/\/$/, '');
        const res = await fetch(`${base}/wp-json/wp/v2/users/me`, {
          headers: { Authorization: `Basic ${btoa(`${pf('username')}:${pf('password')}`) }` },
        });
        if (!res.ok) throw new Error(`WordPress: ${res.status} — check URL and Application Password`);
        const data = await res.json();
        setConnectionStatus('ok');
        setConnectionMsg(`Connected as ${data.name} on ${pf('url')}`);

      } else if (selectedPlatform === 'shopify') {
        if (!pf('store') || !pf('token')) throw new Error('Fill in store and token');
        const store = pf('store').replace(/^https?:\/\//, '').replace(/\/$/, '');
        const res = await fetch(`https://${store}/admin/api/2024-01/shop.json`, {
          headers: { 'X-Shopify-Access-Token': pf('token') },
        });
        if (!res.ok) throw new Error(`Shopify: ${res.status} — check store and token`);
        const data = await res.json();
        setConnectionStatus('ok');
        setConnectionMsg(`Connected to ${data.shop?.name || store}`);

      } else {
        // Ghost, Webflow, Contentful, Wix — assume connected if fields filled
        const plat2 = PLATFORMS.find(p => p.id === selectedPlatform);
        const allFilled = plat2?.fields.every(f => platformFields[`${selectedPlatform}_${f.key}`]);
        if (!allFilled) throw new Error('Fill in all fields');
        setConnectionStatus('ok');
        setConnectionMsg(`${plat2?.name} credentials saved — connection will be verified on publish.`);
      }

      setTimeout(() => setStage('audit'), 800);
    } catch (err: any) {
      setConnectionStatus('error');
      setConnectionMsg(err.message);
    } finally {
      setConnecting(false);
    }
  }

  // ── Stage 2: Run audit ─────────────────────────────────────────────────────
  async function handleAudit(auditMode: 'smart' | 'cached' | 'fresh' = 'smart') {
    if (mode === 'domain' && !domain.trim()) { setError('Please enter a domain'); return; }
    if (mode === 'manual') {
      const list = urls.split('\n').map(u => u.trim()).filter(Boolean);
      if (list.length === 0) { setError('Please paste at least one URL'); return; }
      if (list.length > 20) { setError('Maximum 20 URLs'); return; }
    }

    setLoading(true);
    setError('');
    setResults(null);
    setDiscoverySource('');
    setDiscoveryError('');
    setScoreSimMsg('');
    setProgress(5);
    setProgressLabel(
      auditMode === 'cached'
        ? `Loading cached results for ${domain}...`
        : auditMode === 'fresh'
        ? `Rescraping all pages on ${domain}...`
        : mode === 'domain' ? `Discovering pages on ${domain}...` : 'Starting audit...'
    );

    const stages = auditMode === 'cached'
      ? [
          { pct: 40, label: 'Loading from database...' },
          { pct: 80, label: 'Applying fix overrides...' },
          { pct: 95, label: 'Building report...' },
        ]
      : auditMode === 'fresh'
      ? [
          { pct: 15, label: 'Reading sitemap.xml...' },
          { pct: 35, label: 'Fetching all pages fresh...' },
          { pct: 55, label: 'Analysing SEO signals...' },
          { pct: 72, label: 'Detecting target keywords...' },
          { pct: 88, label: 'Building audit report...' },
        ]
      : [
          { pct: 20, label: 'Reading sitemap.xml...' },
          { pct: 40, label: 'Fetching non-fixed pages...' },
          { pct: 60, label: 'Analysing EEAT signals...' },
          { pct: 75, label: 'Detecting target keywords...' },
          { pct: 88, label: 'Building audit report...' },
        ];
    let si = 0;
    const interval = setInterval(() => {
      if (si < stages.length) { setProgress(stages[si].pct); setProgressLabel(stages[si].label); si++; }
    }, 5000);

    try {
      const payload = mode === 'domain'
        ? { domain: domain.trim(), market, mode: auditMode }
        : { urls: urls.split('\n').map((u: string) => u.trim()).filter(Boolean), market };

      const res = await fetch('/api/site-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      clearInterval(interval);

      if (!res.ok) { setError('Audit failed: ' + (await res.text()).slice(0, 200)); return; }
      const data = await res.json();
      if (data.error) { setError(data.error); return; }

      setProgress(100);
      setProgressLabel('Audit complete!');
      setDiscoverySource(data.discoverySource || '');
      setDiscoveryError(data.discoveryError || '');
      setResults(data);
      if (data.lastAuditedAt) setLastAuditedAt(data.lastAuditedAt);
      setStage('results');
    } catch (err: any) {
      clearInterval(interval);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // ── Stage 3: Create Next.js page (for 404 routes) ─────────────────────────
  async function handleCreatePage(page: any) {
    setFixing(true);
    setFixResult(null);
    setFixingPage(page);
    setShowFixPanel(true);
    setFixStep(0);
    setFixStageLabel(FIX_STEPS[0]);
    setPublishMode(null);
    setPublishSuccess('');
    setScoreSimMsg('');

    const delays = [3000, 8000, 14000, 20000];
    const timers = delays.map((delay, i) =>
      setTimeout(() => { setFixStep(i + 1); setFixStageLabel(FIX_STEPS[i + 1]); }, delay)
    );

    try {
      const res = await fetch('/api/site-audit/fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: page.url,
          detectedKeyword: page.aiAnalysis?.detectedKeyword || page.h1 || page.title || '',
          issues: page.issues || [],
          market,
          pageScore: page.score,
          fallbackTitle: page.title || '',
          fallbackH1: page.h1 || '',
          fallbackMetaDescription: page.metaDescription || '',
          fallbackH2s: page.h2s || [],
          createNextjs: true,
          ...(selectedPlatform === 'github' && platformFields['github_repo'] ? {
            githubRepo: platformFields['github_repo'],
            githubToken: platformFields['github_token'],
            githubBranch: platformFields['github_branch'] || 'main',
          } : {}),
        }),
      });
      timers.forEach(t => clearTimeout(t));

      if (!res.ok) {
        let msg = 'Create failed';
        try { const d = await res.json(); msg = d.error || msg; } catch { msg = await res.text().catch(() => msg); }
        setFixStageLabel('❌ ' + msg.slice(0, 150));
        setFixStep(-1);
        return;
      }

      let data: any;
      try { data = await res.json(); } catch { setFixStageLabel('❌ Invalid response'); setFixStep(-1); return; }
      if (data.error) { setFixStageLabel('❌ ' + data.error); setFixStep(-1); return; }

      setFixStep(5);
      setFixStageLabel('');
      setFixResult(data);
      simulateScoreUpdate(page, data);
    } catch (err: any) {
      timers.forEach(t => clearTimeout(t));
      setFixStageLabel('❌ ' + err.message);
      setFixStep(-1);
    } finally {
      setFixing(false);
    }
  }

  // ── Stage 3: Fix page ──────────────────────────────────────────────────────
  const FIX_STEPS = [
    'Fetching page content...',
    'Finding low KD keyword opportunities...',
    'Analysing top 3 competitors...',
    'Building improvement brief...',
    'Generating optimised content...',
  ];

  async function handleFixPage(page: any) {
    setFixing(true);
    setFixResult(null);
    setFixingPage(page);
    setShowFixPanel(true);
    setFixStep(0);
    setFixStageLabel(FIX_STEPS[0]);
    setPublishMode(null);
    setPublishSuccess('');
    setScoreSimMsg('');

    const delays = [3000, 8000, 14000, 20000];
    const timers = delays.map((delay, i) =>
      setTimeout(() => { setFixStep(i + 1); setFixStageLabel(FIX_STEPS[i + 1]); }, delay)
    );

    try {
      const res = await fetch('/api/site-audit/fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: page.url,
          detectedKeyword: page.aiAnalysis?.detectedKeyword || page.h1 || page.title || '',
          issues: page.issues || [],
          market,
          pageScore: page.score,
          fallbackTitle: page.title || '',
          fallbackH1: page.h1 || '',
          fallbackMetaDescription: page.metaDescription || '',
          fallbackH2s: page.h2s || [],
          fallbackWordCount: page.wordCount || 0,
          ...(selectedPlatform === 'github' && platformFields['github_repo'] ? {
            githubRepo: platformFields['github_repo'],
            githubToken: platformFields['github_token'],
            githubBranch: platformFields['github_branch'] || 'main',
            fixExistingNextjs: true,
          } : {}),
        }),
      });
      timers.forEach(t => clearTimeout(t));

      if (!res.ok) {
        let msg = 'Fix failed';
        try { const d = await res.json(); msg = d.error || msg; } catch { msg = await res.text().catch(() => msg); }
        setFixStageLabel('❌ ' + msg.slice(0, 150));
        setFixStep(-1);
        return;
      }

      let data: any;
      try { data = await res.json(); } catch { setFixStageLabel('❌ Invalid response'); setFixStep(-1); return; }
      if (data.error) { setFixStageLabel('❌ ' + data.error); setFixStep(-1); return; }

      setFixStep(5);
      setFixStageLabel('');
      setFixResult(data);
      simulateScoreUpdate(page, data);
    } catch (err: any) {
      timers.forEach(t => clearTimeout(t));
      setFixStageLabel('❌ ' + err.message);
      setFixStep(-1);
    } finally {
      setFixing(false);
    }
  }

  // ── Publish ────────────────────────────────────────────────────────────────
  async function handlePublish(platformId: string, articleHtml: string, fr: any) {
    setPublishing(true);
    setPublishSuccess('');
    const f = (key: string) => getFixField(platformId, key);
    const titleMatch = articleHtml.match(/<h1[^>]*>([^<]*)<\/h1>/i);
    const title = titleMatch?.[1]?.replace(/<[^>]+>/g, '').trim() || fr?.keyword || 'Improved Article';
    const kwSlug = fr?.keyword?.toLowerCase().replace(/[^a-z0-9]+/g, '-') || '';

    try {
      if (platformId === 'manual') {
        await navigator.clipboard.writeText(articleHtml);
        setPublishSuccess('✅ HTML copied to clipboard!');
        setTimeout(() => setPublishSuccess(''), 3000);
        return;
      }

      if (platformId === 'github') {
        const repoVal = f('repo').trim().replace(/^https?:\/\/(www\.)?github\.com\//, '');
        const slashIdx = repoVal.indexOf('/');
        const owner = repoVal.slice(0, slashIdx);
        const repo = repoVal.slice(slashIdx + 1);
        const token = f('token').trim();
        const branch = f('branch').trim() || 'main';
        const path = f('path').trim() || `content/${kwSlug}.html`;
        if (!owner || !repo || !token) { setPublishSuccess('❌ Connect GitHub first in Step 1 (repo must be owner/repo format)'); return; }
        const headers: Record<string, string> = {
          Authorization: `token ${token}`, 'Content-Type': 'application/json',
          Accept: 'application/vnd.github.v3+json',
        };
        let sha = '';
        try {
          const getRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`, { headers });
          if (getRes.ok) { const ex = await getRes.json(); sha = ex.sha; }
        } catch { /* new file */ }
        const body: any = { message: `SEO fix: ${title}`, content: btoa(unescape(encodeURIComponent(articleHtml))), branch };
        if (sha) body.sha = sha;
        const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, { method: 'PUT', headers, body: JSON.stringify(body) });
        if (res.ok) setPublishSuccess(`✅ Published to GitHub — ${f('repo')}/${path}`);
        else { const e = await res.json(); setPublishSuccess(`❌ GitHub: ${e.message}`); }

      } else if (platformId === 'wordpress') {
        const base = f('url').replace(/\/$/, '');
        const status = 'draft';
        const res = await fetch(`${base}/wp-json/wp/v2/posts`, {
          method: 'POST',
          headers: { Authorization: `Basic ${btoa(`${f('username')}:${f('password')}`)}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, content: articleHtml, status, slug: kwSlug }),
        });
        if (res.ok) { const post = await res.json(); setPublishSuccess(`✅ Saved as draft in WordPress — post ID ${post.id}`); }
        else { const e = await res.json().catch(() => ({})); setPublishSuccess(`❌ WordPress: ${e.message || 'Check credentials'}`); }

      } else if (platformId === 'shopify') {
        const store = f('store').replace(/^https?:\/\//, '').replace(/\/$/, '');
        const res = await fetch(`https://${store}/admin/api/2024-01/blogs/${f('blogId')}/articles.json`, {
          method: 'POST',
          headers: { 'X-Shopify-Access-Token': f('token'), 'Content-Type': 'application/json' },
          body: JSON.stringify({ article: { title, body_html: articleHtml, published: false } }),
        });
        if (res.ok) { const d = await res.json(); setPublishSuccess(`✅ Saved to Shopify as draft — ID ${d.article?.id}`); }
        else { const e = await res.json().catch(() => ({})); setPublishSuccess(`❌ Shopify: ${JSON.stringify(e).slice(0, 100)}`); }

      } else if (platformId === 'ghost') {
        const base = f('url').replace(/\/$/, '');
        const [id, secret] = f('adminKey').split(':');
        if (!id || !secret) { setPublishSuccess('❌ Ghost key must be id:secret format'); return; }
        const now = Math.floor(Date.now() / 1000);
        const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: id }));
        const payload = btoa(JSON.stringify({ iat: now, exp: now + 300, aud: '/admin/' }));
        const res = await fetch(`${base}/ghost/api/admin/posts/`, {
          method: 'POST',
          headers: { Authorization: `Ghost ${header}.${payload}.signature`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ posts: [{ title, html: articleHtml, status: 'draft' }] }),
        });
        if (res.ok) { const d = await res.json(); setPublishSuccess(`✅ Saved as draft in Ghost — ID ${d.posts?.[0]?.id}`); }
        else setPublishSuccess('❌ Ghost error — check Admin API key format');

      } else if (platformId === 'webflow') {
        const res = await fetch(`https://api.webflow.com/v2/collections/${f('collectionId')}/items`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${f('token')}`, 'Content-Type': 'application/json', 'accept-version': '1.0.0' },
          body: JSON.stringify({ isArchived: false, isDraft: true, fieldData: { name: title, slug: kwSlug, 'post-body': articleHtml } }),
        });
        if (res.ok) { const d = await res.json(); setPublishSuccess(`✅ Saved to Webflow CMS as draft — ID ${d.id}`); }
        else { const e = await res.json().catch(() => ({})); setPublishSuccess(`❌ Webflow: ${e.message || 'Check token'}`); }

      } else if (platformId === 'contentful') {
        const ct = f('contentType') || 'blogPost';
        const res = await fetch(`https://api.contentful.com/spaces/${f('spaceId')}/environments/master/entries`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${f('token')}`, 'Content-Type': 'application/vnd.contentful.management.v1+json', 'X-Contentful-Content-Type': ct },
          body: JSON.stringify({ fields: { title: { 'en-US': title }, body: { 'en-US': articleHtml }, slug: { 'en-US': kwSlug } } }),
        });
        if (res.ok) { const d = await res.json(); setPublishSuccess(`✅ Saved to Contentful as draft — ID ${d.sys?.id}`); }
        else { const e = await res.json().catch(() => ({})); setPublishSuccess(`❌ Contentful: ${e.message || 'Check credentials'}`); }

      } else if (platformId === 'wix') {
        const res = await fetch('https://www.wixapis.com/blog/v3/draft-posts', {
          method: 'POST',
          headers: { Authorization: f('apiKey'), 'wix-site-id': f('siteId'), 'Content-Type': 'application/json' },
          body: JSON.stringify({ draftPost: { title, richContent: { nodes: [{ type: 'PARAGRAPH', nodes: [{ type: 'TEXT', textData: { text: articleHtml.replace(/<[^>]+>/g, ' ') } }] }] } } }),
        });
        if (res.ok) { const d = await res.json(); setPublishSuccess(`✅ Saved to Wix as draft — ID ${d.draftPost?.id}`); }
        else { const e = await res.json().catch(() => ({})); setPublishSuccess(`❌ Wix: ${e.message || 'Check credentials'}`); }
      }
    } catch (err: any) {
      setPublishSuccess(`❌ Error: ${err.message}`);
    } finally {
      setPublishing(false);
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function scoreColor(s: number) { return s >= 70 ? '#16A34A' : s >= 50 ? '#EF9F27' : '#DC2626'; }
  function gradeLabel(s: number) { return s >= 80 ? 'A' : s >= 70 ? 'B' : s >= 50 ? 'C' : s >= 30 ? 'D' : 'F'; }

  function getFixInstruction(message: string): string {
    if (message.startsWith('Missing title tag')) return 'Add a <title> tag in <head> — 50-60 characters, lead with your target keyword';
    if (message.startsWith('Missing H1')) return 'Add a single <h1> at the top of your content — include your primary keyword naturally';
    if (message.startsWith('Missing meta description')) return 'Add <meta name="description"> — 140-160 chars, include keyword and a clear call to action';
    if (message.startsWith('No structured data')) return 'Add Article + FAQPage JSON-LD in a <script type="application/ld+json"> tag';
    if (message.startsWith('Thin content') || message.startsWith('Low word count')) return 'Expand to 800-1500+ words covering subtopics, FAQs, and related questions';
    if (message.startsWith('No internal links')) return 'Add 3-5 internal links to related pages using descriptive anchor text';
    if (message.startsWith('Missing Open Graph')) return 'Add og:title, og:description, og:image in <head> for social sharing previews';
    if (message.startsWith('No images')) return 'Add 2-3 relevant images with descriptive alt text — use WebP format';
    if (message.startsWith('Noindex')) return 'Remove noindex tag — check your CMS SEO settings and X-Robots-Tag headers';
    if (message.startsWith('Missing viewport')) return 'Add <meta name="viewport" content="width=device-width, initial-scale=1"> to <head>';
    if (message.startsWith('No canonical')) return 'Add <link rel="canonical" href="https://yourdomain.com/this-page"> to <head>';
    if (message.startsWith('Title too long')) return 'Shorten title to under 60 characters — remove filler words, keep the keyword';
    if (message.startsWith('Title too short')) return 'Expand title to 50-60 characters — add primary keyword and key benefit';
    if (message.startsWith('Meta description too long')) return 'Shorten to under 160 characters — cut from the end, keep keyword and CTA';
    if (message.startsWith('Meta description too short')) return 'Expand to 140-160 characters — describe the page benefit and include the keyword';
    if (message.startsWith('Multiple H1')) return 'Keep only one <h1> per page — change additional H1s to <h2>';
    if (message.startsWith('No H2')) return 'Add 4-5 H2 headings to structure content into clear, scannable sections';
    if (message.startsWith('No external links')) return 'Add 2-3 outbound links to authoritative sources (gov.uk, NHS, official bodies)';
    if (message.startsWith('No official source')) return 'Cite 2+ official sources — link to gov.uk, NHS, or recognised industry authorities';
    if (message.startsWith('Slow server')) return 'Improve server response — use edge hosting, enable caching, optimise database calls';
    if (message.startsWith('Duplicate title')) return 'Write a unique title for this page — no two pages should share identical titles';
    if (message.startsWith('Duplicate meta')) return 'Write a unique meta description for this specific page';
    if (message.startsWith('FAQ content') || message.startsWith('Long-form content lacks')) return 'Add FAQPage JSON-LD with 4-6 Q&A pairs targeting People Also Ask results';
    if (message.startsWith('Page not found')) return 'Create this route — use the "Create This Page" button to generate a full Next.js component';
    return 'Review and resolve this issue to improve your SEO score';
  }

  function handleMarkIssueFixed(pageUrl: string, issue: any) {
    if (!results?.results) return;
    const updatedPages = results.results.map((r: any) => {
      if (r.url !== pageUrl) return r;
      const remaining = r.issues.filter((i: any) => i.message !== issue.message);
      const newScore = Math.min(100, r.score + (issue.deduction || 0));
      return {
        ...r,
        score: newScore,
        issues: remaining,
        scoreBeforeFix: r.scoreBeforeFix ?? r.score,
        scoreAfterFix: newScore,
        fixedIssues: [...(r.fixedIssues || []), 'manual'],
        status: 'fixed',
      };
    });
    const avg = Math.round(updatedPages.reduce((a: number, b: any) => a + b.score, 0) / updatedPages.length);
    setResults({
      ...results,
      results: updatedPages,
      summary: {
        ...results.summary,
        avgScore: avg,
        criticalIssues: updatedPages.filter((r: any) => r.score < 30).length,
        pagesNeedingAttention: updatedPages.filter((r: any) => r.score < 70).length,
      },
    });
  }

  const activePlatform = PLATFORMS.find(p => p.id === selectedPlatform);

  // ── RENDER ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '32px', maxWidth: '1100px', margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>

      {/* Header */}
      <div style={{ marginBottom: '28px' }}>
        <div style={{ fontSize: '22px', fontWeight: 700, color: '#0F0F0F', marginBottom: '4px' }}>
          🔬 SEO Workshop
        </div>
        <div style={{ fontSize: '14px', color: '#6B6B6B' }}>
          Connect your platform · run a full audit · fix every issue · publish back automatically
        </div>
      </div>

      {/* Step bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0', marginBottom: '28px' }}>
        {['Connect Platform', 'Run Audit', 'Fix & Publish'].map((label, i) => {
          const stepKey = (['connect', 'audit', 'results'] as const)[i];
          const active = stage === stepKey;
          const done = (stage === 'audit' && i === 0) || (stage === 'results' && i <= 1);
          return (
            <div key={label} style={{ display: 'flex', alignItems: 'center', flex: i < 2 ? 1 : 'none' }}>
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: done ? 'pointer' : 'default' }}
                onClick={() => { if (done || active) setStage(stepKey); }}
              >
                <div style={{
                  width: '28px', height: '28px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '12px', fontWeight: 700, flexShrink: 0,
                  background: done ? '#16A34A' : active ? '#FF6B2C' : '#E8E8E4',
                  color: done || active ? '#fff' : '#9B9B9B',
                }}>
                  {done ? '✓' : i + 1}
                </div>
                <span style={{ fontSize: '13px', fontWeight: active ? 700 : 500, color: active ? '#0F0F0F' : done ? '#16A34A' : '#9B9B9B', whiteSpace: 'nowrap' }}>
                  {label}
                </span>
              </div>
              {i < 2 && <div style={{ flex: 1, height: '2px', background: done ? '#16A34A' : '#E8E8E4', margin: '0 12px' }} />}
            </div>
          );
        })}
      </div>

      {/* ── STAGE 1: Connect ── */}
      {stage === 'connect' && (
        <div style={{ background: '#fff', border: '1px solid #E8E8E4', borderRadius: '12px', padding: '24px' }}>
          <div style={{ fontSize: '16px', fontWeight: 700, color: '#0F0F0F', marginBottom: '4px' }}>Where does your content live?</div>
          <div style={{ fontSize: '13px', color: '#6B6B6B', marginBottom: '20px' }}>
            Connect your CMS once — we&apos;ll publish fixed pages back automatically after the audit.
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginBottom: '20px' }}>
            {PLATFORMS.map(p => (
              <button
                key={p.id}
                onClick={() => { setSelectedPlatform(p.id); setConnectionStatus('idle'); setConnectionMsg(''); }}
                style={{
                  padding: '12px 8px', border: `2px solid ${selectedPlatform === p.id ? p.color : '#E8E8E4'}`,
                  borderRadius: '10px', background: selectedPlatform === p.id ? p.color + '14' : '#FAFAF8',
                  cursor: 'pointer', textAlign: 'center' as const, transition: 'all 0.15s',
                }}
              >
                <div style={{ fontSize: '22px', marginBottom: '4px' }}>{p.icon}</div>
                <div style={{ fontSize: '12px', fontWeight: 700, color: selectedPlatform === p.id ? p.color : '#0F0F0F' }}>{p.name}</div>
                <div style={{ fontSize: '10px', color: '#9B9B9B', marginTop: '1px' }}>{p.desc}</div>
              </button>
            ))}
          </div>

          {activePlatform && !activePlatform.noConnect && activePlatform.fields.length > 0 && (
            <div style={{ background: '#F5F4F1', borderRadius: '10px', padding: '16px', marginBottom: '16px' }}>
              <div style={{ fontSize: '13px', fontWeight: 700, color: '#0F0F0F', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span>{activePlatform.icon}</span> {activePlatform.name} credentials
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {activePlatform.fields.map(field => (
                  <div key={field.key}>
                    <div style={{ fontSize: '11px', fontWeight: 600, color: '#6B6B6B', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{field.label}</div>
                    <input
                      type={field.type || 'text'}
                      placeholder={field.placeholder}
                      autoComplete={field.type === 'password' ? 'new-password' : 'off'}
                      value={pf(field.key)}
                      onChange={e => setPf(field.key, e.target.value)}
                      onInput={e => setPf(field.key, (e.target as HTMLInputElement).value)}
                      style={{ width: '100%', padding: '9px 12px', border: '1px solid #E8E8E4', borderRadius: '8px', fontSize: '13px', background: '#fff', color: '#0F0F0F', boxSizing: 'border-box' as const }}
                    />
                    {field.hint && <div style={{ fontSize: '11px', color: '#9B9B9B', marginTop: '3px' }}>💡 {field.hint}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {connectionStatus === 'ok' && (
            <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: '8px', padding: '10px 14px', marginBottom: '12px', fontSize: '13px', color: '#16A34A' }}>
              ✅ {connectionMsg}
            </div>
          )}
          {connectionStatus === 'error' && (
            <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '8px', padding: '10px 14px', marginBottom: '12px', fontSize: '13px', color: '#DC2626' }}>
              ❌ {connectionMsg}
            </div>
          )}

          <button
            onClick={handleConnect}
            disabled={connecting}
            style={{ width: '100%', padding: '12px', background: '#FF6B2C', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 700, cursor: connecting ? 'not-allowed' : 'pointer', opacity: connecting ? 0.7 : 1 }}
          >
            {connecting ? '⏳ Testing connection...' : selectedPlatform === 'manual' ? '📋 Skip — I\'ll copy HTML manually →' : `🔌 Connect ${activePlatform?.name} & Continue →`}
          </button>
        </div>
      )}

      {/* ── STAGE 2: Audit ── */}
      {stage === 'audit' && (
        <div style={{ background: '#fff', border: '1px solid #E8E8E4', borderRadius: '12px', padding: '24px' }}>
          <div style={{ fontSize: '16px', fontWeight: 700, color: '#0F0F0F', marginBottom: '4px' }}>Run your diagnostic</div>
          <div style={{ fontSize: '13px', color: '#6B6B6B', marginBottom: '20px' }}>
            Enter your domain or paste specific URLs — we&apos;ll check 50+ SEO signals on every page.
          </div>

          <div style={{ display: 'flex', gap: '4px', marginBottom: '20px', background: '#F5F4F1', padding: '4px', borderRadius: '8px', width: 'fit-content' }}>
            {(['domain', 'manual'] as const).map(m => (
              <button key={m} onClick={() => setMode(m)} style={{
                padding: '7px 16px', fontSize: '13px', fontWeight: 600,
                background: mode === m ? '#fff' : 'transparent',
                color: mode === m ? '#0F0F0F' : '#9B9B9B',
                border: 'none', borderRadius: '6px', cursor: 'pointer',
                boxShadow: mode === m ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              }}>
                {m === 'domain' ? '🌐 Domain Audit' : '📋 Manual URLs'}
              </button>
            ))}
          </div>

          {error && <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '8px', padding: '10px 14px', color: '#DC2626', fontSize: '13px', marginBottom: '14px' }}>{error}</div>}

          {mode === 'domain' ? (
            <>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#9B9B9B', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: '6px' }}>Your domain</label>
              <input
                style={{ width: '100%', fontSize: '14px', padding: '10px 14px', border: '1px solid #E8E8E4', borderRadius: '8px', background: '#fff', color: '#0F0F0F', boxSizing: 'border-box' as const }}
                placeholder="autodun.com or https://autodun.com"
                value={domain}
                onChange={e => setDomain(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !loading && handleAudit()}
              />
              <div style={{ fontSize: '12px', color: '#9B9B9B', marginTop: '6px' }}>We&apos;ll automatically discover all pages via your sitemap.xml</div>
            </>
          ) : (
            <>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#9B9B9B', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: '6px' }}>URLs to audit (one per line, max 20)</label>
              <textarea
                style={{ width: '100%', fontSize: '13px', padding: '10px 14px', border: '1px solid #E8E8E4', borderRadius: '8px', background: '#fff', color: '#0F0F0F', fontFamily: 'monospace', minHeight: '120px', resize: 'vertical' as const, boxSizing: 'border-box' as const }}
                placeholder={'https://example.com/page-1\nhttps://example.com/page-2'}
                value={urls}
                onChange={e => setUrls(e.target.value)}
              />
            </>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '14px', marginBottom: '4px' }}>
            <label style={{ fontSize: '11px', fontWeight: 600, color: '#9B9B9B', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Market</label>
            <select
              style={{ fontSize: '13px', padding: '8px 12px', border: '1px solid #E8E8E4', borderRadius: '8px', background: '#fff', color: '#0F0F0F' }}
              value={market} onChange={e => setMarket(e.target.value)}
            >
              <option>United Kingdom</option>
              <option>United States</option>
              <option>Australia</option>
              <option>Canada</option>
              <option>Ireland</option>
            </select>
          </div>

          <button
            style={{ width: '100%', padding: '12px', background: '#FF6B2C', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', marginTop: '16px', opacity: loading ? 0.6 : 1 }}
            onClick={() => handleAudit('smart')} disabled={loading}
          >
            {loading ? '⏳ Auditing...' : mode === 'domain' ? '🔄 Run Fresh Audit' : '🔍 Audit These Pages'}
          </button>

          {mode === 'domain' && (
            <button
              style={{ width: '100%', padding: '10px', background: '#F5F4F1', color: '#0F0F0F', border: '1px solid #E8E8E4', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: (loading || !domain.trim()) ? 'not-allowed' : 'pointer', marginTop: '8px', opacity: (loading || !domain.trim()) ? 0.4 : 1 }}
              onClick={() => handleAudit('cached')} disabled={loading || !domain.trim()}
            >
              📂 Load Saved Results
            </button>
          )}

          {loading && (
            <div style={{ marginTop: '16px' }}>
              <div style={{ background: '#F5F4F1', borderRadius: '8px', height: '8px', overflow: 'hidden', marginBottom: '8px' }}>
                <div style={{ height: '100%', borderRadius: '8px', background: '#FF6B2C', width: `${progress}%`, transition: 'width 0.5s ease' }} />
              </div>
              <div style={{ fontSize: '13px', color: '#6B6B6B', textAlign: 'center' as const }}>{progressLabel}</div>
            </div>
          )}
        </div>
      )}

      {/* ── STAGE 3: Results ── */}
      {stage === 'results' && results && (
        <>
          {results.fromCache && lastAuditedAt && (
            <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: '8px', padding: '10px 14px', marginBottom: '10px', fontSize: '13px', color: '#15803D', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' as const }}>
              <span>💾 <strong>Loaded from last audit</strong> — {new Date(lastAuditedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}. Run Fresh Audit to re-scrape.</span>
              {mode === 'domain' && (
                <button
                  onClick={() => handleAudit('smart')}
                  style={{ fontSize: '11px', fontWeight: 700, padding: '5px 12px', background: '#fff', color: '#15803D', border: '1px solid #BBF7D0', borderRadius: '6px', cursor: 'pointer', whiteSpace: 'nowrap' as const }}
                >
                  🔄 Run Fresh Audit
                </button>
              )}
            </div>
          )}

          {discoverySource && (
            <div style={{ background: results.fromCache ? '#F0FDF4' : '#EFF6FF', border: `1px solid ${results.fromCache ? '#BBF7D0' : '#BFDBFE'}`, borderRadius: '8px', padding: '10px 14px', marginBottom: '12px', fontSize: '13px', color: results.fromCache ? '#16A34A' : '#1D4ED8', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' as const }}>
              <span>{results.fromCache ? '💾' : '🗺️'} <strong>Discovery:</strong> {discoverySource}</span>
              {mode === 'domain' && (
                <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                  <button
                    onClick={() => handleAudit('cached')}
                    style={{ fontSize: '11px', fontWeight: 700, padding: '5px 12px', background: '#fff', color: '#1D4ED8', border: '1px solid #BFDBFE', borderRadius: '6px', cursor: 'pointer', whiteSpace: 'nowrap' as const }}
                  >
                    💾 Refresh Status
                  </button>
                  <button
                    onClick={() => {
                      if (window.confirm('Re-audit All will re-scrape every page from the live site and reset all fix history in the database. This cannot be undone. Continue?')) {
                        handleAudit('fresh');
                      }
                    }}
                    style={{ fontSize: '11px', fontWeight: 700, padding: '5px 12px', background: '#fff', color: '#DC2626', border: '1px solid #FECACA', borderRadius: '6px', cursor: 'pointer', whiteSpace: 'nowrap' as const }}
                  >
                    🔄 Re-audit All
                  </button>
                </div>
              )}
            </div>
          )}
          {discoveryError && (
            <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '8px', padding: '10px 14px', marginBottom: '12px', fontSize: '13px', color: '#92400E' }}>
              ⚠️ {discoveryError}
            </div>
          )}

          {/* Summary stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '10px', marginBottom: '20px' }}>
            {[
              { label: 'Avg Score', value: results.summary.avgScore, color: scoreColor(results.summary.avgScore), sub: gradeLabel(results.summary.avgScore) },
              { label: 'Pages Audited', value: results.summary.audited, color: '#0F0F0F', sub: '' },
              { label: 'Critical Pages', value: results.summary.criticalIssues, color: results.summary.criticalIssues > 0 ? '#DC2626' : '#16A34A', sub: '' },
              { label: 'Need Attention', value: results.summary.pagesNeedingAttention, color: results.summary.pagesNeedingAttention > 0 ? '#EF9F27' : '#16A34A', sub: 'score < 70' },
              { label: 'Have Schema', value: results.summary.pagesWithSchema, color: '#16A34A', sub: '' },
            ].map(stat => (
              <div key={stat.label} style={{ background: '#fff', border: '1px solid #E8E8E4', borderRadius: '10px', padding: '14px 16px', textAlign: 'center' as const }}>
                <div style={{ fontSize: '26px', fontWeight: 700, color: stat.color }}>{stat.value}{stat.sub && <span style={{ fontSize: '14px', marginLeft: '4px' }}>{stat.sub}</span>}</div>
                <div style={{ fontSize: '11px', color: '#9B9B9B', marginTop: '2px', textTransform: 'uppercase' as const, letterSpacing: '0.5px' }}>{stat.label}</div>
              </div>
            ))}
            {/* AI Ready card */}
            {(() => {
              const pagesAiReady = results.results.filter((r: any) =>
                r.issues.filter((i: any) => i.category === 'ai').length === 0
              ).length;
              const total = results.results.length;
              return (
                <div style={{ background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: '10px', padding: '14px 16px', minWidth: '120px', textAlign: 'center' as const }}>
                  <div style={{ fontSize: '22px', fontWeight: 800, color: '#EA580C' }}>{pagesAiReady}/{total}</div>
                  <div style={{ fontSize: '11px', color: '#9A3412', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.5px', marginTop: '4px' }}>AI READY</div>
                </div>
              );
            })()}
          </div>

          {/* Generate Sitemap */}
          <div style={{ background: '#fff', border: '1px solid #E8E8E4', borderRadius: '10px', padding: '14px 18px', marginBottom: '16px', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ flex: 1, minWidth: '200px' }}>
              <div style={{ fontSize: '13px', fontWeight: 700, color: '#0F0F0F' }}>📐 Generate Sitemap</div>
              <div style={{ fontSize: '11px', color: '#9B9B9B', marginTop: '2px' }}>
                Build a valid XML sitemap from all {results.results.length} audited pages
                {selectedPlatform === 'github' && platformFields['github_repo'] ? ` · push to ${platformFields['github_repo']}` : ' · download as sitemap.xml'}
              </div>
            </div>
            <button
              onClick={handleGenerateSitemap}
              disabled={generatingSitemap}
              style={{ padding: '8px 16px', background: '#0F0F0F', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: generatingSitemap ? 'not-allowed' : 'pointer', opacity: generatingSitemap ? 0.6 : 1, whiteSpace: 'nowrap' as const }}
            >
              {generatingSitemap ? '⏳ Generating...' : '📐 Generate Sitemap'}
            </button>
            {sitemapXml && (
              <button
                onClick={downloadSitemap}
                style={{ padding: '8px 16px', background: '#16A34A', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' as const }}
              >
                ⬇ Download sitemap.xml
              </button>
            )}
          </div>
          {sitemapMsg && (
            <div style={{ background: sitemapMsg.includes('❌') ? '#FEF2F2' : '#F0FDF4', border: `1px solid ${sitemapMsg.includes('❌') ? '#FECACA' : '#BBF7D0'}`, borderRadius: '8px', padding: '10px 14px', marginBottom: '12px', fontSize: '12px', color: sitemapMsg.includes('❌') ? '#DC2626' : '#16A34A' }}>
              {sitemapMsg}
            </div>
          )}
          {sitemapXml && !sitemapMsg.includes('❌') && !sitemapMsg.includes('✅ Pushed') && (
            <div style={{ background: '#F5F4F1', borderRadius: '8px', padding: '10px 14px', marginBottom: '16px', maxHeight: '120px', overflowY: 'auto', fontSize: '11px', color: '#6B6B6B', fontFamily: 'monospace' }}>
              {sitemapXml.slice(0, 600)}...
            </div>
          )}

          {/* Score simulation success banner */}
          {scoreSimMsg && (
            <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: '10px', padding: '12px 16px', marginBottom: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
              <div style={{ fontSize: '13px', color: '#16A34A', fontWeight: 600 }}>{scoreSimMsg}</div>
              <button onClick={() => setScoreSimMsg('')} style={{ background: 'none', border: 'none', color: '#16A34A', fontSize: '18px', cursor: 'pointer', flexShrink: 0, lineHeight: 1 }}>×</button>
            </div>
          )}

          {/* Results table */}
          <div style={{ background: '#fff', border: '1px solid #E8E8E4', borderRadius: '12px', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Page', 'Grade', 'Words', 'Signals', 'Actions'].map(h => (
                    <th key={h} style={{ padding: '12px 16px', fontSize: '11px', fontWeight: 600, color: '#9B9B9B', textTransform: 'uppercase' as const, letterSpacing: '0.5px', background: '#FAFAF8', textAlign: 'left' as const, borderBottom: '1px solid #E8E8E4' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {results.results.flatMap((page: any) => {
                  const isExpanded = expandedUrl === page.url;
                  const shortUrl = page.url.replace(/^https?:\/\//, '');
                  const criticals = page.issues.filter((i: any) => i.severity === 'critical').length;
                  const warnings = page.issues.filter((i: any) => i.severity === 'warning').length;
                  const notices = page.issues.filter((i: any) => i.severity === 'notice').length;
                  const securityCount = page.issues.filter((i: any) => i.category === 'security').length;
                  const speedCount = page.issues.filter((i: any) => i.category === 'speed').length;
                  const aiCount = page.issues.filter((i: any) => i.category === 'ai').length;
                  const isFixed = page.status === 'fixed' || (page.fixedIssues?.length > 0);
                  const scoreGainDisplay = isFixed && page.scoreBeforeFix != null && page.scoreAfterFix != null
                    ? page.scoreAfterFix - page.scoreBeforeFix : null;

                  const rows = [
                    <tr
                      key={page.url}
                      style={{ cursor: 'pointer', background: isExpanded ? '#FAFAF8' : isFixed ? '#F0FDF4' : '#fff' }}
                      onClick={() => setExpandedUrl(isExpanded ? null : page.url)}
                    >
                      <td style={{ padding: '12px 16px', fontSize: '13px', color: '#0F0F0F', borderBottom: '1px solid #F5F4F1', verticalAlign: 'top' as const, maxWidth: '280px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                          <span style={{ fontWeight: 600, fontSize: '12px', wordBreak: 'break-all' }}>
                            {shortUrl.length > 55 ? shortUrl.slice(0, 55) + '...' : shortUrl}
                          </span>
                          {isFixed && (
                            <span style={{ background: '#BBF7D0', color: '#15803D', fontSize: '9px', fontWeight: 700, padding: '1px 6px', borderRadius: '20px', flexShrink: 0 }}>
                              ✅ Fixed
                            </span>
                          )}
                        </div>
                        {page.title
                          ? <div style={{ fontSize: '11px', color: '#6B6B6B' }}>{page.title.slice(0, 60)}{page.title.length > 60 ? '...' : ''}</div>
                          : <div style={{ fontSize: '11px', color: '#DC2626' }}>No title tag</div>
                        }
                        {page.aiAnalysis?.detectedKeyword && (
                          <div style={{ fontSize: '10px', color: '#FF6B2C', marginTop: '2px', fontWeight: 600 }}>
                            🎯 {page.aiAnalysis.detectedKeyword}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '12px 16px', borderBottom: '1px solid #F5F4F1', verticalAlign: 'top' as const }}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                          <div style={{
                            width: '44px', height: '44px', borderRadius: '50%',
                            border: `3px solid ${scoreColor(page.score)}`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: '16px', fontWeight: 700, color: scoreColor(page.score),
                          }}>
                            {gradeLabel(page.score)}
                          </div>
                          <div style={{ fontSize: '10px', color: '#9B9B9B' }}>{page.score}/100</div>
                          {scoreGainDisplay != null && scoreGainDisplay > 0 && (
                            <div style={{ fontSize: '9px', color: '#16A34A', fontWeight: 700 }}>
                              {page.scoreBeforeFix} → {page.scoreAfterFix} (+{scoreGainDisplay})
                            </div>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '12px 16px', borderBottom: '1px solid #F5F4F1', verticalAlign: 'top' as const, fontWeight: 600, fontSize: '13px', color: page.wordCount < 600 ? '#DC2626' : '#16A34A' }}>
                        {page.wordCount.toLocaleString()}
                      </td>
                      <td style={{ padding: '12px 16px', borderBottom: '1px solid #F5F4F1', verticalAlign: 'top' as const }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                          {criticals > 0 && (
                            <span style={{ background: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA', fontSize: '10px', padding: '2px 7px', borderRadius: '20px', fontWeight: 600, whiteSpace: 'nowrap' as const }}>
                              ⛔ {criticals} critical
                            </span>
                          )}
                          {warnings > 0 && (
                            <span style={{ background: '#FFFBEB', color: '#92400E', border: '1px solid #FDE68A', fontSize: '10px', padding: '2px 7px', borderRadius: '20px', fontWeight: 600, whiteSpace: 'nowrap' as const }}>
                              ⚠️ {warnings} warning{warnings !== 1 ? 's' : ''}
                            </span>
                          )}
                          {notices > 0 && (
                            <span style={{ background: '#EFF6FF', color: '#1D4ED8', border: '1px solid #BFDBFE', fontSize: '10px', padding: '2px 7px', borderRadius: '20px', fontWeight: 600, whiteSpace: 'nowrap' as const }}>
                              💡 {notices} notice{notices !== 1 ? 's' : ''}
                            </span>
                          )}
                          {page.hasSchema && (
                            <span style={{ fontSize: '10px', color: '#16A34A' }}>✓ schema</span>
                          )}
                          {page.hasFaq && (
                            <span style={{ fontSize: '10px', color: '#16A34A' }}>✓ FAQ</span>
                          )}
                          {securityCount > 0 && (
                            <span style={{ fontSize: '10px', color: '#6D28D9' }}>🔒 {securityCount}</span>
                          )}
                          {speedCount > 0 && (
                            <span style={{ fontSize: '10px', color: '#2563EB' }}>⚡ {speedCount}</span>
                          )}
                          {aiCount > 0 && (
                            <span style={{ fontSize: '10px', color: '#EA580C' }}>🤖 {aiCount}</span>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '12px 16px', borderBottom: '1px solid #F5F4F1', verticalAlign: 'top' as const }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                          {page.httpStatus === 404 && !isFixed ? (
                            <button
                              onClick={e => { e.stopPropagation(); handleCreatePage(page); }}
                              style={{ fontSize: '11px', fontWeight: 700, padding: '6px 12px', background: '#1D4ED8', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', whiteSpace: 'nowrap' as const }}
                            >
                              ✨ Create This Page
                            </button>
                          ) : (
                            <button
                              onClick={e => { e.stopPropagation(); handleFixPage(page); }}
                              style={{ fontSize: '11px', fontWeight: 700, padding: '6px 12px', background: isFixed ? '#6B7280' : '#FF6B2C', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', whiteSpace: 'nowrap' as const }}
                            >
                              {isFixed ? '🔁 Re-fix' : '🔧 Fix This Page'}
                            </button>
                          )}
                          <button
                            onClick={e => { e.stopPropagation(); setExpandedUrl(isExpanded ? null : page.url); }}
                            style={{ fontSize: '11px', padding: '4px 8px', background: 'none', color: '#9B9B9B', border: '1px solid #E8E8E4', borderRadius: '6px', cursor: 'pointer' }}
                          >
                            {isExpanded ? '▲ Hide' : '▼ Details'}
                          </button>
                        </div>
                      </td>
                    </tr>,
                  ];

                  if (isExpanded) {
                    const catOrder = ['crawlability', 'onpage', 'technical', 'content', 'schema', 'security', 'speed', 'ai', 'links', 'mobile', 'depth'] as const;
                    const catMeta: Record<string, { icon: string; label: string; color: string }> = {
                      crawlability: { icon: '🕷️', label: 'Crawlability & Indexing',   color: '#7C3AED' },
                      onpage:       { icon: '📝', label: 'On-Page SEO',               color: '#DC2626' },
                      technical:    { icon: '⚙️', label: 'Technical',                 color: '#1D4ED8' },
                      content:      { icon: '📄', label: 'Content Quality',           color: '#92400E' },
                      schema:       { icon: '🔷', label: 'Schema & Structured Data',  color: '#0F766E' },
                      security:     { icon: '🔒', label: 'Security & Trust',          color: '#6D28D9' },
                      speed:        { icon: '⚡', label: 'Page Speed',                color: '#2563EB' },
                      ai:           { icon: '🤖', label: 'AI Search Visibility',      color: '#EA580C' },
                      links:        { icon: '🔗', label: 'Link Health',               color: '#0D9488' },
                      mobile:       { icon: '📱', label: 'Mobile & UX',               color: '#DB2777' },
                      depth:        { icon: '📊', label: 'Content Depth',             color: '#B45309' },
                    };
                    const grouped: Record<string, any[]> = {};
                    for (const issue of page.issues) {
                      const cat = (issue.category as string) || 'onpage';
                      if (!grouped[cat]) grouped[cat] = [];
                      grouped[cat].push(issue);
                    }
                    rows.push(
                      <tr key={`${page.url}-detail`}>
                        <td colSpan={5} style={{ padding: '16px 20px', background: '#FAFAF8', borderBottom: '1px solid #E8E8E4' }}>
                          {(() => {
                            const hasIssues = page.issues.length > 0;
                            const quickWins = page.aiAnalysis?.quickWins?.length > 0 ? page.aiAnalysis.quickWins : page.opportunities;
                            const showQuickWins = hasIssues && quickWins.length > 0;
                            return (
                              <div style={{ display: 'grid', gridTemplateColumns: showQuickWins ? '1fr 1fr' : '1fr', gap: '20px' }}>
                                <div>
                                  <div style={{ fontSize: '11px', fontWeight: 700, color: '#0F0F0F', textTransform: 'uppercase' as const, letterSpacing: '0.5px', marginBottom: '10px' }}>
                                    Issues ({page.issues.length})
                                  </div>
                                  {!hasIssues ? (
                                    <div style={{ fontSize: '12px', color: '#16A34A' }}>✓ No issues found</div>
                                  ) : (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                      {catOrder.filter(cat => grouped[cat]?.length > 0).map(cat => {
                                        const meta = catMeta[cat];
                                        return (
                                          <div key={cat}>
                                            <div style={{ fontSize: '10px', fontWeight: 700, color: meta.color, textTransform: 'uppercase' as const, letterSpacing: '0.5px', marginBottom: '6px' }}>
                                              {meta.icon} {meta.label}
                                            </div>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                              {grouped[cat].map((issue: any, j: number) => {
                                                const sevColor = issue.severity === 'critical' ? '#DC2626' : issue.severity === 'warning' ? '#D97706' : '#2563EB';
                                                const sevBg = issue.severity === 'critical' ? '#FEF2F2' : issue.severity === 'warning' ? '#FFFBEB' : '#EFF6FF';
                                                const sevBorder = issue.severity === 'critical' ? '#FECACA' : issue.severity === 'warning' ? '#FDE68A' : '#BFDBFE';
                                                const sevLabel = issue.severity === 'critical' ? 'CRITICAL' : issue.severity === 'warning' ? 'WARNING' : 'NOTICE';
                                                const sevPts = issue.deduction > 0 ? `-${issue.deduction}pts` : '';
                                                const fixInstr = getFixInstruction(issue.message);
                                                return (
                                                  <div key={j} style={{ background: '#fff', border: '1px solid #E8E8E4', borderRadius: '8px', padding: '10px 12px' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: fixInstr ? '4px' : '6px' }}>
                                                      <span style={{
                                                        fontSize: '9px', fontWeight: 700, padding: '2px 6px', borderRadius: '20px',
                                                        background: sevBg, color: sevColor, border: `1px solid ${sevBorder}`,
                                                        whiteSpace: 'nowrap' as const, flexShrink: 0,
                                                      }}>
                                                        {sevLabel}{sevPts ? ` ${sevPts}` : ''}
                                                      </span>
                                                      <span style={{ fontSize: '12px', color: '#0F0F0F', fontWeight: 500 }}>{issue.message}</span>
                                                    </div>
                                                    {fixInstr && (
                                                      <div style={{ fontSize: '11px', color: '#6B6B6B', marginBottom: '8px', paddingLeft: '2px' }}>
                                                        💡 {fixInstr}
                                                      </div>
                                                    )}
                                                    <label
                                                      onClick={e => e.stopPropagation()}
                                                      style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '11px', color: '#6B6B6B' }}
                                                    >
                                                      <input
                                                        type="checkbox"
                                                        onClick={e => e.stopPropagation()}
                                                        onChange={e => { if (e.target.checked) handleMarkIssueFixed(page.url, issue); }}
                                                        style={{ width: '13px', height: '13px', accentColor: '#16A34A', cursor: 'pointer' }}
                                                      />
                                                      Mark as Fixed Manually
                                                    </label>
                                                  </div>
                                                );
                                              })}
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                                {showQuickWins && (
                                  <div>
                                    <div style={{ fontSize: '11px', fontWeight: 700, color: '#16A34A', textTransform: 'uppercase' as const, letterSpacing: '0.5px', marginBottom: '8px' }}>Quick Wins</div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                      {quickWins.map((win: string, j: number) => (
                                        <div key={j} style={{ fontSize: '12px', color: '#0F0F0F', display: 'flex', gap: '6px' }}>
                                          <span style={{ color: '#16A34A', flexShrink: 0 }}>→</span>{win}
                                        </div>
                                      ))}
                                    </div>
                                    {page.metaDescription && (
                                      <div style={{ marginTop: '12px', fontSize: '11px', color: '#6B6B6B', borderTop: '1px solid #E8E8E4', paddingTop: '10px' }}>
                                        <strong>Meta:</strong> {page.metaDescription}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                        </td>
                      </tr>
                    );
                  }

                  return rows;
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── Fix Panel Overlay ── */}
      {showFixPanel && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end' }}
          onClick={() => !fixing && setShowFixPanel(false)}
        >
          <div
            style={{ width: '600px', height: '100vh', background: '#fff', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}
            onClick={e => e.stopPropagation()}
          >
            {/* Panel header */}
            <div style={{ background: '#0F0F0F', padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <div>
                <div style={{ color: '#fff', fontWeight: 700, fontSize: '15px' }}>
                  {fixResult?.componentCode ? '✨ Create This Page' : '🔧 Fix This Page'}
                </div>
                {fixingPage && (
                  <div style={{ fontSize: '11px', color: '#8899aa', marginTop: '2px' }}>
                    {fixingPage.url.replace(/^https?:\/\//, '').slice(0, 55)}
                  </div>
                )}
              </div>
              <button
                onClick={() => !fixing && setShowFixPanel(false)}
                style={{ color: '#9B9B9B', background: 'none', border: 'none', fontSize: '22px', cursor: fixing ? 'not-allowed' : 'pointer', lineHeight: 1 }}
              >×</button>
            </div>

            <div style={{ padding: '20px', flex: 1 }}>
              {/* Progress steps */}
              {(fixing || fixStep > 0) && fixStep !== -1 && !fixResult && (
                <div style={{ marginBottom: '24px' }}>
                  {FIX_STEPS.map((step, i) => {
                    const done = i < fixStep;
                    const active = i === fixStep && fixing;
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 0', borderBottom: i < FIX_STEPS.length - 1 ? '1px solid #F5F4F1' : 'none' }}>
                        <div style={{
                          width: '22px', height: '22px', borderRadius: '50%', flexShrink: 0,
                          background: done ? '#16A34A' : active ? '#FF6B2C' : '#F5F4F1',
                          color: done || active ? '#fff' : '#9B9B9B',
                          fontSize: '11px', fontWeight: 700,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          {done ? '✓' : active ? '⟳' : i + 1}
                        </div>
                        <div style={{ fontSize: '13px', color: active ? '#0F0F0F' : done ? '#6B6B6B' : '#9B9B9B', fontWeight: active ? 600 : 400 }}>
                          {step}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Error */}
              {fixStep === -1 && (
                <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '8px', padding: '12px 16px', color: '#DC2626', fontSize: '13px' }}>
                  {fixStageLabel}
                </div>
              )}

              {/* Fix result */}
              {fixResult && (
                <>
                  {/* Keyword + stats */}
                  <div style={{ background: '#F5F4F1', borderRadius: '10px', padding: '14px 16px', marginBottom: '16px' }}>
                    <div style={{ fontSize: '11px', fontWeight: 700, color: '#9B9B9B', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>Target Keyword</div>
                    <div style={{ fontSize: '18px', fontWeight: 700, color: '#FF6B2C' }}>{fixResult.keyword}</div>
                    <div style={{ fontSize: '12px', color: '#6B6B6B', marginTop: '4px' }}>
                      {fixResult.competitorsAnalysed} competitor{fixResult.competitorsAnalysed !== 1 ? 's' : ''} analysed
                      {fixResult.avgCompetitorWords > 0 && ` · avg ${fixResult.avgCompetitorWords.toLocaleString()} competitor words`}
                    </div>
                  </div>

                  {fixResult.brief?.briefSummary && (
                    <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: '8px', padding: '12px 16px', marginBottom: '16px', fontSize: '13px', color: '#1D4ED8' }}>
                      💡 {fixResult.brief.briefSummary}
                    </div>
                  )}

                  {fixResult.lowKdKeywords?.length > 0 && (
                    <div style={{ marginBottom: '16px' }}>
                      <div style={{ fontSize: '11px', fontWeight: 700, color: '#9B9B9B', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>Low KD Keywords to Target</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {fixResult.lowKdKeywords.slice(0, 8).map((k: any, i: number) => (
                          <span key={i} style={{ background: '#F5F4F1', border: '1px solid #E8E8E4', borderRadius: '20px', fontSize: '11px', padding: '3px 10px', color: '#0F0F0F' }}>
                            {k.keyword} <span style={{ color: '#9B9B9B' }}>KD {k.kd}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Score simulation success banner */}
                  {scoreSimMsg && (
                    <div style={{ background: '#0d2b1a', border: '1px solid #166534', borderRadius: '10px', padding: '12px 16px', marginBottom: '16px' }}>
                      <div style={{ fontSize: '13px', color: '#86efac', fontWeight: 600 }}>{scoreSimMsg}</div>
                      {fixResult.fixedIssues?.length > 0 && (
                        <div style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                          {(fixResult.fixedIssues as string[]).map((key: string) => (
                            <span key={key} style={{ background: '#166534', color: '#86efac', fontSize: '10px', padding: '2px 8px', borderRadius: '20px', fontWeight: 600 }}>
                              ✓ {key.replace(/_/g, ' ')}
                            </span>
                          ))}
                        </div>
                      )}
                      {fixResult.deployHookConfigured === false && fixResult.commitUrl && (
                        <div style={{ marginTop: '10px', fontSize: '11px', color: '#6ee7b7', lineHeight: 1.7, borderTop: '1px solid #166534', paddingTop: '8px' }}>
                          <strong>⚡ Enable auto-redeploy:</strong> Vercel → {fixResult.githubFilePath?.split('/')[0] === 'src' ? 'seoranko' : 'autodun'} project → Settings → Git → Deploy Hooks → Create hook &quot;seoranko-audit&quot; → copy URL → add as <code style={{ background: '#0a1a0a', padding: '1px 4px', borderRadius: '3px' }}>VERCEL_DEPLOY_HOOK_AUTODUN</code> env var
                        </div>
                      )}
                    </div>
                  )}

                  {fixResult.corrections?.length > 0 && (
                    <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: '8px', padding: '10px 14px', marginBottom: '16px', fontSize: '12px', color: '#16A34A' }}>
                      ✓ {fixResult.corrections.length} correction{fixResult.corrections.length !== 1 ? 's' : ''} applied automatically
                      {fixResult.factCheckStatus === 'fixed' && ' · fake data removed'}
                    </div>
                  )}

                  {fixResult.isNewPage && !fixResult.componentCode && (
                    <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: '8px', padding: '12px 16px', marginBottom: '16px' }}>
                      <div style={{ fontSize: '13px', fontWeight: 700, color: '#1D4ED8', marginBottom: '4px' }}>
                        ✨ New page created
                      </div>
                      {fixResult.githubFilePath && (
                        <div style={{ fontSize: '12px', color: '#3B82F6', marginBottom: '4px' }}>
                          Pushed to <code style={{ background: '#DBEAFE', padding: '1px 5px', borderRadius: '4px' }}>{fixResult.githubFilePath}</code>
                        </div>
                      )}
                      {fixResult.commitUrl && (
                        <a href={fixResult.commitUrl} target="_blank" rel="noreferrer"
                          style={{ fontSize: '12px', color: '#1D4ED8', fontWeight: 600, textDecoration: 'none' }}>
                          🔗 View commit →
                        </a>
                      )}
                    </div>
                  )}

                  {/* Next.js component panel — shown when Create This Page was used */}
                  {fixResult.componentCode && (
                    <div style={{ background: '#0F0F0F', borderRadius: '12px', padding: '20px', marginBottom: '16px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
                        <div>
                          <div style={{ fontSize: '14px', fontWeight: 700, color: '#fff', marginBottom: '2px' }}>⚛️ Next.js Component Ready</div>
                          <div style={{ fontSize: '12px', color: '#8899aa' }}>
                            {fixResult.githubFilePath || 'page.tsx'}
                          </div>
                        </div>
                        <div style={{ fontSize: '11px', color: '#FF6B2C', fontWeight: 700, background: '#1a1a2e', padding: '4px 10px', borderRadius: '20px' }}>
                          TypeScript · App Router
                        </div>
                      </div>

                      {fixResult.commitUrl ? (
                        <div style={{ background: '#0d2b1a', border: '1px solid #166534', borderRadius: '8px', padding: '10px 14px', marginBottom: '12px' }}>
                          <div style={{ fontSize: '12px', color: '#86efac', marginBottom: '4px' }}>
                            ✅ Pushed to GitHub — {fixResult.githubFilePath}
                          </div>
                          <a href={fixResult.commitUrl} target="_blank" rel="noreferrer"
                            style={{ fontSize: '12px', color: '#86efac', fontWeight: 600, textDecoration: 'none' }}>
                            🔗 View commit →
                          </a>
                        </div>
                      ) : (
                        <div style={{ background: '#1a1a2e', border: '1px solid #2a2a4e', borderRadius: '8px', padding: '10px 14px', marginBottom: '12px', fontSize: '12px', color: '#8899aa' }}>
                          ℹ️ Connect GitHub in Step 1 to push this file automatically
                        </div>
                      )}

                      <div style={{ fontSize: '11px', fontWeight: 600, color: '#8899aa', textTransform: 'uppercase' as const, letterSpacing: '0.5px', marginBottom: '6px' }}>
                        Component preview
                      </div>
                      <div style={{ background: '#1a1a2e', borderRadius: '8px', padding: '12px', maxHeight: '200px', overflowY: 'auto', fontSize: '10px', color: '#a8c4e8', fontFamily: 'monospace', lineHeight: 1.6, whiteSpace: 'pre' as const }}>
                        {fixResult.componentCode.slice(0, 1000)}
                      </div>

                      <button
                        onClick={() => {
                          try {
                            const blob = new Blob([fixResult.componentCode], { type: 'text/plain' });
                            const a = document.createElement('a');
                            a.href = URL.createObjectURL(blob);
                            let slug = 'page';
                            try { slug = new URL(fixingPage?.url || '').pathname.replace(/\//g, '-').replace(/^-/, '') || 'page'; } catch { /* skip */ }
                            a.download = `${slug}.tsx`;
                            a.click();
                            URL.revokeObjectURL(a.href);
                          } catch { /* skip */ }
                        }}
                        style={{ width: '100%', padding: '9px', background: '#1D4ED8', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: 700, marginTop: '10px' }}
                      >
                        ⬇ Download page.tsx
                      </button>

                      <button
                        onClick={() => { setShowFixPanel(false); handleAudit('cached'); setStage('results'); }}
                        style={{ width: '100%', padding: '10px', background: '#16A34A', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: 700, marginTop: '8px' }}
                      >
                        🔄 Re-run Audit — Check Updated Score
                      </button>
                    </div>
                  )}

                  {fixResult.improvedArticle && (
                    <div style={{ background: '#0F0F0F', borderRadius: '12px', padding: '20px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
                        <div>
                          <div style={{ fontSize: '14px', fontWeight: 700, color: '#fff', marginBottom: '2px' }}>📄 Improved Article Ready</div>
                          <div style={{ fontSize: '12px', color: '#8899aa' }}>
                            ~{fixResult.improvedArticle.split(/\s+/).length.toLocaleString()} words · Google 2026 compliant
                          </div>
                        </div>
                        <div style={{ fontSize: '11px', color: '#FF6B2C', fontWeight: 700, background: '#1a1a2e', padding: '4px 10px', borderRadius: '20px' }}>
                          {activePlatform?.icon} {activePlatform?.name}
                        </div>
                      </div>

                      <div style={{ fontSize: '11px', fontWeight: 600, color: '#8899aa', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '10px' }}>
                        Publish destination
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px', marginBottom: '14px' }}>
                        {PLATFORMS.map(p => (
                          <button
                            key={p.id}
                            onClick={() => { setPublishMode(p.id === publishMode ? null : p.id); setPublishSuccess(''); }}
                            style={{
                              padding: '8px 4px', borderRadius: '8px', cursor: 'pointer',
                              background: publishMode === p.id ? p.color : '#1a1a2e',
                              border: `1px solid ${publishMode === p.id ? p.color : '#2a2a4e'}`,
                              color: '#fff', fontSize: '11px', fontWeight: 600, textAlign: 'center' as const,
                              outline: selectedPlatform === p.id && publishMode !== p.id ? '2px solid #FF6B2C' : 'none',
                              outlineOffset: '2px',
                            }}
                          >
                            <div style={{ fontSize: '16px', marginBottom: '2px' }}>{p.icon}</div>
                            <div>{p.name}</div>
                          </button>
                        ))}
                      </div>

                      {publishSuccess && (
                        <div style={{
                          background: publishSuccess.includes('❌') ? '#3d1515' : '#0d2b1a',
                          border: `1px solid ${publishSuccess.includes('❌') ? '#7f1d1d' : '#166534'}`,
                          borderRadius: '8px', padding: '10px 14px', marginBottom: '12px',
                          fontSize: '12px', color: publishSuccess.includes('❌') ? '#fca5a5' : '#86efac',
                          wordBreak: 'break-all' as const,
                        }}>
                          {publishSuccess}
                        </div>
                      )}

                      {publishMode && publishMode !== 'manual' && (() => {
                        const p = PLATFORMS.find(pl => pl.id === publishMode);
                        if (!p || p.fields.length === 0) return null;
                        const hasCredentials = p.fields.every(f => platformFields[`${publishMode}_${f.key}`]);
                        return (
                          <div style={{ background: '#1a1a2e', borderRadius: '8px', padding: '14px', marginBottom: '12px' }}>
                            <div style={{ fontSize: '12px', color: hasCredentials ? '#86efac' : '#8899aa', marginBottom: '10px', fontWeight: 600 }}>
                              {hasCredentials ? `✅ Using ${p.name} credentials from Step 1` : `⚠️ ${p.name} credentials not set — go back to Step 1 to connect`}
                            </div>
                            {!hasCredentials && p.fields.map(field => (
                              <div key={field.key} style={{ marginBottom: '8px' }}>
                                <div style={{ fontSize: '11px', color: '#8899aa', marginBottom: '3px' }}>{field.label}</div>
                                <input
                                  type={field.type || 'text'}
                                  placeholder={field.placeholder}
                                  value={platformFields[`${publishMode}_${field.key}`] || ''}
                                  onChange={e => setPlatformFields(prev => ({ ...prev, [`${publishMode}_${field.key}`]: e.target.value }))}
                                  style={{ width: '100%', padding: '7px 10px', borderRadius: '6px', border: '1px solid #2a2a4e', background: '#0d0d1a', color: '#fff', fontSize: '12px', boxSizing: 'border-box' as const }}
                                />
                              </div>
                            ))}
                            <button
                              onClick={() => handlePublish(publishMode, fixResult.improvedArticle, fixResult)}
                              disabled={publishing}
                              style={{ width: '100%', padding: '10px', background: '#FF6B2C', color: '#fff', border: 'none', borderRadius: '8px', cursor: publishing ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: 700, opacity: publishing ? 0.6 : 1, marginTop: '4px' }}
                            >
                              {publishing ? '⏳ Publishing...' : `🚀 Publish to ${p.name}`}
                            </button>
                          </div>
                        );
                      })()}

                      {publishMode === 'manual' && (
                        <button
                          onClick={() => handlePublish('manual', fixResult.improvedArticle, fixResult)}
                          style={{ width: '100%', padding: '10px', background: '#FF6B2C', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 700, marginBottom: '12px' }}
                        >
                          📋 Copy HTML to Clipboard
                        </button>
                      )}

                      {!publishMode && (
                        <button
                          onClick={() => handlePublish(selectedPlatform, fixResult.improvedArticle, fixResult)}
                          disabled={publishing}
                          style={{ width: '100%', padding: '10px', background: '#FF6B2C', color: '#fff', border: 'none', borderRadius: '8px', cursor: publishing ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: 700, opacity: publishing ? 0.6 : 1, marginBottom: '12px' }}
                        >
                          {publishing ? '⏳ Publishing...' : `🚀 Publish to ${activePlatform?.name}`}
                        </button>
                      )}

                      {/* Article preview */}
                      <div style={{ background: '#1a1a2e', borderRadius: '8px', padding: '12px', maxHeight: '140px', overflowY: 'auto', fontSize: '11px', color: '#8899aa', fontFamily: 'monospace', lineHeight: 1.5 }}>
                        {fixResult.improvedArticle.slice(0, 500)}...
                      </div>

                      {/* Re-audit button — shown after a successful publish */}
                      {publishSuccess && !publishSuccess.includes('❌') && (
                        <button
                          onClick={() => { setShowFixPanel(false); handleAudit('cached'); setStage('results'); }}
                          style={{ width: '100%', padding: '11px', background: '#16A34A', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 700, marginTop: '10px' }}
                        >
                          🔄 Re-run Audit — Check Updated Score
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
