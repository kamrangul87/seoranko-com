/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';
import { useState, useEffect, useRef } from 'react';
import { sanitiseForTransport } from '@/lib/sanitise-text';
import { generateAIBotsRobotsBlock } from '@/lib/robots-checker';
import type { RobotsCheckResult } from '@/lib/robots-checker';
import { generateAIJson } from '@/lib/aeo-signals';
import { GEOAuditor } from '@/components/GEOAuditor';

// Browser-safe base64 encoder: handles Unicode without deprecated unescape()
function safeBtoa(str: string): string {
  try {
    return btoa(str);
  } catch {
    const bytes = new Uint8Array(new TextEncoder().encode(str));
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }
}

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

  // Generate llms.txt state
  const [llmsTxtContent, setLlmsTxtContent] = useState<string | null>(null);
  const [llmsTxtMsg, setLlmsTxtMsg] = useState('');

  // AEO — ai.json + Wikidata wizard state
  const [aiJsonContent, setAiJsonContent] = useState<string | null>(null);
  const [wikidataStep, setWikidataStep] = useState(0);

  // Score simulation (local update after fix)
  const [scoreSimMsg, setScoreSimMsg] = useState<string>('');

  // Expanded categories note — shown after a fresh/smart audit where new categories may lower the score
  const [showExpandedNote, setShowExpandedNote] = useState(false);

  // Quick Fix via SEORANKO script
  const [quickFixSaved, setQuickFixSaved] = useState<Set<string>>(new Set());
  const [applyingFixKey, setApplyingFixKey] = useState<string | null>(null);
  // null = not yet checked, true = script installed + verified, false = not verified
  const [siteVerified, setSiteVerified] = useState<boolean | null>(null);

  // Last audit timestamp (from Supabase)
  const [lastAuditedAt, setLastAuditedAt] = useState<string | null>(null);

  // AI Citation Test
  const [citationOpen, setCitationOpen] = useState(false);
  const [citationTopics, setCitationTopics] = useState('');
  const [citationResults, setCitationResults] = useState<any>(null);
  const [citationLoading, setCitationLoading] = useState(false);
  const [citationMsg, setCitationMsg] = useState('');

  // Drift trend (page_url → drift info)
  const [driftData, setDriftData] = useState<Record<string, any>>({});
  const [driftLoaded, setDriftLoaded] = useState(false);

  // AI Bot robots.txt check
  const [robotsCheckResult, setRobotsCheckResult] = useState<RobotsCheckResult | null>(null);
  const [robotsCheckLoading, setRobotsCheckLoading] = useState(false);
  const [robotsCheckMsg, setRobotsCheckMsg] = useState('');
  const [robotsCopied, setRobotsCopied] = useState(false);

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
          loadDriftData(savedDomain);
        }
      })
      .catch(() => { /* no saved data — stay on audit stage */ })
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadDriftData(domainStr: string) {
    if (!domainStr) return;
    try {
      const res = await fetch(`/api/site-audit/drift?domain=${encodeURIComponent(domainStr)}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.pages?.length > 0) {
        const map: Record<string, any> = {};
        for (const p of data.pages) map[p.page_url] = p;
        setDriftData(map);
        setDriftLoaded(true);
      }
    } catch { /* non-fatal */ }
  }

  async function handleCitationTest() {
    if (!domain || !citationTopics.trim()) return;
    const topics = citationTopics.split('\n').map((t: string) => t.trim()).filter(Boolean).slice(0, 5);
    if (topics.length === 0) return;
    const brandName = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').split('.')[0];
    setCitationLoading(true);
    setCitationMsg('');
    setCitationResults(null);
    try {
      const res = await fetch('/api/site-audit/citations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, brandName, topics }),
      });
      const data = await res.json();
      if (data.error) { setCitationMsg('❌ ' + data.error); return; }
      setCitationResults(data);
      setCitationMsg(`Tested ${data.summary.topicsTested} topics — ${data.summary.mentionRate}% mention rate, ${data.summary.citationRate}% citation rate`);
    } catch (err: any) {
      setCitationMsg('❌ ' + err.message);
    } finally {
      setCitationLoading(false);
    }
  }

  async function handleRobotsCheck() {
    if (!domain) return;
    setRobotsCheckLoading(true);
    setRobotsCheckMsg('');
    setRobotsCheckResult(null);
    try {
      const res = await fetch('/api/robots-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain }),
      });
      const data = await res.json();
      if (data.error && !data.robotsTxtFound) {
        setRobotsCheckMsg('Could not fetch robots.txt — ' + data.error);
        return;
      }
      setRobotsCheckResult(data);
      if (data.allAllowed) {
        setRobotsCheckMsg('All AI bots are allowed.');
      } else {
        setRobotsCheckMsg(`${data.blockedCount} AI bot(s) may be blocked.`);
      }
    } catch (err: any) {
      setRobotsCheckMsg('Error: ' + err.message);
    } finally {
      setRobotsCheckLoading(false);
    }
  }

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

  function handleGenerateLlmsTxt() {
    if (!results?.results) return;
    setLlmsTxtMsg('');
    const siteName = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] || 'This Site';
    const pages = results.results.filter((r: any) => r.httpStatus !== 404 && r.title);
    const topics = Array.from(new Set(
      pages.flatMap((r: any) => (r.h2s || []).slice(0, 3))
    )).slice(0, 20);

    const txt = [
      `# ${siteName}`,
      '',
      `> ${siteName} covers ${pages.slice(0, 3).map((r: any) => r.aiAnalysis?.detectedKeyword || r.title?.split(' ').slice(0, 3).join(' ')).filter(Boolean).join(', ')}.`,
      '',
      '## Important Pages',
      ...pages.slice(0, 30).map((r: any) => {
        const desc = r.metaDescription ? r.metaDescription.slice(0, 100) : r.title;
        return `- [${r.title}](${r.url}): ${desc}`;
      }),
      '',
      '## Topics Covered',
      ...(topics as string[]).map((t: string) => `- ${t}`),
      '',
      `## Contact`,
      `- Homepage: https://${siteName}`,
    ].join('\n');

    setLlmsTxtContent(txt);
    setLlmsTxtMsg(`Generated llms.txt for ${pages.length} pages`);
  }

  function downloadLlmsTxt() {
    if (!llmsTxtContent) return;
    const blob = new Blob([llmsTxtContent], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'llms.txt';
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
          headers: { Authorization: `Basic ${safeBtoa(`${sanitiseForTransport(pf('username'))}:${sanitiseForTransport(pf('password'))}`)}` },
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
    setShowExpandedNote(false);
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
      if (auditMode !== 'cached') setShowExpandedNote(true);
      setStage('results');
      loadDriftData(domain);
      // Check script installation status for the Quick Fix gate
      const siteIdForCheck = domain.trim().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase();
      fetch(`/api/sites?domain=${encodeURIComponent(siteIdForCheck)}`)
        .then(r => r.json())
        .then(d => setSiteVerified(d.verified === true))
        .catch(() => setSiteVerified(false));
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
        const body: any = { message: `SEO fix: ${sanitiseForTransport(title)}`, content: safeBtoa(articleHtml), branch };
        if (sha) body.sha = sha;
        const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, { method: 'PUT', headers, body: JSON.stringify(body) });
        if (res.ok) setPublishSuccess(`✅ Published to GitHub — ${f('repo')}/${path}`);
        else { const e = await res.json(); setPublishSuccess(`❌ GitHub: ${e.message}`); }

      } else if (platformId === 'wordpress') {
        const base = f('url').replace(/\/$/, '');
        const status = 'draft';
        const res = await fetch(`${base}/wp-json/wp/v2/posts`, {
          method: 'POST',
          headers: { Authorization: `Basic ${safeBtoa(`${sanitiseForTransport(f('username'))}:${sanitiseForTransport(f('password'))}`)}`, 'Content-Type': 'application/json' },
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
        const header = safeBtoa(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: id }));
        const payload = safeBtoa(JSON.stringify({ iat: now, exp: now + 300, aud: '/admin/' }));
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

  async function handleApplyFix(pageUrl: string, issue: any) {
    if (!domain || !issue.fix_value) return;
    const siteId = domain.trim().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase();
    const key = `${pageUrl}::${issue.fix_type}`;
    setApplyingFixKey(key);
    try {
      const res = await fetch('/api/site-audit/apply-fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          site_id: siteId,
          page_url: pageUrl,
          fix_type: issue.fix_type,
          fix_value: issue.fix_value,
          old_value: issue.current_value ?? '',
        }),
      });
      if (res.ok) {
        setQuickFixSaved(prev => { const s = new Set(prev); s.add(key); return s; });
        // Optimistically remove the deduction from score
        handleMarkIssueFixed(pageUrl, issue);
      }
    } catch { /* silent */ } finally {
      setApplyingFixKey(null);
    }
  }

  function handleCopyFixCode(issue: any) {
    const code = issue.fix_value || issue.message;
    navigator.clipboard.writeText(code).catch(() => {});
    // Show brief feedback via quickFixSaved re-use (use a copy-specific key)
    const key = `copy::${issue.message.slice(0, 30)}`;
    setQuickFixSaved(prev => { const s = new Set(prev); s.add(key); return s; });
    setTimeout(() => setQuickFixSaved(prev => { const s = new Set(prev); s.delete(key); return s; }), 2000);
  }

  const activePlatform = PLATFORMS.find(p => p.id === selectedPlatform);

  // ── RENDER ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '32px', maxWidth: '1100px', margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>

      {/* GEO Site Auditor — primary Phase 2 feature */}
      <div style={{ background: '#fff', border: '1px solid #E8E8E4', borderRadius: '14px', padding: '24px', marginBottom: '32px' }}>
        <GEOAuditor />
      </div>

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
              { label: 'Avg Search', value: results.summary.avgScore, color: scoreColor(results.summary.avgScore), sub: gradeLabel(results.summary.avgScore) },
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
              const aiReady = results.summary.aiReadyPages ?? results.results.filter((r: any) => (r.aiScore ?? 0) >= 70).length;
              const total = results.results.length;
              return (
                <div style={{ background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: '10px', padding: '14px 16px', minWidth: '120px', textAlign: 'center' as const }}>
                  <div style={{ fontSize: '22px', fontWeight: 800, color: '#EA580C' }}>{aiReady}/{total}</div>
                  <div style={{ fontSize: '11px', color: '#9A3412', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.5px', marginTop: '4px' }}>AI READY</div>
                  <div style={{ fontSize: '9px', color: '#C2410C', marginTop: '2px' }}>AI score ≥ 70</div>
                </div>
              );
            })()}
          </div>

          {/* Install SEORANKO Script banner */}
          <div style={{ background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: '10px', padding: '14px 18px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' as const }}>
            <div style={{ flex: 1, minWidth: '200px' }}>
              <div style={{ fontSize: '13px', fontWeight: 700, color: '#C2410C' }}>⚡ Apply fixes to any site — no GitHub needed</div>
              <div style={{ fontSize: '11px', color: '#92400E', marginTop: '2px' }}>
                Paste one script tag on your WordPress, Shopify, Wix, or custom site. Fixes apply in real-time without a deploy.
              </div>
            </div>
            <a
              href="/dashboard/install"
              style={{ padding: '8px 16px', background: '#C2410C', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' as const, textDecoration: 'none' }}
            >
              Get Install Snippet →
            </a>
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

          {/* Generate llms.txt */}
          <div style={{ background: '#fff', border: '1px solid #E8E8E4', borderRadius: '10px', padding: '14px 18px', marginBottom: '16px', display: 'flex', alignItems: 'center', flexWrap: 'wrap' as const, gap: '10px' }}>
            <div style={{ flex: 1, minWidth: '200px' }}>
              <div style={{ fontSize: '13px', fontWeight: 700, color: '#0F0F0F' }}>🤖 Generate llms.txt</div>
              <div style={{ fontSize: '11px', color: '#9B9B9B', marginTop: '2px' }}>
                Create a structured content guide for AI crawlers (ChatGPT, Claude, Perplexity) — boosts AI citation rate
              </div>
            </div>
            <button
              onClick={handleGenerateLlmsTxt}
              style={{ padding: '8px 16px', background: '#6D28D9', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' as const }}
            >
              🤖 Generate llms.txt
            </button>
            {llmsTxtContent && (
              <button
                onClick={downloadLlmsTxt}
                style={{ padding: '8px 16px', background: '#16A34A', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' as const }}
              >
                ⬇ Download llms.txt
              </button>
            )}
          </div>
          {llmsTxtMsg && (
            <div style={{ background: '#F5F3FF', border: '1px solid #DDD6FE', borderRadius: '8px', padding: '10px 14px', marginBottom: '8px', fontSize: '12px', color: '#6D28D9' }}>
              ✓ {llmsTxtMsg} — upload llms.txt to your website root (e.g. https://{domain.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]}/llms.txt)
            </div>
          )}
          {llmsTxtContent && (
            <div style={{ background: '#F5F4F1', borderRadius: '8px', padding: '10px 14px', marginBottom: '16px', maxHeight: '140px', overflowY: 'auto', fontSize: '11px', color: '#6B6B6B', fontFamily: 'monospace', whiteSpace: 'pre' as const }}>
              {llmsTxtContent.slice(0, 800)}
            </div>
          )}

          {/* Generate ai.json */}
          <div style={{ background: '#fff', border: '1px solid #E8E8E4', borderRadius: '10px', padding: '14px 18px', marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap' as const, gap: '10px' }}>
              <div style={{ flex: 1, minWidth: '200px' }}>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#0F0F0F' }}>🤖 Generate ai.json</div>
                <div style={{ fontSize: '11px', color: '#9B9B9B', marginTop: '2px' }}>
                  Structured entity file for AI engines — place at <code style={{ fontSize: '10px', background: '#F5F4F1', padding: '0 3px', borderRadius: '3px' }}>/.well-known/ai.json</code> to help AI crawlers identify your brand
                </div>
              </div>
              <button
                onClick={() => {
                  const domainClean = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] || 'example.com';
                  const json = generateAIJson({
                    name: domainClean,
                    url: domain.startsWith('http') ? domain : `https://${domainClean}`,
                    description: `Official website of ${domainClean}`,
                    sameAs: [],
                  });
                  setAiJsonContent(json);
                  const blob = new Blob([json], { type: 'application/json' });
                  const a = document.createElement('a');
                  a.href = URL.createObjectURL(blob);
                  a.download = 'ai.json';
                  a.click();
                  URL.revokeObjectURL(a.href);
                }}
                style={{ padding: '8px 16px', background: '#0891b2', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' as const }}
              >
                ⬇ Download ai.json
              </button>
            </div>
            {aiJsonContent && (
              <div style={{ background: '#F0F9FF', borderRadius: '8px', padding: '10px 14px', marginTop: '10px', maxHeight: '120px', overflowY: 'auto', fontSize: '11px', color: '#0c4a6e', fontFamily: 'monospace', whiteSpace: 'pre' as const }}>
                {aiJsonContent.slice(0, 600)}
              </div>
            )}
          </div>

          {/* Wikidata Wizard */}
          <div style={{ background: '#fff', border: '1px solid #E8E8E4', borderRadius: '10px', padding: '14px 18px', marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' as const }}>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#0F0F0F' }}>🌐 Wikidata Entity Wizard</div>
                <div style={{ fontSize: '11px', color: '#9B9B9B', marginTop: '2px' }}>
                  Create a Wikidata entry to unlock Google Knowledge Panels and boost AI citation confidence
                </div>
              </div>
              <button
                onClick={() => setWikidataStep(s => s === 0 ? 1 : 0)}
                style={{ padding: '7px 14px', background: '#F5F4F1', color: '#0F0F0F', border: '1px solid #E8E8E4', borderRadius: '8px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' as const }}
              >
                {wikidataStep === 0 ? 'Start wizard ▼' : 'Hide ▲'}
              </button>
            </div>
            {wikidataStep > 0 && (() => {
              const domainClean = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] || 'your-brand';
              const steps = [
                { title: 'Create a Wikidata account', detail: 'Go to wikidata.org → Create account. Use your real name or brand name as the username. Confirm your email.' },
                { title: 'Search for your entity', detail: `Search "Special:Search" on Wikidata for "${domainClean}". If it already exists, skip to step 5. If not, proceed to create a new item.` },
                { title: 'Create a new item', detail: 'Click "Create a new item" → Enter your brand/company label in English → Add a brief description (e.g. "UK-based SEO software company") → Save.' },
                { title: 'Add key statements', detail: 'Add: instance of (P31) → business (Q4830453) · official website (P856) → ' + (domain || 'https://yoursite.com') + ' · country (P17) → United Kingdom (Q145) · industry (P452) → search engine optimization (Q183756)' },
                { title: 'Add sameAs identifiers', detail: 'Link to your Google Business Profile, LinkedIn company page, Companies House number (P1278 → your CH number), Twitter/X handle (P2002). Each cross-link raises AI confidence.' },
                { title: 'Verify and monitor', detail: 'After saving, paste your Wikidata entity URL (e.g. https://www.wikidata.org/wiki/Q12345) into Google Search Console as a structured data target. Knowledge Panel typically appears within 2–8 weeks.' },
              ];
              return (
                <div style={{ marginTop: '14px' }}>
                  <div style={{ display: 'flex', gap: '4px', marginBottom: '12px', flexWrap: 'wrap' as const }}>
                    {steps.map((_, i) => (
                      <button
                        key={i}
                        onClick={() => setWikidataStep(i + 1)}
                        style={{ width: '28px', height: '28px', borderRadius: '50%', border: 'none', fontSize: '11px', fontWeight: 700, cursor: 'pointer', background: wikidataStep === i + 1 ? '#FF6B2C' : '#F5F4F1', color: wikidataStep === i + 1 ? '#fff' : '#6B6B6B' }}
                      >
                        {i + 1}
                      </button>
                    ))}
                  </div>
                  <div style={{ background: '#FAFAF8', border: '1px solid #E8E8E4', borderRadius: '8px', padding: '12px 14px' }}>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: '#0F0F0F', marginBottom: '6px' }}>Step {wikidataStep}: {steps[wikidataStep - 1].title}</div>
                    <div style={{ fontSize: '12px', color: '#6B6B6B', lineHeight: 1.6 }}>{steps[wikidataStep - 1].detail}</div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '10px' }}>
                    <button
                      onClick={() => setWikidataStep(s => Math.max(1, s - 1))}
                      disabled={wikidataStep === 1}
                      style={{ padding: '6px 12px', background: '#F5F4F1', color: '#6B6B6B', border: '1px solid #E8E8E4', borderRadius: '8px', fontSize: '12px', cursor: wikidataStep === 1 ? 'not-allowed' : 'pointer', opacity: wikidataStep === 1 ? 0.5 : 1 }}
                    >
                      ← Previous
                    </button>
                    {wikidataStep < 6 ? (
                      <button
                        onClick={() => setWikidataStep(s => s + 1)}
                        style={{ padding: '6px 12px', background: '#FF6B2C', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
                      >
                        Next →
                      </button>
                    ) : (
                      <a
                        href="https://www.wikidata.org/wiki/Special:NewItem"
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ padding: '6px 12px', background: '#16A34A', color: '#fff', borderRadius: '8px', fontSize: '12px', fontWeight: 700, textDecoration: 'none' }}
                      >
                        Open Wikidata →
                      </a>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Expanded categories note — shown after a fresh/smart audit */}
          {showExpandedNote && (
            <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: '10px', padding: '10px 16px', marginBottom: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
              <div style={{ fontSize: '12px', color: '#1D4ED8' }}>
                Score recalculated with expanded checks (now auditing 6 categories: Security, Speed, AI Visibility, Links, Mobile, Content)
              </div>
              <button onClick={() => setShowExpandedNote(false)} style={{ background: 'none', border: 'none', color: '#1D4ED8', fontSize: '18px', cursor: 'pointer', flexShrink: 0, lineHeight: 1 }}>×</button>
            </div>
          )}

          {/* AI Citation Test panel */}
          <div style={{ background: '#fff', border: '1px solid #E8E8E4', borderRadius: '10px', padding: '14px 18px', marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' as const }}>
              <div style={{ flex: 1, minWidth: '200px' }}>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#0F0F0F' }}>🎯 AI Citation Test</div>
                <div style={{ fontSize: '11px', color: '#9B9B9B', marginTop: '2px' }}>
                  Ask Claude with live web search if it mentions your brand for specific topics — tests real AI citation visibility
                </div>
              </div>
              <button
                onClick={() => setCitationOpen(o => !o)}
                style={{ padding: '7px 14px', background: '#F5F4F1', color: '#0F0F0F', border: '1px solid #E8E8E4', borderRadius: '8px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' as const }}
              >
                {citationOpen ? 'Hide ▲' : 'Test Citation ▼'}
              </button>
            </div>

            {citationOpen ? (
              <div style={{ marginTop: '14px' }}>
                {/* Topic input */}
                <div style={{ marginBottom: '10px' }}>
                  <label style={{ fontSize: '11px', fontWeight: 600, color: '#6B6B6B', textTransform: 'uppercase' as const, letterSpacing: '0.4px', display: 'block', marginBottom: '4px' }}>
                    Test topics (one per line, max 5)
                  </label>
                  <textarea
                    value={citationTopics}
                    onChange={e => setCitationTopics(e.target.value)}
                    placeholder={'best SEO audit tools\nAI content writing software\nsite audit for small business'}
                    rows={3}
                    style={{ width: '100%', fontSize: '12px', padding: '8px 10px', border: '1px solid #E8E8E4', borderRadius: '8px', fontFamily: 'monospace', resize: 'vertical' as const, boxSizing: 'border-box' as const, color: '#0F0F0F', background: '#FAFAF8' }}
                  />
                </div>
                <button
                  onClick={handleCitationTest}
                  disabled={citationLoading || !citationTopics.trim()}
                  style={{ padding: '8px 18px', background: '#6D28D9', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: (citationLoading || !citationTopics.trim()) ? 'not-allowed' : 'pointer', opacity: (citationLoading || !citationTopics.trim()) ? 0.6 : 1 }}
                >
                  {citationLoading ? '⏳ Testing...' : '🎯 Run Citation Test'}
                </button>

                {citationMsg && (
                  <div style={{ marginTop: '10px', fontSize: '12px', color: citationMsg.includes('❌') ? '#DC2626' : '#16A34A', fontWeight: 600 }}>
                    {citationMsg}
                  </div>
                )}

                {citationResults?.results?.length > 0 && (
                  <div style={{ marginTop: '14px', display: 'flex', flexDirection: 'column' as const, gap: '8px' }}>
                    {citationResults.results.map((r: any, i: number) => (
                      <div key={i} style={{ background: '#FAFAF8', border: '1px solid #E8E8E4', borderRadius: '8px', padding: '10px 14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' as const, marginBottom: r.competitorsCited?.length > 0 ? '6px' : 0 }}>
                          <span style={{ fontSize: '12px', fontWeight: 600, color: '#0F0F0F', flex: 1 }}>{r.topic}</span>
                          <span style={{
                            fontSize: '9px', fontWeight: 700, padding: '2px 7px', borderRadius: '20px',
                            background: r.mentioned ? '#F0FDF4' : '#F5F4F1',
                            color: r.mentioned ? '#16A34A' : '#9B9B9B',
                            border: `1px solid ${r.mentioned ? '#BBF7D0' : '#E8E8E4'}`,
                          }}>
                            {r.mentioned ? '✓ MENTIONED' : '✗ NOT MENTIONED'}
                          </span>
                          <span style={{
                            fontSize: '9px', fontWeight: 700, padding: '2px 7px', borderRadius: '20px',
                            background: r.cited ? '#EFF6FF' : '#F5F4F1',
                            color: r.cited ? '#1D4ED8' : '#9B9B9B',
                            border: `1px solid ${r.cited ? '#BFDBFE' : '#E8E8E4'}`,
                          }}>
                            {r.cited ? '✓ CITED' : '✗ NOT CITED'}
                          </span>
                        </div>
                        {r.competitorsCited?.length > 0 && (
                          <div style={{ fontSize: '11px', color: '#6B6B6B' }}>
                            <span style={{ fontWeight: 600, color: '#DC2626' }}>Competitors cited instead: </span>
                            {r.competitorsCited.join(', ')}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </div>

          {/* AI Bot Access (robots.txt) panel */}
          <div style={{ background: '#fff', border: '1px solid #E8E8E4', borderRadius: '10px', padding: '14px 18px', marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' as const }}>
              <div style={{ flex: 1, minWidth: '200px' }}>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#0F0F0F' }}>🤖 AI Bot Access</div>
                <div style={{ fontSize: '11px', color: '#9B9B9B', marginTop: '2px' }}>
                  Check if ChatGPT, Perplexity, Claude and other AI crawlers are allowed in your robots.txt
                </div>
              </div>
              <button
                onClick={handleRobotsCheck}
                disabled={robotsCheckLoading || !domain}
                style={{ padding: '7px 14px', background: '#F5F4F1', color: '#0F0F0F', border: '1px solid #E8E8E4', borderRadius: '8px', fontSize: '12px', fontWeight: 600, cursor: (robotsCheckLoading || !domain) ? 'not-allowed' : 'pointer', opacity: (robotsCheckLoading || !domain) ? 0.6 : 1, whiteSpace: 'nowrap' as const }}
              >
                {robotsCheckLoading ? '⏳ Checking...' : 'Check robots.txt'}
              </button>
            </div>

            {robotsCheckMsg && (
              <div style={{ marginTop: '10px', fontSize: '12px', color: robotsCheckResult?.allAllowed ? '#16A34A' : '#DC2626', fontWeight: 600 }}>
                {robotsCheckMsg}
              </div>
            )}

            {robotsCheckResult && robotsCheckResult.robotsTxtFound && (
              <div style={{ marginTop: '14px' }}>
                <div style={{ display: 'flex', flexDirection: 'column' as const, gap: '0' }}>
                  {robotsCheckResult.results.map((r, i) => (
                    <div key={r.bot.userAgent} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: i < robotsCheckResult.results.length - 1 ? '1px solid #F5F4F1' : 'none' }}>
                      <div>
                        <span style={{ fontSize: '12px', fontWeight: 600, color: '#0F0F0F' }}>{r.bot.name}</span>
                        <span style={{ fontSize: '11px', color: '#9B9B9B', marginLeft: '6px' }}>({r.bot.userAgent})</span>
                      </div>
                      <span style={{
                        fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px',
                        background: r.status === 'allowed' ? '#F0FDF4' : r.status === 'blocked' ? '#FEF2F2' : '#F5F4F1',
                        color: r.status === 'allowed' ? '#16A34A' : r.status === 'blocked' ? '#DC2626' : '#9B9B9B',
                        border: `1px solid ${r.status === 'allowed' ? '#BBF7D0' : r.status === 'blocked' ? '#FECACA' : '#E8E8E4'}`,
                      }}>
                        {r.status === 'allowed' ? '✓ Allowed' : r.status === 'blocked' ? '✗ Blocked' : 'Unknown'}
                      </span>
                    </div>
                  ))}
                </div>

                {!robotsCheckResult.allAllowed && (
                  <div style={{ marginTop: '14px', background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: '8px', padding: '12px 14px' }}>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: '#92400E', marginBottom: '8px' }}>
                      Add this to your robots.txt to allow all AI bots:
                    </div>
                    <pre style={{ fontSize: '11px', color: '#1C1917', background: '#F5F5F4', padding: '10px', borderRadius: '6px', overflow: 'auto', margin: 0 }}>
                      {generateAIBotsRobotsBlock()}
                    </pre>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(generateAIBotsRobotsBlock());
                        setRobotsCopied(true);
                        setTimeout(() => setRobotsCopied(false), 2000);
                      }}
                      style={{ marginTop: '8px', padding: '6px 14px', background: '#FF6B2C', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
                    >
                      {robotsCopied ? '✓ Copied!' : 'Copy fix'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

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
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-start' }}>
                          {/* Search score */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                            <div style={{
                              width: '32px', height: '32px', borderRadius: '50%', flexShrink: 0,
                              border: `2px solid ${scoreColor(page.searchScore ?? page.score)}`,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontSize: '13px', fontWeight: 700, color: scoreColor(page.searchScore ?? page.score),
                            }}>
                              {gradeLabel(page.searchScore ?? page.score)}
                            </div>
                            <div>
                              <div style={{ fontSize: '9px', color: '#9B9B9B', lineHeight: 1 }}>SEARCH</div>
                              <div style={{ fontSize: '11px', fontWeight: 700, color: scoreColor(page.searchScore ?? page.score) }}>{page.searchScore ?? page.score}</div>
                            </div>
                          </div>
                          {/* AI score */}
                          {page.aiScore != null && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                              <div style={{
                                width: '32px', height: '32px', borderRadius: '50%', flexShrink: 0,
                                border: `2px solid ${scoreColor(page.aiScore)}`,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: '13px', fontWeight: 700, color: scoreColor(page.aiScore),
                              }}>
                                {gradeLabel(page.aiScore)}
                              </div>
                              <div>
                                <div style={{ fontSize: '9px', color: '#EA580C', lineHeight: 1 }}>AI</div>
                                <div style={{ fontSize: '11px', fontWeight: 700, color: scoreColor(page.aiScore) }}>{page.aiScore}</div>
                              </div>
                            </div>
                          )}
                          {scoreGainDisplay != null && scoreGainDisplay > 0 && (
                            <div style={{ fontSize: '9px', color: '#16A34A', fontWeight: 700 }}>
                              {page.scoreBeforeFix} → {page.scoreAfterFix} (+{scoreGainDisplay})
                            </div>
                          )}
                          {/* Drift trend badge */}
                          {driftLoaded && (() => {
                            const normUrl = page.url.replace(/^https?:\/\//, 'https://').replace(/\/$/, '');
                            const drift = driftData[normUrl] || driftData[page.url];
                            if (!drift || drift.change_from_previous == null) return null;
                            const ch = drift.change_from_previous;
                            if (ch === 0) return null;
                            const up = ch > 0;
                            return (
                              <div style={{ fontSize: '9px', fontWeight: 700, color: up ? '#16A34A' : '#DC2626' }}>
                                {up ? '↑' : '↓'} {up ? '+' : ''}{ch} vs last audit
                              </div>
                            );
                          })()}
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
                                                const effortIcon = issue.effort === '2min' ? '⚡' : issue.effort === '30min' ? '🔧' : issue.effort === '1hour' ? '🛠️' : null;
                                                const effortColor = issue.effort === '2min' ? '#16A34A' : issue.effort === '30min' ? '#D97706' : '#6B7280';
                                                const fixKey = issue.fix_type ? `${page.url}::${issue.fix_type}` : '';
                                                const isApplied = fixKey ? quickFixSaved.has(fixKey) : false;
                                                const isApplying = applyingFixKey === fixKey;
                                                const copyKey = `copy::${issue.message.slice(0, 30)}`;
                                                const isCopied = quickFixSaved.has(copyKey);

                                                return (
                                                  <div key={j} style={{ background: '#fff', border: '1px solid #E8E8E4', borderRadius: '8px', padding: '10px 12px' }}>
                                                    {/* Header row: severity badge + message + effort badge */}
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' as const, marginBottom: '6px' }}>
                                                      <span style={{
                                                        fontSize: '9px', fontWeight: 700, padding: '2px 6px', borderRadius: '20px',
                                                        background: sevBg, color: sevColor, border: `1px solid ${sevBorder}`,
                                                        whiteSpace: 'nowrap' as const, flexShrink: 0,
                                                      }}>
                                                        {sevLabel}{sevPts ? ` ${sevPts}` : ''}
                                                      </span>
                                                      <span style={{ fontSize: '12px', color: '#0F0F0F', fontWeight: 500, flex: 1 }}>{issue.message}</span>
                                                      {effortIcon && (
                                                        <span style={{ fontSize: '9px', fontWeight: 700, color: effortColor, whiteSpace: 'nowrap' as const, flexShrink: 0 }}>
                                                          {effortIcon} {issue.effort} fix
                                                        </span>
                                                      )}
                                                      {issue.confidence === 'low' && (
                                                        <span style={{ fontSize: '8px', fontWeight: 700, color: '#9B9B9B', border: '1px solid #E8E8E4', borderRadius: '20px', padding: '1px 5px', whiteSpace: 'nowrap' as const, flexShrink: 0 }} title="Low-confidence signal — emerging standard, not yet widely adopted">
                                                          EXPERIMENTAL
                                                        </span>
                                                      )}
                                                      {issue.confidence === 'medium' && (
                                                        <span style={{ fontSize: '8px', fontWeight: 700, color: '#D97706', border: '1px solid #FDE68A', borderRadius: '20px', padding: '1px 5px', whiteSpace: 'nowrap' as const, flexShrink: 0 }} title="Medium-confidence signal — important but impact varies by site">
                                                          SIGNAL
                                                        </span>
                                                      )}
                                                    </div>

                                                    {/* Fix preview: current value (red) → fix value (green) */}
                                                    {(issue.current_value != null || issue.fix_value) && !isApplied && (
                                                      <div style={{ marginBottom: '8px', fontSize: '11px' }}>
                                                        {issue.current_value != null && issue.current_value !== '' && (
                                                          <div style={{ color: '#DC2626', marginBottom: '2px' }}>
                                                            <span style={{ fontWeight: 600 }}>Currently: </span>
                                                            <span style={{ fontFamily: 'monospace', background: '#FEF2F2', padding: '1px 4px', borderRadius: '3px' }}>
                                                              {String(issue.current_value).length > 80 ? String(issue.current_value).slice(0, 80) + '...' : String(issue.current_value)}
                                                            </span>
                                                          </div>
                                                        )}
                                                        {issue.fix_value != null && (
                                                          <div style={{ color: '#16A34A' }}>
                                                            <span style={{ fontWeight: 600 }}>Will become: </span>
                                                            <span style={{ fontFamily: 'monospace', background: '#F0FDF4', padding: '1px 4px', borderRadius: '3px' }}>
                                                              {String(issue.fix_value).length > 80 ? String(issue.fix_value).slice(0, 80) + '...' : String(issue.fix_value)}
                                                            </span>
                                                          </div>
                                                        )}
                                                      </div>
                                                    )}

                                                    {/* Applied confirmation */}
                                                    {isApplied && (
                                                      <div style={{ fontSize: '11px', color: '#16A34A', fontWeight: 600, marginBottom: '8px' }}>
                                                        ✅ Fix applied — live on your site within 60 seconds via SEORANKO script
                                                      </div>
                                                    )}

                                                    {/* Action buttons */}
                                                    {!isApplied && (
                                                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', flexWrap: 'wrap' as const }}>
                                                        {issue.auto_fixable && issue.fix_value ? (
                                                          siteVerified === false ? (
                                                            <a
                                                              href="/dashboard/install"
                                                              onClick={e => e.stopPropagation()}
                                                              style={{ fontSize: '10px', fontWeight: 600, padding: '4px 10px', background: '#F5F4F1', color: '#6B6B6B', border: '1px solid #E8E8E4', borderRadius: '4px', cursor: 'pointer', textDecoration: 'none' }}
                                                            >
                                                              ⚡ Install script to apply instantly →
                                                            </a>
                                                          ) : (
                                                            <button
                                                              onClick={e => { e.stopPropagation(); handleApplyFix(page.url, issue); }}
                                                              disabled={isApplying}
                                                              style={{ fontSize: '11px', fontWeight: 700, padding: '5px 12px', background: isApplying ? '#D1FAE5' : '#16A34A', color: '#fff', border: 'none', borderRadius: '6px', cursor: isApplying ? 'default' : 'pointer', whiteSpace: 'nowrap' as const }}
                                                            >
                                                              {isApplying ? '⏳ Applying...' : '⚡ Apply Fix Now'}
                                                            </button>
                                                          )
                                                        ) : issue.fix_value ? (
                                                          <button
                                                            onClick={e => { e.stopPropagation(); handleCopyFixCode(issue); }}
                                                            style={{ fontSize: '11px', fontWeight: 600, padding: '5px 12px', background: isCopied ? '#F0FDF4' : '#F5F4F1', color: isCopied ? '#16A34A' : '#374151', border: `1px solid ${isCopied ? '#BBF7D0' : '#E8E8E4'}`, borderRadius: '6px', cursor: 'pointer', whiteSpace: 'nowrap' as const }}
                                                          >
                                                            {isCopied ? '✅ Copied!' : '📋 Copy Fix Code'}
                                                          </button>
                                                        ) : null}
                                                      </div>
                                                    )}

                                                    {/* Mark as Fixed manually */}
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
                                      {quickWins.map((win: string, j: number) => {
                                        const engineMatch = win.match(/^\[(ChatGPT|Perplexity|Google AIO|Claude)\]\s*/);
                                        const engineColors: Record<string, string> = {
                                          ChatGPT: '#10A37F', Perplexity: '#6366F1', 'Google AIO': '#1A73E8', Claude: '#D97706',
                                        };
                                        const engineColor = engineMatch ? engineColors[engineMatch[1]] || '#16A34A' : '#16A34A';
                                        const label = engineMatch ? engineMatch[0] : '';
                                        const text = engineMatch ? win.slice(label.length) : win;
                                        return (
                                          <div key={j} style={{ fontSize: '12px', color: '#0F0F0F', display: 'flex', gap: '6px' }}>
                                            <span style={{ color: engineColor, flexShrink: 0 }}>→</span>
                                            {label && <span style={{ fontSize: '10px', fontWeight: 700, color: engineColor, background: engineColor + '15', padding: '1px 5px', borderRadius: '4px', flexShrink: 0 }}>{engineMatch![1]}</span>}
                                            {text}
                                          </div>
                                        );
                                      })}
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
                          {/* AI VISIBILITY section */}
                          {(() => {
                            const aiIs = page.issues.filter((i: any) => i.category === 'ai');
                            if (aiIs.length === 0 && page.aiScore == null) return null;
                            const aiScoreVal = page.aiScore ?? 0;
                            return (
                              <div style={{ marginTop: '16px', borderTop: '1px solid #FED7AA', paddingTop: '14px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                                  <div style={{ fontSize: '11px', fontWeight: 700, color: '#EA580C', textTransform: 'uppercase' as const, letterSpacing: '0.5px' }}>
                                    🤖 AI VISIBILITY
                                  </div>
                                  {page.aiScore != null && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                      <div style={{ width: '22px', height: '22px', borderRadius: '50%', border: `2px solid ${scoreColor(aiScoreVal)}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 700, color: scoreColor(aiScoreVal) }}>
                                        {gradeLabel(aiScoreVal)}
                                      </div>
                                      <span style={{ fontSize: '12px', fontWeight: 700, color: scoreColor(aiScoreVal) }}>{aiScoreVal}/100</span>
                                      <span style={{ fontSize: '10px', color: '#9B9B9B' }}>AI Score</span>
                                    </div>
                                  )}
                                </div>
                                {aiIs.length === 0 ? (
                                  <div style={{ fontSize: '12px', color: '#16A34A' }}>✓ No AI visibility issues found — this page is AI-ready</div>
                                ) : (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                    {aiIs.map((issue: any, j: number) => {
                                      const sevColor = issue.severity === 'critical' ? '#DC2626' : issue.severity === 'warning' ? '#D97706' : '#6D28D9';
                                      const sevBg = issue.severity === 'critical' ? '#FEF2F2' : issue.severity === 'warning' ? '#FFFBEB' : '#F5F3FF';
                                      return (
                                        <div key={j} style={{ background: sevBg, borderRadius: '6px', padding: '8px 10px', display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                                          <span style={{ fontSize: '9px', fontWeight: 700, color: sevColor, background: '#fff', padding: '1px 5px', borderRadius: '3px', flexShrink: 0, marginTop: '1px' }}>
                                            {issue.severity === 'critical' ? 'CRITICAL' : issue.severity === 'warning' ? 'WARN' : 'TIP'} -{issue.deduction}
                                          </span>
                                          <span style={{ fontSize: '11px', color: '#0F0F0F' }}>{issue.message}</span>
                                        </div>
                                      );
                                    })}
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
