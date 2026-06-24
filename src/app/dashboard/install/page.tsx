/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';
import { useState, useEffect, useRef } from 'react';

const SNIPPET_BASE = 'https://seoranko.com/seoranko.js';

const ALL_PLATFORMS = [
  {
    id: 'wordpress',
    name: 'WordPress',
    icon: '🔵',
    installMethod: 'plugin',
    steps: [
      'Go to Appearance → Theme File Editor (or use "Insert Headers and Footers" plugin)',
      'Open header.php and paste the snippet just before </head>',
      'Or install "Insert Headers and Footers" and paste in the Header section',
      'Save — fixes apply to your live site within 60 seconds',
    ],
  },
  {
    id: 'shopify',
    name: 'Shopify',
    icon: '🟢',
    installMethod: 'app',
    steps: [
      'Go to Online Store → Themes → Edit Code',
      'Open layout/theme.liquid',
      'Paste the snippet just before </head>',
      'Click Save — fixes apply to all pages immediately',
    ],
  },
  {
    id: 'wix',
    name: 'Wix',
    icon: '⚫',
    installMethod: 'snippet',
    steps: [
      'Go to Settings → Custom Code',
      'Click + Add Custom Code',
      'Paste the snippet, set location to "Head", pages to "All Pages"',
      'Click Apply',
    ],
  },
  {
    id: 'squarespace',
    name: 'Squarespace',
    icon: '⬛',
    installMethod: 'snippet',
    steps: [
      'Go to Settings → Advanced → Code Injection',
      'Paste the snippet in the Header section',
      'Save — fixes apply across the whole site',
    ],
  },
  {
    id: 'webflow',
    name: 'Webflow',
    icon: '🔷',
    installMethod: 'snippet',
    steps: [
      'Go to Project Settings → Custom Code',
      'Paste the snippet in the Head Code section',
      'Save and Publish your site',
    ],
  },
  {
    id: 'nextjs',
    name: 'Next.js',
    icon: '⚫',
    installMethod: 'github_pr',
    steps: [
      'Enter your GitHub repo below',
      'Click "Open Install PR" — SEORANKO will add the script to your layout file',
      'Review and merge the pull request',
      'Deploy — fixes apply automatically on every page load',
    ],
  },
  {
    id: 'ghost',
    name: 'Ghost',
    icon: '👻',
    installMethod: 'snippet',
    steps: [
      'Go to Settings → Code Injection',
      'Paste the snippet in the Site Header section',
      'Save — fixes apply across all posts and pages',
    ],
  },
  {
    id: 'html',
    name: 'HTML / Custom',
    icon: '🔶',
    installMethod: 'snippet',
    steps: [
      'Open your HTML template or layout file',
      'Paste the snippet anywhere inside <head>',
      'Deploy — fixes are applied before the page renders',
    ],
  },
];

interface Detected {
  platform: string;
  confidence: string;
  installMethod: string;
  name: string;
}

