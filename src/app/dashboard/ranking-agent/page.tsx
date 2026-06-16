/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';
import { useState, useEffect } from 'react';

export default function RankingAgentPage() {
  const [articles, setArticles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState<string | null>(null);
  const [addUrl, setAddUrl] = useState('');
  const [addKeyword, setAddKeyword] = useState('');
  const [addMarket, setAddMarket] = useState('United Kingdom');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');

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
    try {
      await fetch('/api/ranking-agent/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ articleId }),
      });
      await fetchArticles();
    } finally {
      setChecking(null);
    }
  }

  async function handleCheckAll() {
    setChecking('all');
    try {
      await fetch('/api/ranking-agent/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runAll: true }),
      });
      await fetchArticles();
    } finally {
      setChecking(null);
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

  function getFreshnessColor(score: number) {
    if (score >= 80) return '#16A34A';
    if (score >= 60) return '#EF9F27';
    return '#E24B4A';
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
    logItem: { fontSize: '11px', color: '#6B6B6B', padding: '3px 0', borderBottom: '1px solid #F5F4F1', display: 'flex', gap: '6px' },
    errorBox: { background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '8px', padding: '10px 14px', color: '#DC2626', fontSize: '13px', marginBottom: '14px' },
    emptyState: { textAlign: 'center', padding: '60px 20px', color: '#9B9B9B', fontSize: '14px' },
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

  return (
    <div style={s.page}>
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
                return (
                  <tr key={article.id}>
                    <td style={s.td}>
                      <div style={{ fontWeight: 600, marginBottom: '2px', fontSize: '13px' }}>{article.keyword}</div>
                      <div style={{ fontSize: '11px', color: '#9B9B9B', wordBreak: 'break-all' }}>{article.url}</div>
                    </td>
                    <td style={s.td}>
                      {getPositionBadge(article.current_position, article.previous_position)}
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
                          <span style={{ color: log.action === 'RANK_DROP_DETECTED' ? '#E24B4A' : '#16A34A', fontWeight: 600, flexShrink: 0 }}>
                            {log.action === 'RANK_DROP_DETECTED' ? '▼' : '▲'}
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
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
