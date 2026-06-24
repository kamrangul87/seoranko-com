/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';
import { useState, useEffect } from 'react';

const SNIPPET_BASE = 'https://seoranko.com/seoranko.js';

const PLATFORMS = [
  {
    id: 'wordpress',
    name: 'WordPress',
    icon: '🔵',
    steps: [
      'Go to Appearance → Theme File Editor (or use a plugin like "Insert Headers and Footers")',
      'Open header.php and paste the snippet just before </head>',
      'Or install the "Insert Headers and Footers" plugin and paste in the Header section',
      'Save and visit your site — fixes apply instantly',
    ],
  },
  {
    id: 'shopify',
    name: 'Shopify',
    icon: '🟢',
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
    steps: [
      'Go to Settings → Advanced → Code Injection',
      'Paste the snippet in the Header section',
      'Save — fixes apply across the whole site',
    ],
  },
  {
    id: 'custom',
    name: 'Custom HTML',
    icon: '🔶',
    steps: [
      'Open your HTML template or layout file',
      'Paste the snippet anywhere inside <head>',
      'Deploy — fixes are applied before the page renders',
    ],
  },
];

export default function InstallPage() {
  const [domain, setDomain] = useState('');
  const [siteId, setSiteId] = useState('');
  const [copied, setCopied] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<'found' | 'not_found' | null>(null);
  const [activePlatform, setActivePlatform] = useState('wordpress');

  useEffect(() => {
    const saved = localStorage.getItem('seoranko_last_domain') || '';
    if (saved) {
      setDomain(saved);
      setSiteId(normalizeDomain(saved));
    }
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
    setSiteId(normalizeDomain(val));
    setVerifyResult(null);
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
      // Try to fetch the site's homepage and look for the seoranko.js script tag
      const res = await fetch(`/api/verify-install?domain=${encodeURIComponent(siteId)}`, {
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json();
      setVerifyResult(data.found ? 'found' : 'not_found');
    } catch {
      setVerifyResult('not_found');
    } finally {
      setVerifying(false);
    }
  }

  const platform = PLATFORMS.find(p => p.id === activePlatform) || PLATFORMS[0];

  return (
    <div style={{ maxWidth: '780px', margin: '0 auto', padding: '40px 20px', fontFamily: 'system-ui, sans-serif' }}>

      {/* Header */}
      <div style={{ marginBottom: '32px' }}>
        <div style={{ fontSize: '24px', fontWeight: 800, color: '#0F0F0F', marginBottom: '6px' }}>
          Install SEORANKO Script
        </div>
        <div style={{ fontSize: '14px', color: '#6B6B6B' }}>
          Paste one script tag to apply SEO fixes to any website in real-time — no CMS access, no deployment required.
        </div>
      </div>

      {/* Step 1 — Domain */}
      <div style={{ background: '#fff', border: '1px solid #E8E8E4', borderRadius: '12px', padding: '24px', marginBottom: '20px' }}>
        <div style={{ fontSize: '13px', fontWeight: 700, color: '#0F0F0F', marginBottom: '12px' }}>
          Step 1 — Enter your domain
        </div>
        <input
          type="text"
          placeholder="yourdomain.com"
          value={domain}
          onChange={e => handleDomainChange(e.target.value)}
          style={{ width: '100%', padding: '10px 14px', fontSize: '14px', border: '1px solid #E8E8E4', borderRadius: '8px', outline: 'none', boxSizing: 'border-box' as const }}
        />
        {siteId && (
          <div style={{ marginTop: '8px', fontSize: '12px', color: '#6B6B6B' }}>
            Your site ID: <code style={{ background: '#F5F4F1', padding: '2px 6px', borderRadius: '4px', fontWeight: 600 }}>{siteId}</code>
          </div>
        )}
      </div>

      {/* Step 2 — Snippet */}
      <div style={{ background: '#fff', border: '1px solid #E8E8E4', borderRadius: '12px', padding: '24px', marginBottom: '20px' }}>
        <div style={{ fontSize: '13px', fontWeight: 700, color: '#0F0F0F', marginBottom: '12px' }}>
          Step 2 — Copy this snippet
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
          Paste this inside the <code style={{ background: '#F5F4F1', padding: '1px 4px', borderRadius: '3px' }}>&lt;head&gt;</code> of every page. Works on any platform.
        </div>
      </div>

      {/* Step 3 — Platform instructions */}
      <div style={{ background: '#fff', border: '1px solid #E8E8E4', borderRadius: '12px', padding: '24px', marginBottom: '20px' }}>
        <div style={{ fontSize: '13px', fontWeight: 700, color: '#0F0F0F', marginBottom: '14px' }}>
          Step 3 — Platform instructions
        </div>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap' as const }}>
          {PLATFORMS.map(p => (
            <button
              key={p.id}
              onClick={() => setActivePlatform(p.id)}
              style={{
                padding: '6px 14px', fontSize: '12px', fontWeight: 600, borderRadius: '20px', cursor: 'pointer',
                background: activePlatform === p.id ? '#0F0F0F' : '#F5F4F1',
                color: activePlatform === p.id ? '#fff' : '#6B6B6B',
                border: activePlatform === p.id ? '1px solid #0F0F0F' : '1px solid #E8E8E4',
              }}
            >
              {p.icon} {p.name}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' as const, gap: '10px' }}>
          {platform.steps.map((step, i) => (
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

      {/* Step 4 — Verify */}
      <div style={{ background: '#fff', border: '1px solid #E8E8E4', borderRadius: '12px', padding: '24px', marginBottom: '20px' }}>
        <div style={{ fontSize: '13px', fontWeight: 700, color: '#0F0F0F', marginBottom: '8px' }}>
          Step 4 — Verify installation
        </div>
        <div style={{ fontSize: '12px', color: '#6B6B6B', marginBottom: '14px' }}>
          After pasting the snippet, click below to check if SEORANKO detects the script on your homepage.
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
            ✅ Script detected on {siteId} — SEO fixes are live!
          </div>
        )}
        {verifyResult === 'not_found' && (
          <div style={{ marginTop: '12px', padding: '10px 14px', background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: '8px', fontSize: '13px', color: '#C2410C' }}>
            ⚠️ Script not detected yet. Make sure you pasted the snippet inside &lt;head&gt; and saved/deployed your changes.
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
            'The script loads asynchronously — it never slows down your page',
            'On each page load it fetches your fixes from SEORANKO\'s CDN (cached, fast)',
            'Fixes are applied in milliseconds before the user sees any content',
            'Update or disable fixes any time from the Site Audit dashboard — no code changes needed',
            'Works on WordPress, Shopify, Wix, Squarespace, or any custom HTML site',
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