export default function InstallPage() {
  const [domain, setDomain] = useState('');
  const [siteId, setSiteId] = useState('');
  const [copied, setCopied] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<'found' | 'not_found' | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [detected, setDetected] = useState<Detected | null>(null);
  const [showAllPlatforms, setShowAllPlatforms] = useState(false);
  const [activePlatformId, setActivePlatformId] = useState('html');
  // GitHub PR state
  const [ghRepo, setGhRepo] = useState('');
  const [ghToken, setGhToken] = useState('');
  const [prLoading, setPrLoading] = useState(false);
  const [prUrl, setPrUrl] = useState('');
  const [prError, setPrError] = useState('');

  const detectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem('seoranko_audit_domain') || '';
    if (saved) {
      setDomain(saved);
      setSiteId(normalizeDomain(saved));
    }
    const savedRepo = localStorage.getItem('seoranko_gh_repo') || '';
    const savedToken = localStorage.getItem('seoranko_gh_token') || '';
    if (savedRepo) setGhRepo(savedRepo);
    if (savedToken) setGhToken(savedToken);
  }, []);

  function normalizeDomain(d: string) {
    try {
      const full = d.startsWith('http') ? d : `https://${d}`;
      return new URL(full).hostname.replace(/^www\./, '').toLowerCase();
    } catch {
      return d.replace(/^www\./, '').toLowerCase().replace(/\/$/, '');
    }
  }

  function handleDomainChange(val: string) {
    setDomain(val);
    const id = normalizeDomain(val);
    setSiteId(id);
    setVerifyResult(null);
    setDetected(null);
    if (detectTimer.current) clearTimeout(detectTimer.current);
    if (!val.trim()) return;
    detectTimer.current = setTimeout(() => runDetect(val.trim()), 800);
  }

  async function runDetect(raw: string) {
    setDetecting(true);
    try {
      const res = await fetch(`/api/detect-platform?domain=${encodeURIComponent(raw)}`);
      const data: Detected = await res.json();
      setDetected(data);
      setActivePlatformId(data.platform);
    } catch {
      setDetected(null);
    } finally {
      setDetecting(false);
    }
  }

  const snippet = `<script src="${SNIPPET_BASE}" data-site-id="${siteId || 'your-domain.com'}" async></script>`;

  function handleCopy() {
    navigator.clipboard.writeText(snippet).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  async function handleVerify() {
    if (!siteId) return;
    setVerifying(true);
    setVerifyResult(null);
    try {
      const res = await fetch(`/api/verify-install?domain=${encodeURIComponent(siteId)}`);
      const data = await res.json();
      setVerifyResult(data.found ? 'found' : 'not_found');
    } catch {
      setVerifyResult('not_found');
    } finally {
      setVerifying(false);
    }
  }

  async function handleOpenPR() {
    if (!ghRepo || !ghToken || !siteId) return;
    setPrLoading(true);
    setPrError('');
    setPrUrl('');
    localStorage.setItem('seoranko_gh_repo', ghRepo);
    localStorage.setItem('seoranko_gh_token', ghToken);
    try {
      const res = await fetch('/api/install/github-pr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: ghRepo, token: ghToken, site_id: siteId }),
      });
      const data = await res.json();
      if (data.error) { setPrError(data.error); }
      else { setPrUrl(data.pr_url); }
    } catch (e: any) {
      setPrError(e.message || 'Failed to open PR');
    } finally {
      setPrLoading(false);
    }
  }

  const activePlatform = ALL_PLATFORMS.find(p => p.id === activePlatformId) || ALL_PLATFORMS[ALL_PLATFORMS.length - 1];
  const isNextjs = activePlatformId === 'nextjs';
  const showSnippet = !isNextjs || showAllPlatforms;

  return (
    <div style={{ maxWidth: '780px', margin: '0 auto', padding: '40px 20px', fontFamily: 'system-ui, sans-serif' }}>

      {/* Header */}
      <div style={{ marginBottom: '32px' }}>
        <div style={{ fontSize: '24px', fontWeight: 800, color: '#0F0F0F', marginBottom: '6px' }}>
          Install SEORANKO
        </div>
        <div style={{ fontSize: '14px', color: '#6B6B6B' }}>
          One script tag applies SEO fixes to any site in real-time — no deployment required.
        </div>
      </div>

      {/* Step 1 — Domain + auto-detect */}
      <div style={{ background: '#fff', border: '1px solid #E8E8E4', borderRadius: '12px', padding: '24px', marginBottom: '20px' }}>
        <div style={{ fontSize: '13px', fontWeight: 700, color: '#0F0F0F', marginBottom: '12px' }}>
          Step 1 — Enter your domain
        </div>
        <div style={{ position: 'relative' as const }}>
          <input
            type="text"
            placeholder="yourdomain.com"
            value={domain}
            onChange={e => handleDomainChange(e.target.value)}
            style={{ width: '100%', padding: '10px 14px', fontSize: '14px', border: '1px solid #E8E8E4', borderRadius: '8px', outline: 'none', boxSizing: 'border-box' as const }}
          />
          {detecting && (
            <div style={{ position: 'absolute' as const, right: '12px', top: '50%', transform: 'translateY(-50%)', fontSize: '11px', color: '#9B9B9B' }}>
              Detecting...
            </div>
          )}
        </div>

        {/* Detection result */}
        {detected && !detecting && (
          <div style={{ marginTop: '12px', padding: '12px 16px', background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: '13px', fontWeight: 700, color: '#16A34A' }}>
                {detected.confidence === 'high' ? '✅' : '🔍'} We detected {detected.name}
                {detected.confidence === 'low' ? ' (or plain HTML)' : ''}
              </div>
              <div style={{ fontSize: '12px', color: '#166534', marginTop: '2px' }}>
                {detected.installMethod === 'github_pr'
                  ? 'Best method: automatic GitHub PR — no manual pasting needed'
                  : detected.installMethod === 'plugin'
                  ? 'Best method: WordPress plugin (coming soon) · or paste the snippet manually'
                  : 'Best method: paste the snippet in your platform\'s header code section'}
              </div>
            </div>
            <button
              onClick={() => { setShowAllPlatforms(true); }}
              style={{ fontSize: '11px', color: '#16A34A', background: 'none', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' as const, textDecoration: 'underline' }}
            >
              Other platform?
            </button>
          </div>
        )}

        {siteId && (
          <div style={{ marginTop: '8px', fontSize: '12px', color: '#6B6B6B' }}>
            Your site ID: <code style={{ background: '#F5F4F1', padding: '2px 6px', borderRadius: '4px', fontWeight: 600 }}>{siteId}</code>
          </div>
        )}
      </div>

      {/* Step 2 — Next.js GitHub PR (shown when Next.js detected or selected) */}
      {isNextjs && (
        <div style={{ background: '#fff', border: '2px solid #0F0F0F', borderRadius: '12px', padding: '24px', marginBottom: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
            <div style={{ fontSize: '13px', fontWeight: 700, color: '#0F0F0F' }}>
              ⚫ Step 2 — Open GitHub PR (recommended for Next.js)
            </div>
            <div style={{ fontSize: '10px', background: '#0F0F0F', color: '#fff', padding: '2px 8px', borderRadius: '10px', fontWeight: 700 }}>
              1-CLICK
            </div>
          </div>
          <div style={{ fontSize: '12px', color: '#6B6B6B', marginBottom: '16px' }}>
            SEORANKO reads your layout file, adds the script tag, and opens a PR — you just review and merge.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' as const, gap: '10px', marginBottom: '16px' }}>
            <input
              type="text"
              placeholder="owner/repository (e.g. acme/my-site)"
              value={ghRepo}
              onChange={e => setGhRepo(e.target.value)}
              style={{ padding: '9px 14px', fontSize: '13px', border: '1px solid #E8E8E4', borderRadius: '8px', outline: 'none' }}
            />
            <input
              type="password"
              placeholder="GitHub Personal Access Token (repo scope)"
              value={ghToken}
              onChange={e => setGhToken(e.target.value)}
              style={{ padding: '9px 14px', fontSize: '13px', border: '1px solid #E8E8E4', borderRadius: '8px', outline: 'none' }}
            />
            <div style={{ fontSize: '11px', color: '#9B9B9B' }}>
              Generate at github.com/settings/tokens → New classic token → tick <strong>repo</strong>
            </div>
          </div>
          <button
            onClick={handleOpenPR}
            disabled={prLoading || !ghRepo || !ghToken || !siteId}
            style={{
              padding: '10px 22px', fontSize: '13px', fontWeight: 700,
              background: prLoading || !ghRepo || !ghToken || !siteId ? '#E8E8E4' : '#0F0F0F',
              color: prLoading || !ghRepo || !ghToken || !siteId ? '#9B9B9B' : '#fff',
              border: 'none', borderRadius: '8px', cursor: prLoading || !ghRepo || !ghToken || !siteId ? 'default' : 'pointer',
            }}
          >
            {prLoading ? 'Opening PR...' : '🔀 Open Install PR'}
          </button>
          {prUrl && (
            <div style={{ marginTop: '14px', padding: '12px 16px', background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: '8px' }}>
              <div style={{ fontSize: '13px', fontWeight: 700, color: '#16A34A', marginBottom: '6px' }}>✅ PR opened!</div>
              <a href={prUrl} target="_blank" rel="noreferrer" style={{ fontSize: '13px', color: '#1D4ED8', fontWeight: 600 }}>
                {prUrl} →
              </a>
              <div style={{ fontSize: '12px', color: '#166534', marginTop: '6px' }}>
                Review and merge → deploy → fixes go live within 60 seconds
              </div>
            </div>
          )}
          {prError && (
            <div style={{ marginTop: '12px', padding: '10px 14px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '8px', fontSize: '12px', color: '#DC2626' }}>
              {prError}
            </div>
          )}
          <div style={{ marginTop: '14px' }}>
            <button
              onClick={() => setShowAllPlatforms(v => !v)}
              style={{ fontSize: '11px', color: '#9B9B9B', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
            >
              {showAllPlatforms ? 'Hide manual install' : 'Or paste manually instead →'}
            </button>
          </div>
        </div>
      )}

      {/* Step 2/3 — Snippet (shown always for non-Next.js, or when 'paste manually' is chosen) */}
      {showSnippet && (
        <>
          <div style={{ background: '#fff', border: '1px solid #E8E8E4', borderRadius: '12px', padding: '24px', marginBottom: '20px' }}>
            <div style={{ fontSize: '13px', fontWeight: 700, color: '#0F0F0F', marginBottom: '12px' }}>
              {isNextjs ? 'Or — ' : 'Step 2 — '}Copy this snippet
            </div>
            <div style={{ position: 'relative' as const }}>
              <div style={{ background: '#0F0F0F', borderRadius: '8px', padding: '16px 20px', fontFamily: 'monospace', fontSize: '13px', color: '#86efac', lineHeight: 1.6, wordBreak: 'break-all' as const }}>
                {snippet}
              </div>
              <button
                onClick={handleCopy}
                style={{
                  position: 'absolute' as const, top: '10px', right: '10px',
                  padding: '5px 12px', fontSize: '11px', fontWeight: 600,
                  background: copied ? '#16A34A' : '#FF6B2C', color: '#fff',
                  border: 'none', borderRadius: '6px', cursor: 'pointer',
                }}
              >
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </div>
            <div style={{ marginTop: '10px', fontSize: '12px', color: '#9B9B9B' }}>
              Paste inside <code style={{ background: '#F5F4F1', padding: '1px 4px', borderRadius: '3px' }}>&lt;head&gt;</code> on every page.
            </div>
          </div>

          {/* Platform instructions */}
          <div style={{ background: '#fff', border: '1px solid #E8E8E4', borderRadius: '12px', padding: '24px', marginBottom: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
              <div style={{ fontSize: '13px', fontWeight: 700, color: '#0F0F0F' }}>
                {isNextjs ? 'Manual install instructions' : 'Step 3 — Platform instructions'}
              </div>
              {!showAllPlatforms && detected && (
                <button
                  onClick={() => setShowAllPlatforms(true)}
                  style={{ fontSize: '11px', color: '#9B9B9B', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
                >
                  Other platform?
                </button>
              )}
            </div>
            {showAllPlatforms && (
              <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' as const }}>
                {ALL_PLATFORMS.map(p => (
                  <button
                    key={p.id}
                    onClick={() => { setActivePlatformId(p.id); }}
                    style={{
                      padding: '5px 12px', fontSize: '11px', fontWeight: 600, borderRadius: '20px', cursor: 'pointer',
                      background: activePlatformId === p.id ? '#0F0F0F' : '#F5F4F1',
                      color: activePlatformId === p.id ? '#fff' : '#6B6B6B',
                      border: activePlatformId === p.id ? '1px solid #0F0F0F' : '1px solid #E8E8E4',
                    }}
                  >
                    {p.icon} {p.name}
                  </button>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column' as const, gap: '10px' }}>
              {activePlatform.steps.map((step, i) => (
                <div key={i} style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                  <div style={{
                    width: '22px', height: '22px', borderRadius: '50%', background: '#FF6B2C', color: '#fff',
                    fontSize: '11px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  }}>
                    {i + 1}
                  </div>
                  <div style={{ fontSize: '13px', color: '#0F0F0F', paddingTop: '2px', lineHeight: 1.5 }}>{step}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Verify */}
      <div style={{ background: '#fff', border: '1px solid #E8E8E4', borderRadius: '12px', padding: '24px', marginBottom: '20px' }}>
        <div style={{ fontSize: '13px', fontWeight: 700, color: '#0F0F0F', marginBottom: '8px' }}>
          Final step — Verify installation
        </div>
        <div style={{ fontSize: '12px', color: '#6B6B6B', marginBottom: '14px' }}>
          After installing, click below — SEORANKO will check your homepage for the script.
        </div>
        <button
          onClick={handleVerify}
          disabled={!siteId || verifying}
          style={{
            padding: '10px 20px', fontSize: '13px', fontWeight: 600,
            background: siteId && !verifying ? '#0F0F0F' : '#E8E8E4',
            color: siteId && !verifying ? '#fff' : '#9B9B9B',
            border: 'none', borderRadius: '8px', cursor: siteId && !verifying ? 'pointer' : 'default',
          }}
        >
          {verifying ? 'Checking...' : 'Verify Installation'}
        </button>
        {verifyResult === 'found' && (
          <div style={{ marginTop: '12px', padding: '10px 14px', background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: '8px', fontSize: '13px', color: '#16A34A', fontWeight: 600 }}>
            ✅ Script detected — SEO fixes are live on {siteId}!
          </div>
        )}
        {verifyResult === 'not_found' && (
          <div style={{ marginTop: '12px', padding: '10px 14px', background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: '8px', fontSize: '13px', color: '#C2410C' }}>
            ⚠️ Script not detected yet. Make sure you saved/deployed your changes, then try again.
          </div>
        )}
      </div>

      {/* How it works */}
      <div style={{ background: '#F5F4F1', borderRadius: '12px', padding: '20px 24px' }}>
        <div style={{ fontSize: '12px', fontWeight: 700, color: '#0F0F0F', marginBottom: '10px', textTransform: 'uppercase' as const, letterSpacing: '0.5px' }}>
          How it works
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' as const, gap: '8px' }}>
          {[
            'The script loads async — zero impact on your page speed',
            'On each page load it fetches your active fixes from SEORANKO (cached 60s)',
            'Fixes apply in milliseconds: title, description, H1, schema, OG tags, canonical',
            'Update or disable fixes any time from the audit dashboard — no redeploy needed',
            'Works on WordPress, Shopify, Wix, Squarespace, Webflow, Next.js, Ghost, or plain HTML',
          ].map((line, i) => (
            <div key={i} style={{ display: 'flex', gap: '8px', fontSize: '12px', color: '#6B6B6B' }}>
              <span style={{ color: '#16A34A', flexShrink: 0 }}>✓</span>{line}
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
