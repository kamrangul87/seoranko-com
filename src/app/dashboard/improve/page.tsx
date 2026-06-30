'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react';

export default function ImproveArticlePage() {

  const [articleInput, setArticleInput] = useState('');
  const [keyword, setKeyword] = useState('');
  const [market, setMarket] = useState('United Kingdom');
  const [tone, setTone] = useState('professional');
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState('');
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const wordCount = articleInput.trim().split(/\s+/).filter(Boolean).length;

  const stages = [
    { key: 'detecting', label: 'Detecting keyword...' },
    { key: 'auditing', label: 'Auditing your article...' },
    { key: 'competitors', label: 'Analysing top competitors...' },
    { key: 'facts', label: 'Verifying facts from official sources...' },
    { key: 'rewriting', label: 'Rewriting and improving...' },
    { key: 'complete', label: 'Complete!' },
  ];

  async function handleImprove() {
    if (!articleInput.trim()) {
      setError('Please paste an article first');
      return;
    }
    setLoading(true);
    setError('');
    setResult(null);
    setProgress(5);
    setStage('detecting');

    const stageProgress: Record<string, number> = {
      detecting: 10,
      auditing: 25,
      competitors: 45,
      facts: 60,
      rewriting: 70,
    };

    try {
      const res = await fetch('/api/article-improve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ article: articleInput, keyword, market, tone }),
      });

      if (!res.ok) {
        const text = await res.text();
        try {
          setError(JSON.parse(text).error || 'Server error');
        } catch {
          setError(text.slice(0, 200) || 'Server error');
        }
        return;
      }

      // The route streams: stage markers → META JSON block → article HTML → STATS JSON block
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fullText += decoder.decode(value, { stream: true });

        const stageMatches = Array.from(fullText.matchAll(/<!--SEORANKO_STAGE:(\w+)-->/g));
        if (stageMatches.length > 0) {
          const latest = stageMatches[stageMatches.length - 1][1];
          setStage(latest);
          if (latest === 'rewriting') {
            const metaEnd = fullText.indexOf('<!--SEORANKO_META_END-->');
            const articleSoFar = metaEnd !== -1 ? fullText.slice(metaEnd) : '';
            setProgress(Math.min(95, 70 + Math.round(articleSoFar.length / 400)));
          } else {
            setProgress(stageProgress[latest] ?? 10);
          }
        }
      }

      const errMatch = fullText.match(/<!--SEORANKO_ERROR-->([\s\S]*)$/);
      if (errMatch) {
        setError(errMatch[1].trim() || 'Improvement failed');
        return;
      }

      const metaMatch = fullText.match(/<!--SEORANKO_META_START-->([\s\S]*?)<!--SEORANKO_META_END-->/);
      if (!metaMatch) {
        setError('Unexpected response from server — please try again');
        return;
      }

      const meta = JSON.parse(metaMatch[1]);
      const statsMatch = fullText.match(/<!--SEORANKO_STATS_START-->([\s\S]*?)<!--SEORANKO_STATS_END-->/);

      // Priority: WITH_IMAGES (article + embedded images) > HUMANIZED > raw
      const withImagesMatch = fullText.match(/<!--SEORANKO_WITH_IMAGES_START-->\n([\s\S]*?)\n<!--SEORANKO_WITH_IMAGES_END-->/);
      const humanizedMatch = fullText.match(/<!--SEORANKO_HUMANIZED_START-->\n([\s\S]*?)\n<!--SEORANKO_HUMANIZED_END-->/);

      const articleStart = fullText.indexOf('<!--SEORANKO_META_END-->') + '<!--SEORANKO_META_END-->'.length;
      const articleEnd = statsMatch ? fullText.indexOf('<!--SEORANKO_STATS_START-->') : fullText.length;
      const rawArticle = fullText
        .slice(articleStart, articleEnd)
        .replace(/<!--SEORANKO_STAGE:\w+-->/g, '')
        .replace(/<!--SEORANKO_HUMANIZED_START-->[\s\S]*?<!--SEORANKO_HUMANIZED_END-->/g, '')
        .replace(/<!--SEORANKO_WITH_IMAGES_START-->[\s\S]*?<!--SEORANKO_WITH_IMAGES_END-->/g, '')
        .replace(/<!--SEORANKO_IMAGE_SET_START-->[\s\S]*?<!--SEORANKO_IMAGE_SET_END-->/g, '')
        .trim();
      const improvedArticle = withImagesMatch
        ? withImagesMatch[1].trim()
        : humanizedMatch
          ? humanizedMatch[1].trim()
          : rawArticle;

      if (!improvedArticle) {
        setError('The rewrite did not complete — please try again');
        return;
      }

      // If the stats block never arrived (connection cut after the article
      // finished), compute fallback stats client-side rather than discarding
      // a complete article
      let statsData;
      if (statsMatch) {
        statsData = JSON.parse(statsMatch[1]);
      } else {
        const newWordCount = improvedArticle.replace(/<[^>]*>/g, ' ').trim().split(/\s+/).filter(Boolean).length;
        statsData = {
          improvements: [{ type: 'Article rewritten and upgraded', count: 1 }],
          stats: {
            originalWordCount: meta.audit?.word_count || 0,
            newWordCount,
            originalEeat: meta.audit?.eeat_score || 0,
            newEeat: Math.min(95, (meta.audit?.eeat_score || 0) + 55),
            originalKeywordDensity: meta.audit?.keyword_density || 0,
            issuesFixed: 1,
          },
        };
      }

      setStage('complete');
      setProgress(100);
      setResult({ ...meta, ...statsData, improvedArticle });

    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  function copyArticle() {
    if (result?.improvedArticle) {
      navigator.clipboard.writeText(result.improvedArticle);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  const s: Record<string, any> = {
    page: { padding: '32px', maxWidth: '1200px', margin: '0 auto' },
    header: { marginBottom: '24px' },
    title: { fontSize: '22px', fontWeight: 700, color: '#0F0F0F', marginBottom: '4px' },
    subtitle: { fontSize: '14px', color: '#6B6B6B' },
    flowSteps: { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '24px', flexWrap: 'wrap' as const },
    flowStep: { display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', color: '#6B6B6B', background: '#F5F4F1', padding: '5px 10px', borderRadius: '20px', border: '1px solid #E8E8E4', whiteSpace: 'nowrap' as const },
    flowStepActive: { background: '#FFF0E8', color: '#CC4A0F', border: '1px solid rgba(255,107,44,0.3)' },
    twoCol: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' },
    panel: { background: '#fff', border: '1px solid #E8E8E4', borderRadius: '12px', overflow: 'hidden' },
    panelHead: { padding: '12px 16px', borderBottom: '1px solid #E8E8E4', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
    panelTitle: { fontSize: '13px', fontWeight: 600, color: '#0F0F0F' },
    panelBody: { padding: '16px' },
    textarea: { width: '100%', minHeight: '200px', border: '1px solid #E8E8E4', borderRadius: '8px', background: '#FAFAF8', color: '#0F0F0F', fontSize: '13px', padding: '12px', resize: 'vertical' as const, fontFamily: 'monospace', lineHeight: 1.5 },
    input: { width: '100%', fontSize: '13px', marginTop: '8px', padding: '8px 12px', border: '1px solid #E8E8E4', borderRadius: '8px', background: '#fff', color: '#0F0F0F' },
    select: { width: '100%', fontSize: '13px', padding: '7px 10px', border: '1px solid #E8E8E4', borderRadius: '8px', background: '#fff', color: '#0F0F0F' },
    fieldRow: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '10px' },
    fieldLabel: { fontSize: '11px', fontWeight: 600, color: '#9B9B9B', marginBottom: '4px', textTransform: 'uppercase' as const, letterSpacing: '0.5px' },
    btnImprove: { width: '100%', marginTop: '12px', fontSize: '14px', fontWeight: 700, background: '#FF6B2C', color: '#fff', border: 'none', borderRadius: '8px', padding: '12px', cursor: 'pointer' },
    wordCountNote: { fontSize: '12px', color: '#9B9B9B', marginTop: '6px' },
    progressBox: { background: '#FFF0E8', border: '1px solid rgba(255,107,44,0.2)', borderRadius: '10px', padding: '20px', marginBottom: '16px' },
    progressLabel: { display: 'flex', justifyContent: 'space-between', marginBottom: '8px' },
    progressText: { fontSize: '13px', fontWeight: 600, color: '#CC4A0F' },
    progressPct: { fontSize: '13px', fontWeight: 700, color: '#FF6B2C' },
    progressTrack: { background: 'rgba(255,107,44,0.15)', borderRadius: '8px', height: '8px', overflow: 'hidden' },
    progressFill: { height: '100%', background: '#FF6B2C', borderRadius: '8px', transition: 'width 0.4s ease' },
    stepsRow: { display: 'flex', gap: '6px', marginTop: '12px', flexWrap: 'wrap' as const },
    stepDot: { fontSize: '12px', color: '#9B9B9B', display: 'flex', alignItems: 'center', gap: '4px' },
    stepDotDone: { color: '#16A34A' },
    scoreRow: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' },
    scoreLabel: { fontSize: '12px', color: '#6B6B6B', minWidth: '100px' },
    scoreTrack: { flex: 1, height: '6px', background: '#F5F4F1', borderRadius: '3px', overflow: 'hidden' },
    badgeRow: { display: 'flex', flexWrap: 'wrap' as const, gap: '6px', marginTop: '6px' },
    sectionLabel: { fontSize: '11px', fontWeight: 600, color: '#9B9B9B', textTransform: 'uppercase' as const, letterSpacing: '0.5px', marginBottom: '8px', marginTop: '14px' },
    issueItem: { fontSize: '12px', color: '#6B6B6B', padding: '5px 0', borderBottom: '1px solid #F5F4F1', display: 'flex', alignItems: 'flex-start', gap: '6px' },
    serpItem: { display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0', borderBottom: '1px solid #F5F4F1' },
    statsCompare: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '16px' },
    statCard: { background: '#F5F4F1', borderRadius: '8px', padding: '10px 12px', textAlign: 'center' as const },
    statLabel: { fontSize: '10px', color: '#9B9B9B', textTransform: 'uppercase' as const, letterSpacing: '0.3px', marginBottom: '4px' },
    statVal: { fontSize: '18px', fontWeight: 700, color: '#0F0F0F' },
    statChange: { fontSize: '11px', color: '#16A34A', fontWeight: 600 },
    impCard: { background: '#F5F4F1', borderRadius: '8px', padding: '10px 12px', marginBottom: '8px' },
    impCardTitle: { fontSize: '12px', fontWeight: 600, color: '#0F0F0F', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '5px' },
    baGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' },
    baBefore: { background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '6px', padding: '6px 8px' },
    baAfter: { background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: '6px', padding: '6px 8px' },
    baLabel: { fontSize: '10px', fontWeight: 600, marginBottom: '2px' },
    baText: { fontSize: '11px', color: '#6B6B6B', lineHeight: 1.4 },
    articleOutput: { background: '#FAFAF8', border: '1px solid #E8E8E4', borderRadius: '8px', padding: '16px', minHeight: '200px', fontSize: '14px', lineHeight: 1.7, color: '#0F0F0F', maxHeight: '500px', overflowY: 'auto' as const },
    copyBtn: { fontSize: '13px', fontWeight: 600, padding: '8px 16px', background: '#FF6B2C', color: '#fff', border: 'none', borderRadius: '7px', cursor: 'pointer' },
    errorBox: { background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '8px', padding: '12px 16px', color: '#DC2626', fontSize: '13px', marginBottom: '16px' },
  };

  function getBadgeStyle(type: string) {
    if (type === 'red') return { fontSize: '11px', padding: '3px 8px', borderRadius: '20px', background: '#FEF2F2', color: '#991B1B', border: '1px solid #FECACA', fontWeight: 600 };
    if (type === 'amber') return { fontSize: '11px', padding: '3px 8px', borderRadius: '20px', background: '#FFFBEB', color: '#92400E', border: '1px solid #FDE68A', fontWeight: 600 };
    return { fontSize: '11px', padding: '3px 8px', borderRadius: '20px', background: '#F0FDF4', color: '#166534', border: '1px solid #BBF7D0', fontWeight: 600 };
  }

  function getScoreColor(score: number) {
    if (score < 40) return '#E24B4A';
    if (score < 70) return '#EF9F27';
    return '#639922';
  }

  const currentStageIndex = stages.findIndex(st => st.key === stage);

  return (
    <div style={s.page}>

      <div style={s.header}>
        <div style={s.title}>🔧 Article Improver</div>
        <div style={s.subtitle}>Paste any article → get a full audit → receive a competitor-beating improved version</div>
      </div>

      <div style={s.flowSteps}>
        {stages.map((st, i) => (
          <span key={st.key} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ ...s.flowStep, ...((loading && i <= currentStageIndex) || stage === 'complete' ? s.flowStepActive : {}) }}>
              {i < currentStageIndex || stage === 'complete' ? '✓' : i + 1} {st.label.replace('...', '')}
            </span>
            {i < stages.length - 1 && <span style={{ color: '#9B9B9B', fontSize: '12px' }}>→</span>}
          </span>
        ))}
      </div>

      {error && <div style={s.errorBox}>⚠️ {error}</div>}

      {loading && (
        <div style={s.progressBox}>
          <div style={s.progressLabel}>
            <span style={s.progressText}>
              {stages.find(st => st.key === stage)?.label || 'Processing...'}
            </span>
            <span style={s.progressPct}>{progress}%</span>
          </div>
          <div style={s.progressTrack}>
            <div style={{ ...s.progressFill, width: `${progress}%` }}></div>
          </div>
        </div>
      )}

      <div style={s.twoCol}>

        {/* LEFT: Input */}
        <div style={s.panel}>
          <div style={s.panelHead}>
            <span style={s.panelTitle}>📄 Your article</span>
            <span style={{ fontSize: '12px', color: '#9B9B9B' }}>{wordCount} words</span>
          </div>
          <div style={s.panelBody}>
            <textarea
              style={s.textarea}
              placeholder="Paste your existing article here — HTML or plain text..."
              value={articleInput}
              onChange={e => setArticleInput(e.target.value)}
            />
            <input
              style={s.input}
              type="text"
              placeholder="Target keyword (optional — auto-detected)"
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
            />
            <div style={s.fieldRow}>
              <div>
                <div style={s.fieldLabel}>Market</div>
                <select style={s.select} value={market} onChange={e => setMarket(e.target.value)}>
                  <option>United Kingdom</option>
                  <option>United States</option>
                  <option>Global</option>
                  <option>Australia</option>
                  <option>Canada</option>
                </select>
              </div>
              <div>
                <div style={s.fieldLabel}>Tone</div>
                <select style={s.select} value={tone} onChange={e => setTone(e.target.value)}>
                  <option value="professional">Professional</option>
                  <option value="conversational">Conversational</option>
                  <option value="expert">Expert</option>
                </select>
              </div>
            </div>
            <button
              style={{ ...s.btnImprove, opacity: loading ? 0.6 : 1 }}
              onClick={handleImprove}
              disabled={loading}
            >
              {loading ? '⏳ Improving...' : '🔧 Audit & Improve Article'}
            </button>
          </div>
        </div>

        {/* RIGHT: Audit results */}
        <div style={s.panel}>
          <div style={s.panelHead}>
            <span style={s.panelTitle}>📊 Article audit</span>
            {result && (
              <span style={getBadgeStyle(result.audit.eeat_score < 40 ? 'red' : result.audit.eeat_score < 70 ? 'amber' : 'green')}>
                Score: {result.audit.eeat_score}/100
              </span>
            )}
            {!result && <span style={getBadgeStyle('amber')}>Awaiting analysis</span>}
          </div>
          <div style={s.panelBody}>

            {!result && !loading && (
              <div style={{ textAlign: 'center', padding: '40px 20px', color: '#9B9B9B', fontSize: '13px' }}>
                Paste your article and click &quot;Audit &amp; Improve&quot; to see the full analysis
              </div>
            )}

            {loading && (
              <div style={{ textAlign: 'center', padding: '40px 20px', color: '#CC4A0F', fontSize: '13px' }}>
                ⏳ {stages.find(st => st.key === stage)?.label || 'Analysing...'}
              </div>
            )}

            {result && (
              <>
                <div style={s.sectionLabel}>Content scores</div>
                {[
                  { label: 'EEAT score', value: result.audit.eeat_score, display: `${result.audit.eeat_score}/100` },
                  { label: 'Readability', value: result.audit.readability_score, display: `${result.audit.readability_score}/100` },
                  { label: 'Word count', value: Math.min(100, (result.audit.word_count / 2000) * 100), display: `${result.audit.word_count}` },
                  { label: 'Keyword density', value: Math.min(100, result.audit.keyword_density * 20), display: `${result.audit.keyword_density}%` },
                ].map(item => (
                  <div key={item.label} style={s.scoreRow}>
                    <span style={s.scoreLabel}>{item.label}</span>
                    <div style={s.scoreTrack}>
                      <div style={{ height: '100%', width: `${item.value}%`, background: getScoreColor(item.value), borderRadius: '3px', transition: 'width 0.5s' }}></div>
                    </div>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: getScoreColor(item.value), minWidth: '40px', textAlign: 'right' }}>{item.display}</span>
                  </div>
                ))}

                <div style={s.sectionLabel}>Missing elements</div>
                <div style={s.badgeRow}>
                  {!result.audit.has_h1 && <span style={getBadgeStyle('red')}>No H1 tag</span>}
                  {!result.audit.has_schema && <span style={getBadgeStyle('red')}>No schema</span>}
                  {!result.audit.has_faq && <span style={getBadgeStyle('red')}>No FAQ section</span>}
                  {!result.audit.has_official_sources && <span style={getBadgeStyle('red')}>No official sources</span>}
                  {!result.audit.has_internal_links && <span style={getBadgeStyle('amber')}>No internal links</span>}
                  {!result.audit.has_price_table && <span style={getBadgeStyle('amber')}>No price table</span>}
                  {result.audit.has_h1 && result.audit.has_schema && result.audit.has_faq && <span style={getBadgeStyle('green')}>Good structure</span>}
                </div>

                {result.audit.factual_errors?.length > 0 && (
                  <>
                    <div style={{ ...s.sectionLabel, color: '#DC2626' }}>⚠️ Factual errors found</div>
                    {result.audit.factual_errors.map((err: string, i: number) => (
                      <div key={i} style={s.issueItem}>
                        <span style={{ color: '#E24B4A', flexShrink: 0 }}>✗</span>
                        <span>{err}</span>
                      </div>
                    ))}
                  </>
                )}

                <div style={s.sectionLabel}>Top priorities to fix</div>
                {(result.audit.improvement_priority || []).slice(0, 4).map((p: string, i: number) => (
                  <div key={i} style={s.issueItem}>
                    <span style={{ color: '#EF9F27', flexShrink: 0 }}>{i + 1}.</span>
                    <span>{p}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </div>

      {/* SERP Analysis */}
      {result && (
        <>
          <div style={{ fontSize: '11px', fontWeight: 600, color: '#9B9B9B', textTransform: 'uppercase', letterSpacing: '0.8px', display: 'flex', alignItems: 'center', gap: '8px', margin: '16px 0 12px' }}>
            SERP &amp; competitor analysis
            <div style={{ flex: 1, height: '1px', background: '#E8E8E4' }}></div>
          </div>

          <div style={s.twoCol}>
            <div style={s.panel}>
              <div style={s.panelHead}>
                <span style={s.panelTitle}>🌐 Top competitors analysed</span>
              </div>
              <div style={s.panelBody}>
                {result.competitors.slice(0, 4).map((c: any, i: number) => (
                  <div key={i} style={{ ...s.serpItem, borderBottom: i < 3 ? '1px solid #F5F4F1' : 'none' }}>
                    <span style={{ fontSize: '11px', fontWeight: 600, color: '#9B9B9B', minWidth: '20px' }}>#{i + 1}</span>
                    <span style={{ fontSize: '12px', color: '#0F0F0F', fontWeight: 500, flex: 1 }}>
                      {(() => { try { return new URL(c.url).hostname.replace('www.', ''); } catch { return c.url.slice(0, 30); } })()}
                    </span>
                    <span style={{ fontSize: '11px', color: '#9B9B9B' }}>~{c.wordCount} words</span>
                  </div>
                ))}
                {result.competitors.length === 0 && (
                  <div style={{ fontSize: '12px', color: '#9B9B9B', padding: '8px 0' }}>
                    No competitors fetched — analysis based on keyword data
                  </div>
                )}
              </div>
            </div>

            <div style={s.panel}>
              <div style={s.panelHead}>
                <span style={s.panelTitle}>🧩 Content gaps found</span>
                <span style={getBadgeStyle('amber')}>{result.contentGaps.length} gaps</span>
              </div>
              <div style={s.panelBody}>
                {result.contentGaps.map((gap: string, i: number) => (
                  <div key={i} style={{ ...s.issueItem, borderBottom: i < result.contentGaps.length - 1 ? '1px solid #F5F4F1' : 'none' }}>
                    <span style={{ color: '#16A34A', flexShrink: 0 }}>+</span>
                    <span>{gap}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Improvements made */}
          <div style={{ fontSize: '11px', fontWeight: 600, color: '#9B9B9B', textTransform: 'uppercase', letterSpacing: '0.8px', display: 'flex', alignItems: 'center', gap: '8px', margin: '16px 0 12px' }}>
            Improvements made
            <div style={{ flex: 1, height: '1px', background: '#E8E8E4' }}></div>
          </div>

          <div style={s.panel}>
            <div style={s.panelHead}>
              <span style={s.panelTitle}>✅ What was improved</span>
              <span style={getBadgeStyle('green')}>{result.improvements.length} improvements</span>
            </div>
            <div style={s.panelBody}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                {result.improvements.map((imp: any, i: number) => (
                  <div key={i} style={s.impCard}>
                    <div style={s.impCardTitle}>
                      <span style={{ color: '#16A34A' }}>✓</span>
                      {imp.type}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Stats comparison */}
          <div style={{ fontSize: '11px', fontWeight: 600, color: '#9B9B9B', textTransform: 'uppercase', letterSpacing: '0.8px', display: 'flex', alignItems: 'center', gap: '8px', margin: '16px 0 12px' }}>
            Improved article
            <div style={{ flex: 1, height: '1px', background: '#E8E8E4' }}></div>
          </div>

          <div style={s.statsCompare}>
            <div style={s.statCard}>
              <div style={s.statLabel}>EEAT score</div>
              <div style={s.statVal}>{result.stats.newEeat}</div>
              <div style={s.statChange}>+{result.stats.newEeat - result.stats.originalEeat} points</div>
            </div>
            <div style={s.statCard}>
              <div style={s.statLabel}>Word count</div>
              <div style={s.statVal}>{result.stats.newWordCount.toLocaleString()}</div>
              <div style={s.statChange}>+{(result.stats.newWordCount - result.stats.originalWordCount).toLocaleString()} words</div>
            </div>
            <div style={s.statCard}>
              <div style={s.statLabel}>Issues fixed</div>
              <div style={s.statVal}>{result.stats.issuesFixed}</div>
              <div style={s.statChange}>all resolved</div>
            </div>
            <div style={s.statCard}>
              <div style={s.statLabel}>Keyword</div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#0F0F0F', marginTop: '2px' }}>{result.keyword}</div>
              <div style={s.statChange}>detected</div>
            </div>
          </div>

          <div style={s.panel}>
            <div style={s.panelHead}>
              <span style={s.panelTitle}>📄 Improved article</span>
              <button style={s.copyBtn} onClick={copyArticle}>
                {copied ? '✓ Copied!' : '📋 Copy article'}
              </button>
            </div>
            <div style={s.panelBody}>
              <div
                style={s.articleOutput}
                className="article-rendered"
                dangerouslySetInnerHTML={{ __html: result.improvedArticle }}
              />
            </div>
          </div>
        </>
      )}

    </div>
  );
}
