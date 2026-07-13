/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';
import { useState, useEffect } from 'react';
import { scoreContentFreshness } from '@/lib/aeo-signals';

export default function RankingAgentPage() {
  const [articles, setArticles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState<string | null>(null);
  const [addUrl, setAddUrl] = useState('');
  const [addKeyword, setAddKeyword] = useState('');
  const [addMarket, setAddMarket] = useState('United Kingdom');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [deepAnalyses, setDeepAnalyses] = useState<Record<string, any>>({});
  const [citationResults, setCitationResults] = useState<Record<string, any>>({});
  const [panelArticleId, setPanelArticleId] = useState<string | null>(null);
  const [panelLoading, setPanelLoading] = useState(false);
  const [autoFixing, setAutoFixing] = useState(false);
  const [autoFixResult, setAutoFixResult] = useState('');
  const [autoFixArticle, setAutoFixArticle] = useState('');
  const [autoFixStage, setAutoFixStage] = useState('');

  useEffect(() => {
    if (!autoFixing) { setAutoFixStage(''); return; }
    const stages = [
      '⏳ Fetching top 3 competitors...',
      '⏳ Checking Google 2026 updates...',
      '⏳ Building improvement strategy...',
      '⏳ Rewriting article for top 5...',
    ];
    let i = 0;
    setAutoFixStage(stages[0]);
    const interval = setInterval(() => {
      i = Math.min(i + 1, stages.length - 1);
      setAutoFixStage(stages[i]);
    }, 12000);
    return () => clearInterval(interval);
  }, [autoFixing]);

  useEffect(() => {
    fetchArticles();
    const interval = setInterval(fetchArticles, 60000);
    return () => clearInterval(interval);
  }, []);

  async function fetchArticles() {
    try {
      const res = await fetch('/api/ranking-agent/track');
      const data = await res.json();
      if (data.articles) setArticles(data.articles);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  function captureDeepAnalyses(results: any[]) {
    setDeepAnalyses(prev => {
      const next = { ...prev };
      for (const r of results) {
        if (r.deepAnalysis) next[r.id] = r.deepAnalysis;
      }
      return next;
    });
    setCitationResults(prev => {
      const next = { ...prev };
      for (const r of results) {
        if (r.citationResult) next[r.id] = r.citationResult;
      }
      return next;
    });
  }

  function parseAnalysis(logs: any[]): any {
    if (!logs || logs.length === 0) return null;

    const analysisLog = [...logs]
      .reverse()
      .find((log: any) => log.action === 'DEEP_ANALYSIS');

    if (!analysisLog?.result) return null;

    let raw: string = typeof analysisLog.result === 'string'
      ? analysisLog.result
      : JSON.stringify(analysisLog.result);

    // Step 1: Remove ALL markdown
    raw = raw.replace(/```json/gi, '').replace(/```/gi, '').trim();

    // Step 2: If the whole thing is a JSON string (double-encoded), parse outer first
    if (raw.startsWith('"') && raw.endsWith('"')) {
      try { raw = JSON.parse(raw); } catch { /* continue */ }
    }

    // Step 3: Find the JSON object boundaries
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
      return {
        diagnosis: raw.replace(/["\\]/g, '').slice(0, 600),
        topCompetitorInsights: [], contentGaps: [],
        serpFeatures: [], priorityActions: [],
        estimatedPositionsToGain: 0,
      };
    }

    const jsonOnly = raw.slice(start, end + 1);

    // Step 4: Parse the JSON
    try {
      const parsed = JSON.parse(jsonOnly);
      return parsed;
    } catch {
      // Step 5: Manual extraction fallback
      const getStr = (key: string): string => {
        const patterns = [
          new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`),
          new RegExp(`"${key}"\\s*:\\s*'((?:[^'\\\\]|\\\\.)*)'`),
        ];
        for (const p of patterns) {
          const m = jsonOnly.match(p);
          if (m?.[1]) return m[1].replace(/\\n/g, ' ').replace(/\\"/g, '"');
        }
        return '';
      };

      const getArr = (key: string): string[] => {
        const m = jsonOnly.match(new RegExp(`"${key}"\\s*:\\s*\\[([\\s\\S]*?)\\]`));
        if (!m?.[1]) return [];
        const matches = m[1].match(/"((?:[^"\\\\]|\\\\.)+)"/g);
        return matches?.map((s: string) => s.slice(1, -1).replace(/\\"/g, '"')) || [];
      };

      return {
        diagnosis: getStr('diagnosis') || jsonOnly.slice(0, 400).replace(/[{}"\\]/g, ''),
        topCompetitorInsights: getArr('topCompetitorInsights'),
        contentGaps: getArr('contentGaps'),
        serpFeatures: getArr('serpFeatures'),
        priorityActions: getArr('priorityActions'),
        estimatedPositionsToGain: parseInt(getStr('estimatedPositionsToGain')) || 0,
      };
    }
  }

  function getAnalysisForArticle(article: any): any | null {
    if (!article) return null;
    if (deepAnalyses[article.id]) return deepAnalyses[article.id];
    return parseAnalysis(article.agent_logs || []);
  }

  async function handleTrackArticle() {
    if (!addUrl || !addKeyword) {
      setError('URL and keyword are required');
      return;
    }
    setAdding(true);
    setError('');
    try {
      const res = await fetch('/api/ranking-agent/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: addUrl, keyword: addKeyword, market: addMarket }),
      });
      const data = await res.json();
      if (data.error) { setError(data.error); return; }
      setAddUrl('');
      setAddKeyword('');
      await fetchArticles();
    } finally {
      setAdding(false);
    }
  }

  async function handleCheckNow(articleId: string) {
    setChecking(articleId);
    setPanelArticleId(articleId);
    setPanelLoading(true);
    try {
      const res = await fetch('/api/ranking-agent/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ articleId }),
      });
      const data = await res.json();
      if (data.results) captureDeepAnalyses(data.results);
      await fetchArticles();
    } finally {
      setChecking(null);
      setPanelLoading(false);
    }
  }

  async function handleCheckAll() {
    setChecking('all');
    try {
      const res = await fetch('/api/ranking-agent/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runAll: true }),
      });
      const data = await res.json();
      if (data.results) captureDeepAnalyses(data.results);
      await fetchArticles();
    } finally {
      setChecking(null);
    }
  }

  function openAnalysis(article: any) {
    setPanelArticleId(article.id);
    setAutoFixResult('');
    setAutoFixArticle('');
  }

  async function handleCheckCitation(article: any) {
    if (!article?.url || !article?.keyword) return;
    setChecking(`citation-${article.id}`);
    try {
      const res = await fetch('/api/check-citation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: article.keyword, articleUrl: article.url, articleId: article.id })
      });
      const data = await res.json();
      if (data.result) {
        setCitationResults(prev => ({ ...prev, [article.id]: data.result }));
      }
    } catch (err) {
      console.error('Citation check failed:', err);
    } finally {
      setChecking(null);
    }
  }

  async function handleAutoFix(article: any) {
    if (!article) return;
    setAutoFixing(true);
    setAutoFixResult('');
    setAutoFixArticle('');

    try {
      const res = await fetch('/api/ranking-agent/autofix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          articleId: article.id,
          currentArticleHtml: '',
        }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        setAutoFixResult('Error: ' + errorText.slice(0, 200));
        return;
      }

      let data: any;
      try {
        data = await res.json();
      } catch {
        const text = await res.text();
        setAutoFixResult('Error parsing response: ' + text.slice(0, 200));
        return;
      }

      if (data.error) {
        setAutoFixResult('Error: ' + data.error);
        return;
      }

      setAutoFixArticle(data.improvedArticle || '');
      setAutoFixResult(
        `✅ Auto-fix complete — analysed ${data.competitorsAnalysed || 0} competitors, applied Google 2026 updates.`
      );
      await fetchArticles();
    } catch (err: any) {
      setAutoFixResult('Error: ' + err.message);
    } finally {
      setAutoFixing(false);
    }
  }

  function getPositionBadge(current: number | null, previous: number | null) {
    if (!current) return <span style={badge('grey')}>Not ranked</span>;
    if (!previous) return <span style={badge('blue')}>#{current}</span>;
    const change = previous - current;
    if (change > 0) return <span style={badge('green')}>#{current} ▲{change}</span>;
    if (change < 0) return <span style={badge('red')}>#{current} ▼{Math.abs(change)}</span>;
    return <span style={badge('blue')}>#{current} →</span>;
  }

  function getTrendArrow(article: any) {
    const history = (article.rank_history || [])
      .filter((h: any) => h.position !== null)
      .sort((a: any, b: any) => new Date(a.checked_at).getTime() - new Date(b.checked_at).getTime());
    if (history.length < 2) return null;
    const recent = history.slice(-3);
    const first = recent[0].position;
    const last = recent[recent.length - 1].position;
    if (last < first) return <span style={{ color: '#16A34A', fontSize: '13px', marginLeft: '6px' }} title="Improving">↗</span>;
    if (last > first) return <span style={{ color: '#DC2626', fontSize: '13px', marginLeft: '6px' }} title="Dropping">↘</span>;
    return <span style={{ color: '#9B9B9B', fontSize: '13px', marginLeft: '6px' }} title="Stable">→</span>;
  }

  function getTargetInfo(current: number | null) {
    if (!current) return { label: '👻 Not indexed yet', color: '#9B9B9B' };
    if (current <= 5) return { label: '✅ Top 5', color: '#16A34A' };
    const toGo = current - 5;
    if (current <= 10) return { label: `🔥 Almost there — ${toGo} to go`, color: '#FF6B2C' };
    if (current <= 20) return { label: `⚡ ${toGo} positions to top 5`, color: '#EF9F27' };
    return { label: `🚀 ${toGo} positions to top 5`, color: '#6B6B6B' };
  }

  function getFreshnessColor(score: number) {
    if (score >= 80) return '#16A34A';
    if (score >= 60) return '#EF9F27';
    return '#E24B4A';
  }

  function impactBadgeStyle(action: string) {
    if (action.includes('HIGH')) return { background: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA' };
    if (action.includes('MEDIUM')) return { background: '#FFFBEB', color: '#92400E', border: '1px solid #FDE68A' };
    return { background: '#F0FDF4', color: '#166534', border: '1px solid #BBF7D0' };
  }

  const s: Record<string, any> = {
    page: { padding: '32px', maxWidth: '1100px', margin: '0 auto' },
    header: { marginBottom: '24px' },
    title: { fontSize: '22px', fontWeight: 700, color: '#0F0F0F', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' },
    subtitle: { fontSize: '14px', color: '#6B6B6B' },
    addBox: { background: '#fff', border: '1px solid #E8E8E4', borderRadius: '12px', padding: '20px', marginBottom: '20px' },
    addTitle: { fontSize: '14px', fontWeight: 600, color: '#0F0F0F', marginBottom: '14px' },
    addRow: { display: 'grid', gridTemplateColumns: '2fr 2fr 1fr auto', gap: '10px', alignItems: 'end' },
    label: { fontSize: '11px', fontWeight: 600, color: '#9B9B9B', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' },
    input: { width: '100%', fontSize: '13px', padding: '9px 12px', border: '1px solid #E8E8E4', borderRadius: '8px', background: '#fff', color: '#0F0F0F' },
    select: { width: '100%', fontSize: '13px', padding: '9px 10px', border: '1px solid #E8E8E4', borderRadius: '8px', background: '#fff', color: '#0F0F0F' },
    btnAdd: { fontSize: '13px', fontWeight: 600, padding: '9px 18px', background: '#FF6B2C', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', whiteSpace: 'nowrap' },
    topBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' },
    checkAllBtn: { fontSize: '13px', fontWeight: 600, padding: '8px 16px', background: '#0F0F0F', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer' },
    table: { background: '#fff', border: '1px solid #E8E8E4', borderRadius: '12px', overflow: 'hidden', width: '100%' },
    th: { padding: '12px 16px', fontSize: '11px', fontWeight: 600, color: '#9B9B9B', textTransform: 'uppercase', letterSpacing: '0.5px', background: '#FAFAF8', textAlign: 'left', borderBottom: '1px solid #E8E8E4' },
    td: { padding: '14px 16px', fontSize: '13px', color: '#0F0F0F', borderBottom: '1px solid #F5F4F1', verticalAlign: 'top' },
    checkBtn: { fontSize: '12px', fontWeight: 600, padding: '5px 12px', background: '#F5F4F1', color: '#0F0F0F', border: '1px solid #E8E8E4', borderRadius: '6px', cursor: 'pointer' },
    viewBtn: { fontSize: '12px', fontWeight: 600, padding: '5px 12px', background: '#FF6B2C', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', marginTop: '6px' },
    logItem: { fontSize: '11px', color: '#6B6B6B', padding: '3px 0', borderBottom: '1px solid #F5F4F1', display: 'flex', gap: '6px' },
    errorBox: { background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '8px', padding: '10px 14px', color: '#DC2626', fontSize: '13px', marginBottom: '14px' },
    emptyState: { textAlign: 'center', padding: '60px 20px', color: '#9B9B9B', fontSize: '14px' },
    overlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.4)', zIndex: 100 },
    panel: { position: 'fixed', top: 0, right: 0, bottom: 0, width: '460px', maxWidth: '100%', background: '#fff', boxShadow: '-8px 0 24px rgba(0,0,0,0.12)', zIndex: 101, overflowY: 'auto', padding: '24px' },
    panelClose: { position: 'absolute', top: '20px', right: '20px', fontSize: '20px', background: 'none', border: 'none', cursor: 'pointer', color: '#6B6B6B' },
    panelTitle: { fontSize: '16px', fontWeight: 700, color: '#0F0F0F', marginBottom: '4px', paddingRight: '30px' },
    panelSub: { fontSize: '12px', color: '#9B9B9B', marginBottom: '18px' },
    diagnosisBox: { borderLeft: '3px solid #FF6B2C', background: '#FFF7F2', padding: '12px 14px', borderRadius: '6px', fontSize: '13px', color: '#0F0F0F', lineHeight: 1.5, marginBottom: '18px' },
    sectionTitle: { fontSize: '12px', fontWeight: 700, color: '#0F0F0F', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px', marginTop: '18px' },
    actionItem: { display: 'flex', gap: '8px', fontSize: '13px', color: '#0F0F0F', padding: '8px 0', borderBottom: '1px solid #F5F4F1', alignItems: 'flex-start' },
    bulletList: { margin: 0, paddingLeft: '18px', fontSize: '13px', color: '#0F0F0F', lineHeight: 1.6 },
    gainBox: { background: '#F0FDF4', border: '1px solid #BBF7D0', color: '#16A34A', fontWeight: 700, fontSize: '13px', padding: '10px 14px', borderRadius: '8px', marginTop: '18px', textAlign: 'center' },
    panelEmpty: { textAlign: 'center', padding: '60px 20px', color: '#9B9B9B', fontSize: '13px' },
    spinner: { width: '32px', height: '32px', border: '3px solid #F5F4F1', borderTopColor: '#FF6B2C', borderRadius: '50%', margin: '40px auto 16px', animation: 'spin 0.8s linear infinite' },
    autoFixBox: { background: '#0F0F0F', borderRadius: '10px', padding: '16px', marginTop: '20px' },
    autoFixDesc: { fontSize: '12px', color: '#8899aa', marginBottom: '14px' },
    autoFixBtn: { fontSize: '13px', fontWeight: 700, padding: '10px 16px', background: '#FF6B2C', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', width: '100%' },
    autoFixStage: { fontSize: '12px', color: '#8899aa', marginTop: '10px', textAlign: 'center' },
    autoFixResult: { fontSize: '12px', color: '#fff', marginTop: '12px', lineHeight: 1.5 },
  };

  function badge(color: string) {
    const colors: any = {
      green: { background: '#F0FDF4', color: '#16A34A', border: '1px solid #BBF7D0' },
      red: { background: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA' },
      blue: { background: '#EFF6FF', color: '#2563EB', border: '1px solid #BFDBFE' },
      grey: { background: '#F5F4F1', color: '#9B9B9B', border: '1px solid #E8E8E4' },
    };
    return { ...colors[color], fontSize: '12px', fontWeight: 700, padding: '3px 10px', borderRadius: '20px', whiteSpace: 'nowrap' };
  }

  const panelArticle = panelArticleId ? articles.find(a => a.id === panelArticleId) : null;
  const panelAnalysis = getAnalysisForArticle(panelArticle);
  const panelCitationResult = panelArticleId ? citationResults[panelArticleId] : null;
  const diagnosisText = panelAnalysis?.diagnosis || '';
  const cleanDiagnosis = diagnosisText
    .replace(/^[`\s]*json\s*/i, '')
    .replace(/^[{"`\\]+/, '')
    .replace(/["`\\]+$/, '')
    .trim();

  return (
    <div style={s.page}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <div style={s.header}>
        <div style={s.title}>🤖 Ranking Agent</div>
        <div style={s.subtitle}>Tracks keyword positions automatically — detects drops, analyses competitors, logs every action.</div>
      </div>

      {/* Add article box */}
      <div style={s.addBox}>
        <div style={s.addTitle}>Track a new article</div>
        {error && <div style={s.errorBox}>{error}</div>}
        <div style={s.addRow}>
          <div>
            <div style={s.label}>Article URL</div>
            <input style={s.input} placeholder="https://autodun.com/blog/mot-cost-uk-2026.html" value={addUrl} onChange={e => setAddUrl(e.target.value)} />
          </div>
          <div>
            <div style={s.label}>Target keyword</div>
            <input style={s.input} placeholder="MOT cost UK" value={addKeyword} onChange={e => setAddKeyword(e.target.value)} />
          </div>
          <div>
            <div style={s.label}>Market</div>
            <select style={s.select} value={addMarket} onChange={e => setAddMarket(e.target.value)}>
              <option>United Kingdom</option>
              <option>United States</option>
              <option>Australia</option>
              <option>Canada</option>
            </select>
          </div>
          <div>
            <button style={{ ...s.btnAdd, opacity: adding ? 0.6 : 1 }} onClick={handleTrackArticle} disabled={adding}>
              {adding ? 'Adding...' : '+ Track Article'}
            </button>
          </div>
        </div>
      </div>

      {/* Articles table */}
      <div style={s.topBar}>
        <div style={{ fontSize: '14px', fontWeight: 600, color: '#0F0F0F' }}>
          {articles.length} article{articles.length !== 1 ? 's' : ''} tracked
        </div>
        {articles.length > 0 && (
          <button style={{ ...s.checkAllBtn, opacity: checking === 'all' ? 0.6 : 1 }} onClick={handleCheckAll} disabled={checking !== null}>
            {checking === 'all' ? '⏳ Checking all...' : '🔄 Check All Now'}
          </button>
        )}
      </div>

      {loading ? (
        <div style={s.emptyState}>Loading tracked articles...</div>
      ) : articles.length === 0 ? (
        <div style={s.emptyState}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>🤖</div>
          <div style={{ fontWeight: 600, color: '#0F0F0F', marginBottom: '6px' }}>No articles tracked yet</div>
          <div>Add your first article above to start monitoring its ranking position.</div>
        </div>
      ) : (
        <div style={s.table}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={s.th}>Article / Keyword</th>
                <th style={s.th}>Position</th>
                <th style={s.th}>🎯 Target</th>
                <th style={s.th}>Freshness</th>
                <th style={s.th}>Last checked</th>
                <th style={s.th}>Agent log</th>
                <th style={s.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {articles.map((article: any) => {
                const logs = (article.agent_logs || []).slice(0, 3);
                const lastChecked = article.last_checked
                  ? new Date(article.last_checked).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
                  : 'Never';
                const target = getTargetInfo(article.current_position);
                return (
                  <tr key={article.id}>
                    <td style={s.td}>
                      <div style={{ fontWeight: 600, marginBottom: '2px', fontSize: '13px' }}>{article.keyword}</div>
                      <div style={{ fontSize: '11px', color: '#9B9B9B', wordBreak: 'break-all' }}>{article.url}</div>
                      {article.created_at && (() => {
                        const freshness = scoreContentFreshness(article.created_at)
                        if (freshness.status === 'stale' || freshness.status === 'very-stale') {
                          return (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 8px', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '6px', marginTop: '4px', fontSize: '11px' }}>
                              <span style={{ color: '#92400E', fontWeight: 600 }}>⚠ Stale ({freshness.daysSincePublish}d)</span>
                              <span style={{ color: '#B45309' }}>{freshness.aeoImpact}</span>
                            </div>
                          )
                        }
                        return null
                      })()}
                    </td>
                    <td style={s.td}>
                      {getPositionBadge(article.current_position, article.previous_position)}
                      {getTrendArrow(article)}
                    </td>
                    <td style={{ ...s.td, color: target.color, fontWeight: 600, fontSize: '12px' }}>
                      {target.label}
                    </td>
                    <td style={s.td}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: `conic-gradient(${getFreshnessColor(article.freshness_score || 0)} ${(article.freshness_score || 0) * 3.6}deg, #F5F4F1 0deg)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <div style={{ width: '26px', height: '26px', borderRadius: '50%', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 700, color: getFreshnessColor(article.freshness_score || 0) }}>
                            {article.freshness_score || 0}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td style={{ ...s.td, fontSize: '12px', color: '#6B6B6B' }}>{lastChecked}</td>
                    <td style={s.td}>
                      {logs.length === 0 ? (
                        <div style={{ fontSize: '11px', color: '#9B9B9B' }}>No activity yet</div>
                      ) : logs.map((log: any, i: number) => (
                        <div key={i} style={s.logItem}>
                          <span style={{ color: log.action === 'RANK_DROP_DETECTED' ? '#E24B4A' : log.action === 'DEEP_ANALYSIS' ? '#FF6B2C' : '#16A34A', fontWeight: 600, flexShrink: 0 }}>
                            {log.action === 'RANK_DROP_DETECTED' ? '▼' : log.action === 'DEEP_ANALYSIS' ? '🔎' : '▲'}
                          </span>
                          <span>{log.reason}</span>
                        </div>
                      ))}
                    </td>
                    <td style={s.td}>
                      <button
                        style={{ ...s.checkBtn, opacity: checking === article.id ? 0.6 : 1 }}
                        onClick={() => handleCheckNow(article.id)}
                        disabled={checking !== null}
                      >
                        {checking === article.id ? '⏳' : '🔍 Check Now'}
                      </button>
                      {article.last_checked && (
                        <div>
                          <button style={s.viewBtn} onClick={() => openAnalysis(article)}>
                            🧠 View Analysis
                          </button>
                        </div>
                      )}
                      {/* Citation check */}
                      {(() => {
                        const cr = citationResults[article.id];
                        const isChecking = checking === `citation-${article.id}`;
                        if (!cr) return (
                          <button
                            onClick={() => handleCheckCitation(article)}
                            disabled={checking !== null}
                            style={{ fontSize: '11px', fontWeight: 600, padding: '4px 10px', background: '#F5F3FF', color: '#6D28D9', border: '1px solid #DDD6FE', borderRadius: '6px', cursor: checking !== null ? 'not-allowed' : 'pointer', marginTop: '6px', opacity: checking !== null ? 0.5 : 1, display: 'block', whiteSpace: 'nowrap' }}
                          >
                            {isChecking ? '⏳ Checking…' : '🤖 AI Citations'}
                          </button>
                        );
                        return (
                          <div style={{ marginTop: '6px', fontSize: '11px' }}>
                            <div style={{ padding: '4px 8px', borderRadius: '6px', fontWeight: 600, background: cr.isCited ? '#F0FDF4' : '#FEF2F2', border: `1px solid ${cr.isCited ? '#BBF7D0' : '#FECACA'}`, color: cr.isCited ? '#16A34A' : '#DC2626' }}>
                              {cr.isCited ? `✓ Cited (${cr.shareOfVoice}% SoV)` : '✗ Not cited'}
                            </div>
                            {!cr.isCited && cr.citedCompetitors?.length > 0 && (
                              <div style={{ color: '#9B9B9B', marginTop: '2px', fontSize: '10px' }}>vs {cr.citedCompetitors.slice(0, 2).join(', ')}</div>
                            )}
                            <button onClick={() => handleCheckCitation(article)} disabled={checking !== null} style={{ color: '#9B9B9B', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: '10px', marginTop: '2px' }}>
                              Refresh →
                            </button>
                          </div>
                        );
                      })()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Slide-out analysis panel */}
      {panelArticleId && (
        <>
          <div style={s.overlay} onClick={() => setPanelArticleId(null)} />
          <div style={s.panel}>
            <button style={s.panelClose} onClick={() => setPanelArticleId(null)}>✕</button>
            <div style={s.panelTitle}>🎯 {panelArticle?.keyword}</div>
            <div style={s.panelSub}>
              Currently #{panelArticle?.current_position ?? '—'} — SEO Analysis
            </div>

            {panelLoading ? (
              <div style={s.panelEmpty}>
                <div style={s.spinner} />
                Running analysis...
              </div>
            ) : !panelAnalysis ? (
              <div style={s.panelEmpty}>
                No analysis yet — click Check Now to run analysis.
              </div>
            ) : (
              <>
                <div style={s.sectionTitle}>🔍 Diagnosis</div>
                <div style={s.diagnosisBox}>{cleanDiagnosis}</div>

                {panelAnalysis.priorityActions?.length > 0 && (
                  <>
                    <div style={s.sectionTitle}>⚡ Priority Actions</div>
                    {panelAnalysis.priorityActions.map((action: string, i: number) => (
                      <div key={i} style={s.actionItem}>
                        <span style={{
                          fontSize: '10px', fontWeight: 700,
                          ...impactBadgeStyle(action), borderRadius: '4px',
                          padding: '2px 6px', flexShrink: 0, marginTop: '2px',
                          fontFamily: 'monospace',
                        }}>
                          {action.includes('HIGH') ? '●●●' : action.includes('MEDIUM') ? '●●○' : '●○○'}
                        </span>
                        <span>{action.replace(/^\d+\.\s*\[IMPACT:\s*(HIGH|MEDIUM|LOW)\]\s*/i, '')}</span>
                      </div>
                    ))}
                  </>
                )}

                {panelAnalysis.contentGaps?.length > 0 && (
                  <>
                    <div style={s.sectionTitle}>📋 Content Gaps</div>
                    <ul style={s.bulletList}>
                      {panelAnalysis.contentGaps.map((gap: string, i: number) => <li key={i}>{gap}</li>)}
                    </ul>
                  </>
                )}

                {panelAnalysis.serpFeatures?.length > 0 && (
                  <>
                    <div style={s.sectionTitle}>🏆 SERP Opportunities</div>
                    <ul style={s.bulletList}>
                      {panelAnalysis.serpFeatures.map((f: string, i: number) => <li key={i}>{f}</li>)}
                    </ul>
                  </>
                )}

                {panelAnalysis.topCompetitorInsights?.length > 0 && (
                  <>
                    <div style={s.sectionTitle}>💡 Competitor Insights</div>
                    <ul style={s.bulletList}>
                      {panelAnalysis.topCompetitorInsights.map((insight: string, i: number) => <li key={i}>{insight}</li>)}
                    </ul>
                  </>
                )}

                {typeof panelAnalysis.estimatedPositionsToGain === 'number' && panelAnalysis.estimatedPositionsToGain > 0 && (
                  <>
                    <div style={s.sectionTitle}>📈 Estimated Gain</div>
                    <div style={s.gainBox}>
                      +{panelAnalysis.estimatedPositionsToGain} positions in 30 days if all actions implemented
                    </div>
                  </>
                )}

                {/* AI Citation Result */}
                <div style={s.sectionTitle}>🤖 AI Citation
                  <span style={{ fontFamily: 'monospace', fontSize: '11px', fontWeight: 700, color: '#9B9B9B', marginLeft: '6px' }}>●○○</span>
                  <span style={{ fontSize: '10px', fontWeight: 400, color: '#9B9B9B', marginLeft: '4px' }}>EXPERIMENTAL</span>
                </div>
                {panelCitationResult ? (
                  <div style={{ background: '#FAFAF8', border: '1px solid #E8E8E4', borderRadius: '8px', padding: '12px', fontSize: '12px' }}>
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
                      <span style={{
                        fontFamily: 'monospace', fontWeight: 700, fontSize: '11px', padding: '2px 8px', borderRadius: '4px',
                        ...(panelCitationResult.cited
                          ? { background: '#F0FDF4', color: '#16A34A', border: '1px solid #BBF7D0' }
                          : panelCitationResult.mentioned
                            ? { background: '#FFFBEB', color: '#92400E', border: '1px solid #FDE68A' }
                            : { background: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA' })
                      }}>
                        {panelCitationResult.cited ? '●●● CITED' : panelCitationResult.mentioned ? '●●○ MENTIONED' : '●○○ NOT CITED'}
                      </span>
                    </div>
                    {panelCitationResult.responseSnippet && (
                      <div style={{ color: '#6B6B6B', lineHeight: 1.5, marginBottom: '6px' }}>
                        &ldquo;{panelCitationResult.responseSnippet.slice(0, 200)}{panelCitationResult.responseSnippet.length > 200 ? '…' : ''}&rdquo;
                      </div>
                    )}
                    {panelCitationResult.competitorsCited?.length > 0 && (
                      <div style={{ color: '#9B9B9B' }}>
                        Competitors cited instead: {panelCitationResult.competitorsCited.slice(0, 3).join(', ')}
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ background: '#FAFAF8', border: '1px solid #E8E8E4', borderRadius: '8px', padding: '10px 12px', fontSize: '12px', color: '#9B9B9B' }}>
                    Run Check Now to see AI citation status for this article&apos;s domain.
                  </div>
                )}

                <div style={s.autoFixBox}>
                  <div style={s.autoFixDesc}>
                    Automatically scrapes top 3 competitors, applies latest Google 2026
                    algorithm requirements, and rewrites the article to target top 5.
                  </div>
                  <button
                    style={{ ...s.autoFixBtn, opacity: autoFixing ? 0.6 : 1 }}
                    onClick={() => handleAutoFix(panelArticle)}
                    disabled={autoFixing}
                  >
                    {autoFixing ? '⏳ Auto-fixing...' : '🛠️ Auto-Fix Article'}
                  </button>
                  {autoFixing && autoFixStage && (
                    <div style={s.autoFixStage}>{autoFixStage}</div>
                  )}
                  {autoFixResult && (
                    <div style={s.autoFixResult}>{autoFixResult}</div>
                  )}

                  {autoFixArticle && (
                    <div style={{ marginTop: '16px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                        <div style={{ fontSize: '13px', fontWeight: 700, color: '#fff' }}>📄 Improved Article Ready</div>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(autoFixArticle);
                            alert('Article copied to clipboard!');
                          }}
                          style={{ fontSize: '12px', padding: '6px 14px', background: '#FF6B2C', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}
                        >
                          📋 Copy Article
                        </button>
                      </div>
                      <div style={{ background: '#1a1a2e', borderRadius: '8px', padding: '12px', maxHeight: '200px', overflowY: 'auto', fontSize: '11px', color: '#8899aa', fontFamily: 'monospace', lineHeight: 1.5 }}>
                        {autoFixArticle.slice(0, 500)}...
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
