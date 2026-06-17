/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';
import { useState } from 'react';

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
    setProgressLabel(
      mode === 'domain'
        ? `Discovering pages on ${domain}...`
        : 'Starting audit...'
    );

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
  };

  return (
    <div style={s.page}>
      <div style={s.title}>🔬 Site Audit</div>
      <div style={s.subtitle}>Discover all pages from your sitemap and audit each one for SEO issues and opportunities.</div>

      {/* Input card */}
      <div style={s.card}>
        {/* Tabs */}
        <div style={{ display: 'flex', gap: '4px', marginBottom: '20px', background: '#F5F4F1', padding: '4px', borderRadius: '8px', width: 'fit-content' }}>
          <button
            onClick={() => setMode('domain')}
            style={{ padding: '7px 16px', fontSize: '13px', fontWeight: 600, background: mode === 'domain' ? '#fff' : 'transparent', color: mode === 'domain' ? '#0F0F0F' : '#9B9B9B', border: 'none', borderRadius: '6px', cursor: 'pointer', boxShadow: mode === 'domain' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none' }}
          >
            🌐 Domain Audit
          </button>
          <button
            onClick={() => setMode('manual')}
            style={{ padding: '7px 16px', fontSize: '13px', fontWeight: 600, background: mode === 'manual' ? '#fff' : 'transparent', color: mode === 'manual' ? '#0F0F0F' : '#9B9B9B', border: 'none', borderRadius: '6px', cursor: 'pointer', boxShadow: mode === 'manual' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none' }}
          >
            📋 Manual URLs
          </button>
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

        <button
          style={{ ...s.auditBtn, opacity: loading ? 0.6 : 1 }}
          onClick={handleAudit}
          disabled={loading}
        >
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

          {discoveryError && (
            <div style={s.discoveryWarning}>
              ⚠️ {discoveryError}
            </div>
          )}

          {/* Summary stats */}
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

          {/* Results table */}
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
                          {page.metaDescription && (
                            <div style={{ marginTop: '12px', fontSize: '12px', color: '#6B6B6B', borderTop: '1px solid #E8E8E4', paddingTop: '10px' }}>
                              <strong>Meta description:</strong> {page.metaDescription}
                            </div>
                          )}
                          {!page.metaDescription && (
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
    </div>
  );
}
