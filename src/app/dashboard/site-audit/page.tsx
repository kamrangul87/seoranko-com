/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';
import { useState } from 'react';

const platforms = [
  {
    id: 'copy',
    icon: '📋',
    label: 'Copy HTML',
    desc: 'Any platform',
    color: '#4B5563',
    noForm: true,
    fields: undefined,
  },
  {
    id: 'github',
    icon: '🐙',
    label: 'GitHub',
    desc: 'Static / Next.js',
    color: '#24292f',
    noForm: false,
    fields: [
      { key: 'repo', placeholder: 'owner/repo (e.g. kamrangul87/autodun-ai)', label: 'Repository', type: 'text', hint: '' },
      { key: 'path', placeholder: 'public/blog/article.html', label: 'File path', type: 'text', hint: '' },
      { key: 'token', placeholder: 'ghp_xxxxxxxxxxxx', label: 'Personal Access Token', type: 'password', hint: 'github.com/settings/tokens → repo → contents' },
      { key: 'branch', placeholder: 'main', label: 'Branch (default: main)', type: 'text', hint: '' },
    ],
  },
  {
    id: 'wordpress',
    icon: '🌐',
    label: 'WordPress',
    desc: 'Self-hosted / .com',
    color: '#21759b',
    noForm: false,
    fields: [
      { key: 'url', placeholder: 'https://yoursite.com', label: 'Site URL', type: 'text', hint: '' },
      { key: 'username', placeholder: 'admin', label: 'Username', type: 'text', hint: '' },
      { key: 'password', placeholder: 'xxxx xxxx xxxx xxxx', label: 'Application Password', type: 'password', hint: 'WP Admin → Users → Profile → Application Passwords' },
      { key: 'status', placeholder: 'draft', label: 'Post status (draft or publish)', type: 'text', hint: '' },
    ],
  },
  {
    id: 'shopify',
    icon: '🛍️',
    label: 'Shopify',
    desc: 'Shopify blogs',
    color: '#96bf48',
    noForm: false,
    fields: [
      { key: 'store', placeholder: 'your-store.myshopify.com', label: 'Store domain', type: 'text', hint: '' },
      { key: 'token', placeholder: 'shpat_xxxxxxxxxxxx', label: 'Admin API Token', type: 'password', hint: 'Shopify Admin → Settings → Apps → Develop apps → Create app → Admin API access token' },
      { key: 'blogId', placeholder: 'Blog ID (find in Shopify admin URL)', label: 'Blog ID', type: 'text', hint: '' },
    ],
  },
  {
    id: 'ghost',
    icon: '👻',
    label: 'Ghost',
    desc: 'Ghost CMS',
    color: '#212121',
    noForm: false,
    fields: [
      { key: 'url', placeholder: 'https://yoursite.ghost.io', label: 'Ghost URL', type: 'text', hint: '' },
      { key: 'adminKey', placeholder: 'id:secret format from Ghost Admin', label: 'Admin API Key', type: 'password', hint: 'Ghost Admin → Settings → Integrations → Add custom integration' },
      { key: 'status', placeholder: 'draft', label: 'Status (draft or published)', type: 'text', hint: '' },
    ],
  },
  {
    id: 'webflow',
    icon: '🔷',
    label: 'Webflow',
    desc: 'Webflow CMS',
    color: '#4353ff',
    noForm: false,
    fields: [
      { key: 'token', placeholder: 'Webflow API token', label: 'API Token', type: 'password', hint: 'Webflow Dashboard → Account → Integrations → API Access' },
      { key: 'collectionId', placeholder: 'Collection ID from Webflow', label: 'CMS Collection ID', type: 'text', hint: 'Found in Webflow CMS settings URL' },
      { key: 'siteId', placeholder: 'Site ID from Webflow', label: 'Site ID', type: 'text', hint: '' },
    ],
  },
  {
    id: 'contentful',
    icon: '📦',
    label: 'Contentful',
    desc: 'Headless CMS',
    color: '#2478cc',
    noForm: false,
    fields: [
      { key: 'spaceId', placeholder: 'Space ID', label: 'Space ID', type: 'text', hint: 'Contentful → Settings → General settings' },
      { key: 'token', placeholder: 'Content Management Token', label: 'Management Token', type: 'password', hint: 'Contentful → Settings → API keys → Content management tokens' },
      { key: 'contentType', placeholder: 'blogPost', label: 'Content Type ID', type: 'text', hint: '' },
    ],
  },
  {
    id: 'wix',
    icon: '🔶',
    label: 'Wix',
    desc: 'Wix blog',
    color: '#faad4d',
    noForm: false,
    fields: [
      { key: 'apiKey', placeholder: 'Wix API Key', label: 'API Key', type: 'password', hint: 'Wix Dashboard → Settings → Advanced → API Keys' },
      { key: 'siteId', placeholder: 'Wix Site ID', label: 'Site ID', type: 'text', hint: 'Found in Wix dashboard URL' },
    ],
  },
];

