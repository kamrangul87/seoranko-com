/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';
import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } }
  );
}

const STEPS = [
  {
    num: '1',
    title: 'Download & install the extension',
    desc: 'Load the extension in Chrome developer mode — takes 30 seconds.',
    color: '#00d48a',
  },
  {
    num: '2',
    title: 'Enter your Site ID',
    desc: 'Click the SEORANKO icon in your Chrome toolbar and enter your domain.',
    color: '#6366F1',
  },
  {
    num: '3',
    title: 'Browse your site — fixes apply automatically',
    desc: 'Every fix you\'ve queued in the audit panel is applied live within 60 seconds.',
    color: '#F59E0B',
  },
];

const FIX_TYPE_LABELS: Record<string, string> = {
  meta_title: 'Title tag',
  meta_description: 'Meta description',
  canonical: 'Canonical URL',
  h1: 'H1 heading',
  og_title: 'OG title',
  og_description: 'OG description',
  og_image: 'OG image',
  twitter_card: 'Twitter Card',
  schema: 'Schema JSON-LD',
  viewport: 'Viewport meta',
  lang: 'Language attribute',
  alt_text: 'Image alt text',
};

export default function ExtensionPage() {
  const [domain, setDomain] = useState('');
  const [fixes, setFixes] = useState<any[]>([]);
  const [loadingFixes, setLoadingFixes] = useState(false);
  const [copiedSiteId, setCopiedSiteId] = useState(false);

  // Restore domain from localStorage (same key as site-audit page)
  useEffect(() => {
    const saved = localStorage.getItem('seoranko_audit_domain') || '';
    const clean = saved.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase();
    setDomain(clean);
  }, []);

  // Load fix count from Supabase when domain changes
  useEffect(() => {
    if (!domain) return;
    setLoadingFixes(true);
    supabase()
      .from('seo_fixes')
      .select('id, page_url, fix_type, new_value, enabled, updated_at')
      .eq('site_id', domain)
      .eq('enabled', true)
      .order('updated_at', { ascending: false })
      .then(({ data }) => {
        setFixes(data ?? []);
        setLoadingFixes(false);
      }, () => setLoadingFixes(false));
  }, [domain]);

  function copySiteId() {
    navigator.clipboard.writeText(domain).then(() => {
      setCopiedSiteId(true);
      setTimeout(() => setCopiedSiteId(false), 2000);
    }).catch(() => {});
  }

  const fixCount = fixes.length;

  return (
    <div style={{ padding: '32px', maxWidth: '800px', margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>

      {/* Header */}
      <div style={{ marginBottom: '32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
          <div style={{ width: '40px', height: '40px', background: '#00d48a', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', fontWeight: 900, color: '#fff', letterSpacing: '-0.5px' }}>
            SR
          </div>
          <div style={{ fontSize: '22px', fontWeight: 700, color: '#0f0f0f' }}>
            SEORANKO Chrome Extension
          </div>
        </div>
        <div style={{ fontSize: '14px', color: '#6b6b6b', maxWidth: '560px' }}>
          Apply every fix from your audit to your live site automatically — no code changes needed. One click to install, zero configuration.
        </div>
      </div>

      {/* Big CTA */}
      <div style={{ background: 'linear-gradient(135deg, #00d48a15, #6366f115)', border: '1.5px solid #00d48a40', borderRadius: '14px', padding: '28px', marginBottom: '28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '20px', flexWrap: 'wrap' as const }}>
        <div>
          <div style={{ fontSize: '18px', fontWeight: 700, color: '#0f0f0f', marginBottom: '6px' }}>
            Install SEORANKO Chrome Extension
          </div>
          <div style={{ fontSize: '13px', color: '#6b6b6b' }}>
            Fixes apply instantly as you browse. Free, open source, no account needed.
          </div>
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' as const }}>
          <a
            href="https://github.com/kamrangul87/seoranko-com/tree/main/chrome-extension"
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '11px 20px', background: '#00d48a', color: '#fff', borderRadius: '8px', fontWeight: 700, fontSize: '13px', textDecoration: 'none', whiteSpace: 'nowrap' as const }}
          >
            ⬇️ Download Extension
          </a>
          <a
            href="https://chrome.google.com/webstore"
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '11px 20px', background: '#f5f4f1', color: '#374151', borderRadius: '8px', fontWeight: 600, fontSize: '13px', textDecoration: 'none', whiteSpace: 'nowrap' as const, border: '1px solid #e8e8e4' }}
          >
            🌐 Chrome Web Store
          </a>
        </div>
      </div>

      {/* Steps */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '28px' }}>
        {STEPS.map((step, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '14px', background: '#fff', border: '1px solid #e8e8e4', borderRadius: '12px', padding: '16px 18px' }}>
            <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: step.color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', fontWeight: 800, flexShrink: 0 }}>
              {step.num}
            </div>
            <div>
              <div style={{ fontSize: '14px', fontWeight: 700, color: '#0f0f0f', marginBottom: '4px' }}>{step.title}</div>
              <div style={{ fontSize: '13px', color: '#6b6b6b', lineHeight: '1.5' }}>{step.desc}</div>
              {i === 1 && domain && (
                <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' as const }}>
                  <div style={{ fontSize: '12px', color: '#374151' }}>Your Site ID:</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '6px', padding: '5px 10px' }}>
                    <code style={{ fontSize: '13px', fontWeight: 700, color: '#00d48a', letterSpacing: '0.2px' }}>{domain}</code>
                    <button
                      onClick={copySiteId}
                      style={{ fontSize: '10px', background: copiedSiteId ? '#00d48a' : '#e8e8e4', color: copiedSiteId ? '#fff' : '#374151', border: 'none', borderRadius: '4px', padding: '2px 7px', cursor: 'pointer', fontWeight: 600, fontFamily: 'inherit' }}
                    >
                      {copiedSiteId ? '✅ Copied!' : 'Copy'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Fix count & list for this domain */}
      <div style={{ background: '#fff', border: '1px solid #e8e8e4', borderRadius: '12px', padding: '20px', marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
          <div style={{ fontSize: '14px', fontWeight: 700, color: '#0f0f0f' }}>
            {domain ? `Active fixes for ${domain}` : 'Your active fixes'}
          </div>
          {loadingFixes && <div style={{ fontSize: '12px', color: '#9b9b9b' }}>Loading…</div>}
          {!loadingFixes && fixCount > 0 && (
            <div style={{ fontSize: '12px', fontWeight: 700, color: '#00d48a', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '20px', padding: '3px 10px' }}>
              {fixCount} fix{fixCount !== 1 ? 'es' : ''} queued
            </div>
          )}
        </div>

        {!domain && (
          <div style={{ fontSize: '13px', color: '#9b9b9b', textAlign: 'center', padding: '20px 0' }}>
            <div style={{ marginBottom: '6px' }}>🔍</div>
            Run a site audit first to see your fixes here.
            <div style={{ marginTop: '10px' }}>
              <a href="/dashboard/site-audit" style={{ color: '#00d48a', fontWeight: 600, textDecoration: 'none', fontSize: '12px' }}>
                Go to Site Audit →
              </a>
            </div>
          </div>
        )}

        {domain && !loadingFixes && fixCount === 0 && (
          <div style={{ fontSize: '13px', color: '#9b9b9b', textAlign: 'center', padding: '20px 0' }}>
            <div style={{ marginBottom: '6px' }}>✅</div>
            No fixes queued yet. Run a site audit and click
            <strong style={{ color: '#00d48a' }}> Apply Fix Now</strong> on any issue.
            <div style={{ marginTop: '10px' }}>
              <a href="/dashboard/site-audit" style={{ color: '#00d48a', fontWeight: 600, textDecoration: 'none', fontSize: '12px' }}>
                Go to Site Audit →
              </a>
            </div>
          </div>
        )}

        {fixCount > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {fixes.map((fix, i) => {
              const label = FIX_TYPE_LABELS[fix.fix_type] || fix.fix_type;
              const preview = (fix.new_value || '').slice(0, 80);
              const page = fix.page_url?.replace(/^https?:\/\/[^/]+/, '') || '/';
              const updatedAt = fix.updated_at ? new Date(fix.updated_at).toLocaleDateString() : '';
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', background: '#fafaf8', borderRadius: '8px', fontSize: '12px' }}>
                  <div style={{ flexShrink: 0, fontSize: '9px', fontWeight: 700, color: '#00a870', background: '#00d48a1a', borderRadius: '4px', padding: '2px 6px', textTransform: 'uppercase' as const, letterSpacing: '0.3px' }}>
                    {label}
                  </div>
                  <div style={{ color: '#374151', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                    {preview}
                  </div>
                  <div style={{ color: '#9b9b9b', flexShrink: 0, fontSize: '10px' }}>
                    {page}
                  </div>
                  {updatedAt && (
                    <div style={{ color: '#c4c4c4', flexShrink: 0, fontSize: '10px' }}>
                      {updatedAt}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Alternate: seoranko.js script */}
      <div style={{ background: '#fffbf0', border: '1px solid #fed7aa', borderRadius: '12px', padding: '18px 20px' }}>
        <div style={{ fontSize: '13px', fontWeight: 700, color: '#92400e', marginBottom: '6px' }}>
          🔧 Want fixes to apply without Chrome?
        </div>
        <div style={{ fontSize: '12px', color: '#78350f', lineHeight: '1.6' }}>
          Install the SEORANKO script tag — it applies fixes server-side for all visitors and all browsers, not just when you&apos;re browsing.
        </div>
        <div style={{ marginTop: '12px' }}>
          <a href="/dashboard/install" style={{ fontSize: '12px', fontWeight: 700, color: '#d97706', textDecoration: 'none' }}>
            Install the SEORANKO script →
          </a>
        </div>
      </div>

    </div>
  );
}
