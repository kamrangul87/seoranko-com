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

  // Fix panel state
  const [fixing, setFixing] = useState(false);
  const [fixResult, setFixResult] = useState<any>(null);
  const [showFixPanel, setShowFixPanel] = useState(false);
  const [fixStage, setFixStage] = useState('');

  // Publish state
  const [publishMode, setPublishMode] = useState<'github' | 'wordpress' | null>(null);
  const [githubRepo, setGithubRepo] = useState('');
  const [githubToken, setGithubToken] = useState('');
  const [githubPath, setGithubPath] = useState('');
  const [wpUrl, setWpUrl] = useState('');
  const [wpUsername, setWpUsername] = useState('');
  const [wpPassword, setWpPassword] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [publishSuccess, setPublishSuccess] = useState('');

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

  async function handleFixPage(page: any) {
    setFixing(true);
    setFixResult(null);
    setShowFixPanel(true);
    setFixStage('Fetching page content...');
    setPublishMode(null);
    setPublishSuccess('');

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

  async function handleGithubPublish(articleHtml: string) {
    setPublishing(true);
    setPublishSuccess('');
    try {
      const [owner, repo] = githubRepo.split('/');
      const headers: Record<string, string> = {
        Authorization: `token ${githubToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/vnd.github.v3+json',
      };

      let sha = '';
      try {
        const getRes = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/contents/${githubPath}`,
          { headers }
        );
        if (getRes.ok) {
          const existing = await getRes.json();
          sha = existing.sha;
        }
      } catch { /* new file — no SHA needed */ }

      const body: any = {
        message: 'SEO fix: improved article via SEORANKO site audit',
        content: btoa(unescape(encodeURIComponent(articleHtml))),
      };
      if (sha) body.sha = sha;

      const putRes = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/${githubPath}`,
        { method: 'PUT', headers, body: JSON.stringify(body) }
      );

      if (putRes.ok) {
        setPublishSuccess(`✅ Published to GitHub — ${githubRepo}/${githubPath}`);
      } else {
        const err = await putRes.json();
        setPublishSuccess(`❌ GitHub error: ${err.message}`);
      }
    } catch (err: any) {
      setPublishSuccess('❌ Error: ' + err.message);
    } finally {
      setPublishing(false);
    }
  }

  async function handleWordPressPublish(articleHtml: string) {
    setPublishing(true);
    setPublishSuccess('');
    try {
      const base = wpUrl.replace(/\/$/, '');
      const credentials = btoa(`${wpUsername}:${wpPassword}`);

      const titleMatch = articleHtml.match(/<h1[^>]*>([^<]+)<\/h1>/i);
      const title = titleMatch?.[1]?.trim() || fixResult?.keyword || 'Updated Article';

      const slug = fixResult?.keyword
        ?.toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');

      const createRes = await fetch(`${base}/wp-json/wp/v2/posts`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title,
          content: articleHtml,
          status: 'draft',
          slug,
        }),
      });

      if (createRes.ok) {
        const post = await createRes.json();
        setPublishSuccess(
          `✅ Saved as draft — review at ${base}/wp-admin/post.php?post=${post.id}&action=edit`
        );
      } else {
        const err = await createRes.json();
        setPublishSuccess(`❌ WordPress error: ${err.message || 'Check credentials'}`);
      }
    } catch (err: any) {
      setPublishSuccess('❌ Error: ' + err.message);
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
    darkInput: { width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #3a3a5e', background: '#0d0d1a', color: '#fff', fontSize: '12px', boxSizing: 'border-box' as const },
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
                          <button
                            onClick={e => { e.stopPropagation(); handleFixPage(page); }}
                            style={{ fontSize: '11px', fontWeight: 700, padding: '2px 10px', background: '#FF6B2C', color: '#fff', border: 'none', borderRadius: '20px', cursor: 'pointer', whiteSpace: 'nowrap' as const }}
                          >
                            🔧 Fix Page
                          </button>
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

      {/* Fix Panel Overlay */}
      {showFixPanel && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1001, display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end' }}
          onClick={() => !fixing && setShowFixPanel(false)}
        >
          <div
            style={{ width: '560px', height: '100vh', background: '#fff', overflowY: 'auto', display: 'flex', flexDirection: 'column', zIndex: 1002 }}
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

            {/* Content */}
            <div style={{ padding: '20px', flex: 1 }}>
              {/* Loading state */}
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

              {/* Error state */}
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

                  {/* Strategy brief */}
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
                    <div style={{ background: '#0F0F0F', borderRadius: '10px', padding: '20px', marginBottom: '16px' }}>
                      <div style={{ fontSize: '14px', fontWeight: 700, color: '#fff', marginBottom: '4px' }}>
                        📄 Improved Article Ready
                      </div>
                      <div style={{ fontSize: '12px', color: '#8899aa', marginBottom: '16px' }}>
                        {fixResult.improvedArticle.split(/\s+/).length} words · Google 2026 compliant
                      </div>

                      {/* Three publish options */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '16px' }}>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(fixResult.improvedArticle);
                            setPublishSuccess('✅ Copied to clipboard!');
                            setTimeout(() => setPublishSuccess(''), 3000);
                          }}
                          style={{ padding: '10px 8px', background: '#2a2a3e', border: '1px solid #3a3a5e', borderRadius: '8px', color: '#fff', cursor: 'pointer', fontSize: '12px', fontWeight: 600, textAlign: 'center' as const }}
                        >
                          📋 Copy HTML
                          <div style={{ fontSize: '10px', color: '#8899aa', marginTop: '2px' }}>Paste anywhere</div>
                        </button>
                        <button
                          onClick={() => setPublishMode(publishMode === 'github' ? null : 'github')}
                          style={{ padding: '10px 8px', background: publishMode === 'github' ? '#FF6B2C' : '#2a2a3e', border: `1px solid ${publishMode === 'github' ? '#FF6B2C' : '#3a3a5e'}`, borderRadius: '8px', color: '#fff', cursor: 'pointer', fontSize: '12px', fontWeight: 600, textAlign: 'center' as const }}
                        >
                          🐙 GitHub
                          <div style={{ fontSize: '10px', color: publishMode === 'github' ? '#fff' : '#8899aa', marginTop: '2px' }}>Static sites</div>
                        </button>
                        <button
                          onClick={() => setPublishMode(publishMode === 'wordpress' ? null : 'wordpress')}
                          style={{ padding: '10px 8px', background: publishMode === 'wordpress' ? '#FF6B2C' : '#2a2a3e', border: `1px solid ${publishMode === 'wordpress' ? '#FF6B2C' : '#3a3a5e'}`, borderRadius: '8px', color: '#fff', cursor: 'pointer', fontSize: '12px', fontWeight: 600, textAlign: 'center' as const }}
                        >
                          🌐 WordPress
                          <div style={{ fontSize: '10px', color: publishMode === 'wordpress' ? '#fff' : '#8899aa', marginTop: '2px' }}>WP sites</div>
                        </button>
                      </div>

                      {/* Publish success/error */}
                      {publishSuccess && (
                        <div style={{ background: publishSuccess.startsWith('❌') ? '#FEF2F2' : '#F0FDF4', border: `1px solid ${publishSuccess.startsWith('❌') ? '#FECACA' : '#BBF7D0'}`, borderRadius: '8px', padding: '10px 14px', marginBottom: '12px', fontSize: '12px', color: publishSuccess.startsWith('❌') ? '#DC2626' : '#166534', fontWeight: 600 }}>
                          {publishSuccess}
                        </div>
                      )}

                      {/* GitHub form */}
                      {publishMode === 'github' && (
                        <div style={{ background: '#1a1a2e', borderRadius: '8px', padding: '16px', marginBottom: '12px' }}>
                          <div style={{ fontSize: '12px', fontWeight: 600, color: '#fff', marginBottom: '12px' }}>🐙 Publish to GitHub</div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <input placeholder="GitHub repo (e.g. owner/repo-name)" value={githubRepo} onChange={e => setGithubRepo(e.target.value)} style={s.darkInput} />
                            <input placeholder="File path (e.g. public/blog/article.html)" value={githubPath} onChange={e => setGithubPath(e.target.value)} style={s.darkInput} />
                            <input type="password" placeholder="GitHub Personal Access Token" value={githubToken} onChange={e => setGithubToken(e.target.value)} style={s.darkInput} />
                            <div style={{ fontSize: '10px', color: '#8899aa' }}>Token needs: repo → contents write permission. Get at github.com/settings/tokens</div>
                            <button
                              onClick={() => handleGithubPublish(fixResult.improvedArticle)}
                              disabled={publishing || !githubRepo || !githubPath || !githubToken}
                              style={{ padding: '9px', background: '#FF6B2C', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 700, opacity: publishing || !githubRepo || !githubPath || !githubToken ? 0.5 : 1 }}
                            >
                              {publishing ? '⏳ Publishing...' : '🚀 Publish to GitHub'}
                            </button>
                          </div>
                        </div>
                      )}

                      {/* WordPress form */}
                      {publishMode === 'wordpress' && (
                        <div style={{ background: '#1a1a2e', borderRadius: '8px', padding: '16px', marginBottom: '12px' }}>
                          <div style={{ fontSize: '12px', fontWeight: 600, color: '#fff', marginBottom: '12px' }}>🌐 Publish to WordPress</div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <input placeholder="WordPress URL (e.g. https://yoursite.com)" value={wpUrl} onChange={e => setWpUrl(e.target.value)} style={s.darkInput} />
                            <input placeholder="WordPress username" value={wpUsername} onChange={e => setWpUsername(e.target.value)} style={s.darkInput} />
                            <input type="password" placeholder="Application password (not login password)" value={wpPassword} onChange={e => setWpPassword(e.target.value)} style={s.darkInput} />
                            <div style={{ fontSize: '10px', color: '#8899aa' }}>Use Application Password — WP Admin → Users → Your Profile → Application Passwords</div>
                            <button
                              onClick={() => handleWordPressPublish(fixResult.improvedArticle)}
                              disabled={publishing || !wpUrl || !wpUsername || !wpPassword}
                              style={{ padding: '9px', background: '#FF6B2C', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 700, opacity: publishing || !wpUrl || !wpUsername || !wpPassword ? 0.5 : 1 }}
                            >
                              {publishing ? '⏳ Publishing...' : '🚀 Publish to WordPress'}
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Article preview */}
                      <div style={{ background: '#1a1a2e', borderRadius: '8px', padding: '14px', maxHeight: '180px', overflowY: 'auto', fontSize: '11px', color: '#8899aa', fontFamily: 'monospace', lineHeight: 1.6 }}>
                        {fixResult.improvedArticle.slice(0, 500)}...
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