export default function SiteAuditPage() {
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
  const [discoveredCount, setDiscoveredCount] = useState(0);
  const [expandedUrl, setExpandedUrl] = useState<string | null>(null);

  // Fix panel state
  const [fixing, setFixing] = useState(false);
  const [fixResult, setFixResult] = useState<any>(null);
  const [showFixPanel, setShowFixPanel] = useState(false);
  const [fixStage, setFixStage] = useState('');

  // Publish state
  const [publishMode, setPublishMode] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishSuccess, setPublishSuccess] = useState('');
  const [publishFields, setPublishFields] = useState<Record<string, string>>({});

  const updateField = (key: string, val: string) =>
    setPublishFields(prev => ({ ...prev, [key]: val }));

  async function handleAudit() {
    if (mode === 'domain' && !domain.trim()) {
      setError('Please enter a domain');
      return;
    }
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
    setDiscoveredCount(0);
    setProgress(5);
    setProgressLabel(mode === 'domain' ? `Discovering pages on ${domain}...` : 'Starting audit...');

    const stages = mode === 'domain' ? [
      { pct: 15, label: `Reading sitemap.xml on ${domain}...` },
      { pct: 30, label: 'Pages discovered — fetching content...' },
      { pct: 50, label: 'Analysing page structure and EEAT signals...' },
      { pct: 70, label: 'Finding keyword opportunities...' },
      { pct: 85, label: 'Identifying content gaps with AI...' },
      { pct: 95, label: 'Building audit report...' },
    ] : [
      { pct: 20, label: 'Fetching pages...' },
      { pct: 40, label: 'Analysing EEAT signals...' },
      { pct: 60, label: 'Finding keyword opportunities...' },
      { pct: 80, label: 'Identifying content gaps...' },
      { pct: 95, label: 'Building report...' },
    ];

    let stageIndex = 0;
    const interval = setInterval(() => {
      if (stageIndex < stages.length) {
        setProgress(stages[stageIndex].pct);
        setProgressLabel(stages[stageIndex].label);
        stageIndex++;
      }
    }, 5000);

    try {
      const payload = mode === 'domain'
        ? { domain: domain.trim(), market }
        : { urls: urls.split('\n').map((u: string) => u.trim()).filter(Boolean), market };

      const res = await fetch('/api/site-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      clearInterval(interval);

      if (!res.ok) {
        const err = await res.text();
        setError('Audit failed: ' + err.slice(0, 200));
        return;
      }

      const data = await res.json();
      if (data.error) { setError(data.error); return; }

      setProgress(100);
      setProgressLabel('Audit complete!');
      setDiscoverySource(data.discoverySource || '');
      setDiscoveryError(data.discoveryError || '');
      setDiscoveredCount(data.results?.length || 0);
      setResults(data);

    } catch (err: any) {
      clearInterval(interval);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleFixPage(page: any) {
    setFixing(true);
    setFixResult(null);
    setShowFixPanel(true);
    setFixStage('Fetching page content...');
    setPublishMode(null);
    setPublishSuccess('');
    setPublishFields({});

    const stages = [
      { delay: 3000, label: 'Finding low KD keyword opportunities...' },
      { delay: 8000, label: 'Analysing top 3 competitors...' },
      { delay: 14000, label: 'Building improvement brief...' },
      { delay: 20000, label: 'Writing Google 2026-optimised article...' },
      { delay: 35000, label: 'Validating and humanising content...' },
    ];

    const timers = stages.map(({ delay, label }) => setTimeout(() => setFixStage(label), delay));

    try {
      const res = await fetch('/api/site-audit/fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: page.url,
          detectedKeyword: page.aiAnalysis?.detectedKeyword || page.title || '',
          issues: page.issues || [],
          market,
          pageScore: page.score,
        }),
      });

      timers.forEach(t => clearTimeout(t));

      if (!res.ok) {
        let errMsg = 'Fix failed';
        try {
          const errData = await res.json();
          errMsg = errData.error || errMsg;
        } catch {
          errMsg = await res.text().catch(() => errMsg);
        }
        setFixStage('❌ Error: ' + errMsg.slice(0, 150));
        return;
      }

      let data: any;
      try {
        data = await res.json();
      } catch {
        setFixStage('❌ Invalid response from server');
        return;
      }

      if (data.error) {
        setFixStage('❌ Error: ' + data.error);
        return;
      }

      setFixResult(data);
      setFixStage('');
    } catch (err: any) {
      timers.forEach(t => clearTimeout(t));
      setFixStage('❌ Error: ' + err.message);
    } finally {
      setFixing(false);
    }
  }

  async function handlePublish(platform: string, articleHtml: string, fr: any) {
    setPublishing(true);
    setPublishSuccess('');

    const f = (key: string) => publishFields[`${platform}_${key}`] || '';
    const titleMatch = articleHtml.match(/<h1[^>]*>([^<]*)<\/h1>/i);
    const title = titleMatch?.[1]?.replace(/<[^>]+>/g, '').trim() || fr?.keyword || 'Improved Article';
    const kwSlug = fr?.keyword?.toLowerCase().replace(/[^a-z0-9]+/g, '-') || '';

    try {
      // ── GITHUB ──────────────────────────────────────────────
      if (platform === 'github') {
        const [owner, repo] = f('repo').split('/');
        const path = f('path');
        const token = f('token');
        const branch = f('branch') || 'main';

        if (!owner || !repo || !path || !token) {
          setPublishSuccess('❌ Fill in all GitHub fields');
          return;
        }

        const headers: Record<string, string> = {
          Authorization: `token ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/vnd.github.v3+json',
        };

        let sha = '';
        try {
          const getRes = await fetch(
            `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`,
            { headers }
          );
          if (getRes.ok) {
            const existing = await getRes.json();
            sha = existing.sha;
          }
        } catch { /* new file */ }

        const body: any = {
          message: `SEO fix: ${title} — improved via SEORANKO`,
          content: btoa(unescape(encodeURIComponent(articleHtml))),
          branch,
        };
        if (sha) body.sha = sha;

        const res = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
          { method: 'PUT', headers, body: JSON.stringify(body) }
        );

        if (res.ok) {
          setPublishSuccess(`✅ Published to GitHub — ${f('repo')}/${path} on branch ${branch}`);
        } else {
          const err = await res.json();
          setPublishSuccess(`❌ GitHub error: ${err.message}`);
        }
      }

      // ── WORDPRESS ────────────────────────────────────────────
      else if (platform === 'wordpress') {
        const base = f('url').replace(/\/$/, '');
        const credentials = btoa(`${f('username')}:${f('password')}`);
        const status = f('status') || 'draft';

        if (!base || !f('username') || !f('password')) {
          setPublishSuccess('❌ Fill in all WordPress fields');
          return;
        }

        const res = await fetch(`${base}/wp-json/wp/v2/posts`, {
          method: 'POST',
          headers: {
            Authorization: `Basic ${credentials}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ title, content: articleHtml, status, slug: kwSlug }),
        });

        if (res.ok) {
          const post = await res.json();
          setPublishSuccess(
            status === 'draft'
              ? `✅ Saved as draft — review at ${base}/wp-admin/post.php?post=${post.id}&action=edit`
              : `✅ Published to WordPress — ${post.link}`
          );
        } else {
          const err = await res.json().catch(() => ({}));
          setPublishSuccess(`❌ WordPress error: ${err.message || 'Check credentials and Application Password'}`);
        }
      }

      // ── SHOPIFY ──────────────────────────────────────────────
      else if (platform === 'shopify') {
        const store = f('store').replace(/^https?:\/\//, '').replace(/\/$/, '');
        const token = f('token');
        const blogId = f('blogId');

        if (!store || !token || !blogId) {
          setPublishSuccess('❌ Fill in all Shopify fields');
          return;
        }

        const res = await fetch(`https://${store}/admin/api/2024-01/blogs/${blogId}/articles.json`, {
          method: 'POST',
          headers: {
            'X-Shopify-Access-Token': token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ article: { title, body_html: articleHtml, published: false } }),
        });

        if (res.ok) {
          const data = await res.json();
          setPublishSuccess(`✅ Saved to Shopify blog as draft — article ID: ${data.article?.id}`);
        } else {
          const err = await res.json().catch(() => ({}));
          setPublishSuccess(`❌ Shopify error: ${JSON.stringify(err).slice(0, 150)}`);
        }
      }

      // ── GHOST ────────────────────────────────────────────────
      else if (platform === 'ghost') {
        const base = f('url').replace(/\/$/, '');
        const adminKey = f('adminKey');
        const status = f('status') || 'draft';

        if (!base || !adminKey) {
          setPublishSuccess('❌ Fill in all Ghost fields');
          return;
        }

        const [id, secret] = adminKey.split(':');
        if (!id || !secret) {
          setPublishSuccess('❌ Ghost key must be in format: id:secret');
          return;
        }

        const now = Math.floor(Date.now() / 1000);
        const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: id }));
        const payload = btoa(JSON.stringify({ iat: now, exp: now + 300, aud: '/admin/' }));

        const res = await fetch(`${base}/ghost/api/admin/posts/`, {
          method: 'POST',
          headers: {
            Authorization: `Ghost ${header}.${payload}.signature`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ posts: [{ title, html: articleHtml, status }] }),
        });

        if (res.ok) {
          const data = await res.json();
          setPublishSuccess(`✅ ${status === 'draft' ? 'Saved as draft' : 'Published'} to Ghost — ID: ${data.posts?.[0]?.id}`);
        } else {
          setPublishSuccess('❌ Ghost error — check your Admin API key format (id:secret)');
        }
      }

      // ── WEBFLOW ──────────────────────────────────────────────
      else if (platform === 'webflow') {
        const token = f('token');
        const collectionId = f('collectionId');

        if (!token || !collectionId) {
          setPublishSuccess('❌ Fill in all Webflow fields');
          return;
        }

        const res = await fetch(`https://api.webflow.com/v2/collections/${collectionId}/items`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'accept-version': '1.0.0',
          },
          body: JSON.stringify({
            isArchived: false,
            isDraft: true,
            fieldData: { name: title, slug: kwSlug, 'post-body': articleHtml },
          }),
        });

        if (res.ok) {
          const data = await res.json();
          setPublishSuccess(`✅ Saved to Webflow CMS as draft — ID: ${data.id || 'created'}`);
        } else {
          const err = await res.json().catch(() => ({}));
          setPublishSuccess(`❌ Webflow error: ${err.message || 'Check token and collection ID'}`);
        }
      }

      // ── CONTENTFUL ───────────────────────────────────────────
      else if (platform === 'contentful') {
        const spaceId = f('spaceId');
        const token = f('token');
        const contentType = f('contentType') || 'blogPost';

        if (!spaceId || !token) {
          setPublishSuccess('❌ Fill in all Contentful fields');
          return;
        }

        const res = await fetch(
          `https://api.contentful.com/spaces/${spaceId}/environments/master/entries`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/vnd.contentful.management.v1+json',
              'X-Contentful-Content-Type': contentType,
            },
            body: JSON.stringify({
              fields: {
                title: { 'en-US': title },
                body: { 'en-US': articleHtml },
                slug: { 'en-US': kwSlug },
              },
            }),
          }
        );

        if (res.ok) {
          const data = await res.json();
          setPublishSuccess(`✅ Saved to Contentful as draft — ID: ${data.sys?.id}`);
        } else {
          const err = await res.json().catch(() => ({}));
          setPublishSuccess(`❌ Contentful error: ${err.message || 'Check space ID and token'}`);
        }
      }

      // ── WIX ──────────────────────────────────────────────────
      else if (platform === 'wix') {
        const apiKey = f('apiKey');
        const siteId = f('siteId');

        if (!apiKey || !siteId) {
          setPublishSuccess('❌ Fill in all Wix fields');
          return;
        }

        const res = await fetch('https://www.wixapis.com/blog/v3/draft-posts', {
          method: 'POST',
          headers: {
            Authorization: apiKey,
            'wix-site-id': siteId,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            draftPost: {
              title,
              richContent: {
                nodes: [{
                  type: 'PARAGRAPH',
                  nodes: [{ type: 'TEXT', textData: { text: articleHtml.replace(/<[^>]+>/g, ' ') } }],
                }],
              },
            },
          }),
        });

        if (res.ok) {
          const data = await res.json();
          setPublishSuccess(`✅ Saved to Wix as draft — ID: ${data.draftPost?.id || 'created'}`);
        } else {
          const err = await res.json().catch(() => ({}));
          setPublishSuccess(`❌ Wix error: ${err.message || 'Check API key and site ID'}`);
        }
      }

    } catch (err: any) {
      setPublishSuccess(`❌ Error: ${err.message}`);
    } finally {
      setPublishing(false);
    }
  }

  function scoreColor(score: number) {
    if (score >= 70) return '#16A34A';
    if (score >= 50) return '#EF9F27';
    return '#DC2626';
  }

  function scoreBg(score: number) {
    if (score >= 70) return '#F0FDF4';
    if (score >= 50) return '#FFFBEB';
    return '#FEF2F2';
  }

  const s: Record<string, any> = {
    page: { padding: '32px', maxWidth: '1100px', margin: '0 auto' },
    title: { fontSize: '22px', fontWeight: 700, color: '#0F0F0F', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' },
    subtitle: { fontSize: '14px', color: '#6B6B6B', marginBottom: '24px' },
    card: { background: '#fff', border: '1px solid #E8E8E4', borderRadius: '12px', padding: '20px', marginBottom: '20px' },
    label: { fontSize: '11px', fontWeight: 600, color: '#9B9B9B', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block' },
    input: { width: '100%', fontSize: '14px', padding: '10px 14px', border: '1px solid #E8E8E4', borderRadius: '8px', background: '#fff', color: '#0F0F0F', boxSizing: 'border-box' as const },
    textarea: { width: '100%', fontSize: '13px', padding: '10px 14px', border: '1px solid #E8E8E4', borderRadius: '8px', background: '#fff', color: '#0F0F0F', fontFamily: 'monospace', minHeight: '120px', resize: 'vertical' as const, boxSizing: 'border-box' as const },
    select: { fontSize: '13px', padding: '9px 12px', border: '1px solid #E8E8E4', borderRadius: '8px', background: '#fff', color: '#0F0F0F' },
    hint: { fontSize: '12px', color: '#9B9B9B', marginTop: '6px' },
    auditBtn: { fontSize: '14px', fontWeight: 700, padding: '11px 24px', background: '#FF6B2C', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', marginTop: '16px', width: '100%' },
    errorBox: { background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '8px', padding: '10px 14px', color: '#DC2626', fontSize: '13px', marginBottom: '14px' },
    progressBar: { background: '#F5F4F1', borderRadius: '8px', height: '8px', overflow: 'hidden', marginBottom: '8px', marginTop: '16px' },
    statsGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '20px' },
    statBox: { background: '#fff', border: '1px solid #E8E8E4', borderRadius: '10px', padding: '14px 16px', textAlign: 'center' as const },
    statNum: { fontSize: '24px', fontWeight: 700, color: '#0F0F0F' },
    statLabel: { fontSize: '11px', color: '#9B9B9B', marginTop: '2px', textTransform: 'uppercase' as const, letterSpacing: '0.5px' },
    table: { background: '#fff', border: '1px solid #E8E8E4', borderRadius: '12px', overflow: 'hidden', width: '100%' },
    th: { padding: '12px 16px', fontSize: '11px', fontWeight: 600, color: '#9B9B9B', textTransform: 'uppercase' as const, letterSpacing: '0.5px', background: '#FAFAF8', textAlign: 'left' as const, borderBottom: '1px solid #E8E8E4' },
    td: { padding: '12px 16px', fontSize: '13px', color: '#0F0F0F', borderBottom: '1px solid #F5F4F1', verticalAlign: 'top' as const },
    discoveryBanner: { background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: '8px', padding: '10px 14px', marginBottom: '16px', fontSize: '13px', color: '#1D4ED8', display: 'flex', alignItems: 'center', gap: '8px' },
    discoveryWarning: { background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '8px', padding: '10px 14px', marginBottom: '16px', fontSize: '13px', color: '#92400E' },
    darkInput: { width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #2a2a4e', background: '#0d0d1a', color: '#fff', fontSize: '12px', boxSizing: 'border-box' as const },
  };

  return (
    <div style={s.page}>
      <div style={s.title}>🔬 Site Audit</div>
      <div style={s.subtitle}>Discover all pages from your sitemap and audit each one for SEO issues and opportunities.</div>

      {/* Input card */}
      <div style={s.card}>
        <div style={{ display: 'flex', gap: '4px', marginBottom: '20px', background: '#F5F4F1', padding: '4px', borderRadius: '8px', width: 'fit-content' }}>
          <button
            onClick={() => setMode('domain')}
            style={{ padding: '7px 16px', fontSize: '13px', fontWeight: 600, background: mode === 'domain' ? '#fff' : 'transparent', color: mode === 'domain' ? '#0F0F0F' : '#9B9B9B', border: 'none', borderRadius: '6px', cursor: 'pointer', boxShadow: mode === 'domain' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none' }}
          >🌐 Domain Audit</button>
          <button
            onClick={() => setMode('manual')}
            style={{ padding: '7px 16px', fontSize: '13px', fontWeight: 600, background: mode === 'manual' ? '#fff' : 'transparent', color: mode === 'manual' ? '#0F0F0F' : '#9B9B9B', border: 'none', borderRadius: '6px', cursor: 'pointer', boxShadow: mode === 'manual' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none' }}
          >📋 Manual URLs</button>
        </div>

        {error && <div style={s.errorBox}>{error}</div>}

        {mode === 'domain' ? (
          <>
            <label style={s.label}>Enter your domain</label>
            <input
              style={s.input}
              placeholder="autodun.com or https://autodun.com"
              value={domain}
              onChange={e => setDomain(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !loading && handleAudit()}
            />
            <div style={s.hint}>We&apos;ll automatically find all pages via your sitemap.xml</div>
          </>
        ) : (
          <>
            <label style={s.label}>Paste URLs (one per line — max 20)</label>
            <textarea
              style={s.textarea}
              placeholder={'https://example.com/page-1\nhttps://example.com/page-2\nhttps://example.com/page-3'}
              value={urls}
              onChange={e => setUrls(e.target.value)}
            />
          </>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '14px' }}>
          <div>
            <label style={{ ...s.label, display: 'inline-block', marginBottom: 0, marginRight: '8px' }}>Market</label>
            <select style={s.select} value={market} onChange={e => setMarket(e.target.value)}>
              <option>United Kingdom</option>
              <option>United States</option>
              <option>Australia</option>
              <option>Canada</option>
              <option>Ireland</option>
            </select>
          </div>
        </div>

        <button style={{ ...s.auditBtn, opacity: loading ? 0.6 : 1 }} onClick={handleAudit} disabled={loading}>
          {loading ? '⏳ Auditing...' : mode === 'domain' ? '🌐 Discover & Audit All Pages' : '🔍 Audit These Pages'}
        </button>

        {loading && (
          <>
            <div style={s.progressBar}>
              <div style={{ height: '100%', borderRadius: '8px', background: '#FF6B2C', width: `${progress}%`, transition: 'width 0.5s ease' }} />
            </div>
            <div style={{ fontSize: '13px', color: '#6B6B6B', textAlign: 'center' }}>{progressLabel}</div>
          </>
        )}
      </div>

      {/* Results */}
      {results && (
        <>
          {discoverySource && (
            <div style={s.discoveryBanner}>
              🗺️ <strong>Discovery:</strong> {discoverySource}
              {discoveredCount > 0 && results.summary.totalPages > results.summary.audited && (
                <span style={{ marginLeft: '4px', color: '#1D4ED8', opacity: 0.7 }}>
                  — audited first {results.summary.audited} of {results.summary.totalPages}
                </span>
              )}
            </div>
          )}
          {discoveryError && <div style={s.discoveryWarning}>⚠️ {discoveryError}</div>}

          <div style={s.statsGrid}>
            <div style={s.statBox}>
              <div style={{ ...s.statNum, color: scoreColor(results.summary.avgScore) }}>{results.summary.avgScore}</div>
              <div style={s.statLabel}>Avg SEO Score</div>
            </div>
            <div style={s.statBox}>
              <div style={s.statNum}>{results.summary.audited}</div>
              <div style={s.statLabel}>Pages Audited</div>
            </div>
            <div style={s.statBox}>
              <div style={{ ...s.statNum, color: results.summary.criticalIssues > 0 ? '#DC2626' : '#16A34A' }}>
                {results.summary.criticalIssues}
              </div>
              <div style={s.statLabel}>Critical Pages</div>
            </div>
            <div style={s.statBox}>
              <div style={{ ...s.statNum, color: results.summary.pagesWithSchema > 0 ? '#16A34A' : '#9B9B9B' }}>
                {results.summary.pagesWithSchema}
              </div>
              <div style={s.statLabel}>Have Schema</div>
            </div>
          </div>

          <div style={s.table}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={s.th}>Page</th>
                  <th style={s.th}>Score</th>
                  <th style={s.th}>Words</th>
                  <th style={s.th}>Schema</th>
                  <th style={s.th}>Issues / Opportunities</th>
                </tr>
              </thead>
              <tbody>
                {results.results.flatMap((page: any) => {
                  const isExpanded = expandedUrl === page.url;
                  const shortUrl = page.url.replace(/^https?:\/\//, '');
                  const rows = [
                    <tr
                      key={page.url}
                      style={{ cursor: 'pointer', background: isExpanded ? '#FAFAF8' : '#fff' }}
                      onClick={() => setExpandedUrl(isExpanded ? null : page.url)}
                    >
                      <td style={s.td}>
                        <div style={{ fontWeight: 600, fontSize: '12px', marginBottom: '2px', wordBreak: 'break-all' }}>
                          {shortUrl.length > 65 ? shortUrl.slice(0, 65) + '...' : shortUrl}
                        </div>
                        {page.title
                          ? <div style={{ fontSize: '11px', color: '#6B6B6B' }}>{page.title.length > 65 ? page.title.slice(0, 65) + '...' : page.title}</div>
                          : <div style={{ fontSize: '11px', color: '#DC2626' }}>No title tag</div>
                        }
                      </td>
                      <td style={s.td}>
                        <span style={{ background: scoreBg(page.score), color: scoreColor(page.score), fontWeight: 700, fontSize: '13px', padding: '4px 10px', borderRadius: '20px', whiteSpace: 'nowrap' }}>
                          {page.score}/100
                        </span>
                      </td>
                      <td style={{ ...s.td, fontWeight: 600, color: page.wordCount < 600 ? '#DC2626' : '#16A34A' }}>
                        {page.wordCount.toLocaleString()}
                      </td>
                      <td style={s.td}>
                        <span style={{ fontSize: '12px', fontWeight: 700, color: page.hasSchema ? '#16A34A' : '#9B9B9B' }}>
                          {page.hasSchema ? '✓ Yes' : '✗ No'}
                        </span>
                      </td>
                      <td style={s.td}>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                          {page.issues.length > 0 && (
                            <span style={{ background: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA', fontSize: '11px', padding: '2px 8px', borderRadius: '20px', fontWeight: 600 }}>
                              {page.issues.length} issue{page.issues.length !== 1 ? 's' : ''}
                            </span>
                          )}
                          {page.opportunities.length > 0 && (
                            <span style={{ background: '#F0FDF4', color: '#16A34A', border: '1px solid #BBF7D0', fontSize: '11px', padding: '2px 8px', borderRadius: '20px', fontWeight: 600 }}>
                              {page.opportunities.length} opp{page.opportunities.length !== 1 ? 's' : ''}
                            </span>
                          )}
                          <button
                            onClick={e => { e.stopPropagation(); handleFixPage(page); }}
                            style={{ fontSize: '11px', fontWeight: 700, padding: '2px 10px', background: '#FF6B2C', color: '#fff', border: 'none', borderRadius: '20px', cursor: 'pointer', whiteSpace: 'nowrap' as const }}
                          >🔧 Fix Page</button>
                          <span style={{ fontSize: '11px', color: '#9B9B9B', marginLeft: '2px' }}>{isExpanded ? '▲' : '▼'}</span>
                        </div>
                      </td>
                    </tr>,
                  ];

                  if (isExpanded) {
                    rows.push(
                      <tr key={`${page.url}-detail`}>
                        <td colSpan={5} style={{ ...s.td, background: '#FAFAF8', borderTop: '1px solid #F5F4F1' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                            <div>
                              <div style={{ fontSize: '11px', fontWeight: 700, color: '#DC2626', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>⚠️ Issues</div>
                              {page.issues.length === 0 ? (
                                <div style={{ fontSize: '12px', color: '#16A34A' }}>✓ No critical issues found</div>
                              ) : (
                                <ul style={{ margin: 0, paddingLeft: '16px', fontSize: '12px', color: '#0F0F0F', lineHeight: 1.8 }}>
                                  {page.issues.map((issue: string, j: number) => <li key={j}>{issue}</li>)}
                                </ul>
                              )}
                            </div>
                            <div>
                              <div style={{ fontSize: '11px', fontWeight: 700, color: '#16A34A', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>✨ Opportunities</div>
                              {page.opportunities.length === 0 ? (
                                <div style={{ fontSize: '12px', color: '#9B9B9B' }}>No quick wins identified</div>
                              ) : (
                                <ul style={{ margin: 0, paddingLeft: '16px', fontSize: '12px', color: '#0F0F0F', lineHeight: 1.8 }}>
                                  {page.opportunities.map((opp: string, j: number) => <li key={j}>{opp}</li>)}
                                </ul>
                              )}
                            </div>
                          </div>
                          {page.metaDescription ? (
                            <div style={{ marginTop: '12px', fontSize: '12px', color: '#6B6B6B', borderTop: '1px solid #E8E8E4', paddingTop: '10px' }}>
                              <strong>Meta description:</strong> {page.metaDescription}
                            </div>
                          ) : (
                            <div style={{ marginTop: '12px', fontSize: '12px', color: '#DC2626', borderTop: '1px solid #E8E8E4', paddingTop: '10px' }}>
                              <strong>Meta description:</strong> Missing
                            </div>
                          )}
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

      {/* Fix Panel Overlay */}
      {showFixPanel && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1001, display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end' }}
          onClick={() => !fixing && setShowFixPanel(false)}
        >
          <div
            style={{ width: '580px', height: '100vh', background: '#fff', overflowY: 'auto', display: 'flex', flexDirection: 'column', zIndex: 1002 }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{ background: '#0F0F0F', padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <div style={{ color: '#fff', fontWeight: 700, fontSize: '15px' }}>🔧 Fix This Page</div>
              <button
                onClick={() => !fixing && setShowFixPanel(false)}
                style={{ color: '#9B9B9B', background: 'none', border: 'none', fontSize: '22px', cursor: fixing ? 'not-allowed' : 'pointer', lineHeight: 1 }}
              >×</button>
            </div>

            <div style={{ padding: '20px', flex: 1 }}>
              {/* Loading */}
              {fixing && (
                <div style={{ textAlign: 'center', padding: '48px 0' }}>
                  <div style={{ fontSize: '36px', marginBottom: '16px' }}>⚙️</div>
                  <div style={{ fontWeight: 700, fontSize: '15px', color: '#0F0F0F', marginBottom: '8px' }}>Fixing page...</div>
                  <div style={{ fontSize: '13px', color: '#6B6B6B' }}>{fixStage}</div>
                  <div style={{ marginTop: '24px', background: '#F5F4F1', borderRadius: '8px', height: '6px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', background: '#FF6B2C', width: '60%', borderRadius: '8px' }} />
                  </div>
                </div>
              )}

              {/* Error */}
              {!fixing && fixStage && !fixResult && (
                <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '8px', padding: '12px 16px', color: '#DC2626', fontSize: '13px' }}>
                  {fixStage}
                </div>
              )}

              {/* Results */}
              {fixResult && (
                <>
                  {/* Keyword + stats */}
                  <div style={{ background: '#F5F4F1', borderRadius: '10px', padding: '14px 16px', marginBottom: '16px' }}>
                    <div style={{ fontSize: '11px', fontWeight: 700, color: '#9B9B9B', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>Target Keyword</div>
                    <div style={{ fontSize: '16px', fontWeight: 700, color: '#FF6B2C' }}>{fixResult.keyword}</div>
                    <div style={{ fontSize: '12px', color: '#6B6B6B', marginTop: '4px' }}>
                      {fixResult.competitorsAnalysed} competitor{fixResult.competitorsAnalysed !== 1 ? 's' : ''} analysed
                      {fixResult.avgCompetitorWords > 0 && ` · avg ${fixResult.avgCompetitorWords.toLocaleString()} words`}
                    </div>
                  </div>

                  {/* Brief */}
                  {fixResult.brief?.briefSummary && (
                    <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: '8px', padding: '12px 16px', marginBottom: '16px', fontSize: '13px', color: '#1D4ED8' }}>
                      💡 {fixResult.brief.briefSummary}
                    </div>
                  )}

                  {/* Low KD keywords */}
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

                  {/* Corrections */}
                  {fixResult.corrections?.length > 0 && (
                    <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: '8px', padding: '10px 14px', marginBottom: '16px', fontSize: '12px', color: '#16A34A' }}>
                      ✓ {fixResult.corrections.length} correction{fixResult.corrections.length !== 1 ? 's' : ''} applied automatically
                    </div>
                  )}

                  {/* Publish section */}
                  {fixResult.improvedArticle && (
                    <div style={{ background: '#0F0F0F', borderRadius: '12px', padding: '20px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                        <div>
                          <div style={{ fontSize: '14px', fontWeight: 700, color: '#fff', marginBottom: '2px' }}>📄 Improved Article Ready</div>
                          <div style={{ fontSize: '12px', color: '#8899aa' }}>
                            {fixResult.improvedArticle.split(/\s+/).length} words · Google 2026 compliant
                          </div>
                        </div>
                      </div>

                      {/* Platform grid */}
                      <div style={{ fontSize: '11px', fontWeight: 600, color: '#8899aa', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '10px' }}>
                        Choose where to publish
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px', marginBottom: '14px' }}>
                        {platforms.map(platform => (
                          <button
                            key={platform.id}
                            onClick={() => {
                              if (platform.id === 'copy') {
                                navigator.clipboard.writeText(fixResult.improvedArticle);
                                setPublishSuccess('✅ Copied to clipboard!');
                                setTimeout(() => setPublishSuccess(''), 3000);
                                return;
                              }
                              setPublishMode(publishMode === platform.id ? null : platform.id);
                              setPublishSuccess('');
                            }}
                            style={{
                              padding: '8px 4px',
                              background: publishMode === platform.id ? platform.color : '#1a1a2e',
                              border: `1px solid ${publishMode === platform.id ? platform.color : '#2a2a4e'}`,
                              borderRadius: '8px', color: '#fff', cursor: 'pointer',
                              fontSize: '11px', fontWeight: 600, textAlign: 'center' as const,
                            }}
                          >
                            <div style={{ fontSize: '18px', marginBottom: '2px' }}>{platform.icon}</div>
                            <div>{platform.label}</div>
                            <div style={{ fontSize: '9px', color: publishMode === platform.id ? 'rgba(255,255,255,0.7)' : '#8899aa', marginTop: '1px' }}>
                              {platform.desc}
                            </div>
                          </button>
                        ))}
                      </div>

                      {/* Success / error */}
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

                      {/* Dynamic platform form */}
                      {publishMode && (() => {
                        const platform = platforms.find(p => p.id === publishMode);
                        if (!platform || platform.noForm || !platform.fields) return null;
                        return (
                          <div style={{ background: '#1a1a2e', borderRadius: '8px', padding: '16px', marginBottom: '12px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                              <span style={{ fontSize: '18px' }}>{platform.icon}</span>
                              <span style={{ fontSize: '13px', fontWeight: 700, color: '#fff' }}>Publish to {platform.label}</span>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                              {platform.fields.map(field => (
                                <div key={field.key}>
                                  <div style={{ fontSize: '11px', color: '#8899aa', marginBottom: '4px', fontWeight: 600 }}>{field.label}</div>
                                  <input
                                    type={field.type || 'text'}
                                    placeholder={field.placeholder}
                                    value={publishFields[`${publishMode}_${field.key}`] || ''}
                                    onChange={e => updateField(`${publishMode}_${field.key}`, e.target.value)}
                                    style={s.darkInput}
                                  />
                                  {field.hint && (
                                    <div style={{ fontSize: '10px', color: '#6b7280', marginTop: '3px' }}>💡 {field.hint}</div>
                                  )}
                                </div>
                              ))}
                              <button
                                onClick={() => handlePublish(publishMode, fixResult.improvedArticle, fixResult)}
                                disabled={publishing}
                                style={{
                                  padding: '10px', background: '#FF6B2C', color: '#fff', border: 'none',
                                  borderRadius: '8px', cursor: publishing ? 'not-allowed' : 'pointer',
                                  fontSize: '13px', fontWeight: 700, opacity: publishing ? 0.6 : 1, marginTop: '4px',
                                }}
                              >
                                {publishing ? '⏳ Publishing...' : `🚀 Publish to ${platform.label}`}
                              </button>
                            </div>
                          </div>
                        );
                      })()}

                      {/* Article preview */}
                      <div style={{ background: '#1a1a2e', borderRadius: '8px', padding: '12px', maxHeight: '150px', overflowY: 'auto', fontSize: '11px', color: '#8899aa', fontFamily: 'monospace', lineHeight: 1.5 }}>
                        {fixResult.improvedArticle.slice(0, 400)}...
                      </div>
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
