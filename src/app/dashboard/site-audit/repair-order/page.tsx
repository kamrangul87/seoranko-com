/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';
import { useState, useEffect, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase-client';
import { normaliseDomain } from '@/lib/connected-sites';
import type { SeoIssueRow, SeoIssueStatus } from '@/lib/seo-workshop/types';

const SEVERITY_STYLE: Record<string, { bg: string; fg: string; border: string }> = {
  critical: { bg: '#FEF2F2', fg: '#DC2626', border: '#FECACA' },
  warning: { bg: '#FFFBEB', fg: '#92400E', border: '#FDE68A' },
  notice: { bg: '#EFF6FF', fg: '#1D4ED8', border: '#BFDBFE' },
};

const STATUS_STYLE: Record<string, { bg: string; fg: string; border: string; label: string }> = {
  NEW: { bg: '#F5F4F1', fg: '#0F0F0F', border: '#E8E8E4', label: 'New' },
  PRIORITIZED: { bg: '#EFF6FF', fg: '#1D4ED8', border: '#BFDBFE', label: 'Prioritized' },
  IN_PROGRESS: { bg: '#FFF7ED', fg: '#C2410C', border: '#FED7AA', label: 'In Progress' },
  FIXED: { bg: '#F0FDF4', fg: '#16A34A', border: '#BBF7D0', label: 'Fixed' },
  VERIFYING: { bg: '#FFF7ED', fg: '#C2410C', border: '#FED7AA', label: 'Verifying' },
  VERIFIED: { bg: '#F0FDF4', fg: '#15803D', border: '#BBF7D0', label: 'Verified' },
  FAILED_VERIFICATION: { bg: '#FEF2F2', fg: '#DC2626', border: '#FECACA', label: 'Failed Verification' },
  DISMISSED: { bg: '#F5F4F1', fg: '#9B9B9B', border: '#E8E8E4', label: 'Dismissed' },
};

const ACTIONABILITY_LABEL: Record<string, string> = {
  AUTO_FIXABLE: 'Auto-fixable',
  HUMAN_GUIDED: 'Human-guided',
  NOT_ACTIONABLE_AUTOMATICALLY: 'Needs a human call',
};

const STATUS_FILTERS: Array<{ key: string; label: string }> = [
  { key: 'OPEN', label: 'Open' },
  { key: 'ALL', label: 'All' },
  { key: 'FIXED', label: 'Fixed' },
  { key: 'DISMISSED', label: 'Dismissed' },
];

const OPEN_STATUSES: SeoIssueStatus[] = ['NEW', 'PRIORITIZED', 'IN_PROGRESS', 'VERIFYING', 'FAILED_VERIFICATION'];

function Pill({ label, bg, fg, border }: { label: string; bg: string; fg: string; border: string }) {
  return (
    <span style={{ background: bg, color: fg, border: `1px solid ${border}`, fontSize: '10px', padding: '2px 8px', borderRadius: '20px', fontWeight: 700, whiteSpace: 'nowrap' as const }}>
      {label}
    </span>
  );
}

function RepairOrderInner() {
  const searchParams = useSearchParams();
  const domainParam = searchParams.get('domain') || '';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [siteNotConnected, setSiteNotConnected] = useState(false);
  const [issues, setIssues] = useState<SeoIssueRow[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('OPEN');
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError('');
      setSiteNotConnected(false);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setError('Sign in to view the Repair Order.'); setLoading(false); return; }

      if (!domainParam) { setError('No domain specified.'); setLoading(false); return; }

      const clean = normaliseDomain(domainParam);
      const { data: site } = await supabase
        .from('connected_sites')
        .select('id, domain')
        .eq('user_id', user.id)
        .eq('domain', clean)
        .maybeSingle();

      if (cancelled) return;

      if (!site) {
        setSiteNotConnected(true);
        setLoading(false);
        return;
      }
      const { data: rows, error: fetchErr } = await supabase
        .from('seo_issue')
        .select('*')
        .eq('site_id', site.id)
        .order('priority_score', { ascending: false, nullsFirst: false });

      if (cancelled) return;
      if (fetchErr) { setError(fetchErr.message); setLoading(false); return; }
      setIssues((rows ?? []) as SeoIssueRow[]);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [domainParam]);

  const filtered = useMemo(() => {
    if (statusFilter === 'ALL') return issues;
    if (statusFilter === 'OPEN') return issues.filter(i => OPEN_STATUSES.includes(i.status));
    return issues.filter(i => i.status === statusFilter);
  }, [issues, statusFilter]);

  const counts = useMemo(() => ({
    open: issues.filter(i => OPEN_STATUSES.includes(i.status)).length,
    fixed: issues.filter(i => i.status === 'FIXED' || i.status === 'VERIFIED').length,
    dismissed: issues.filter(i => i.status === 'DISMISSED').length,
  }), [issues]);

  async function dismiss(id: string) {
    setBusyId(id);
    const { error: updateErr } = await supabase
      .from('seo_issue')
      .update({ status: 'DISMISSED', updated_at: new Date().toISOString() })
      .eq('id', id);
    if (!updateErr) {
      setIssues(prev => prev.map(i => (i.id === id ? { ...i, status: 'DISMISSED' } : i)));
    }
    setBusyId(null);
  }

  return (
    <div style={{ padding: '32px', maxWidth: '1100px', margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ marginBottom: '20px' }}>
        <a href={`/dashboard/site-audit`} style={{ fontSize: '12px', color: '#6B6B6B', textDecoration: 'none' }}>← Back to Site Audit</a>
        <h1 style={{ fontSize: '22px', fontWeight: 800, margin: '8px 0 4px', color: '#0F0F0F' }}>Repair Order</h1>
        <div style={{ fontSize: '13px', color: '#6B6B6B' }}>
          {domainParam || 'No site selected'}
        </div>
      </div>

      {loading && <div style={{ color: '#6B6B6B', fontSize: '13px' }}>Loading…</div>}

      {!loading && error && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '8px', padding: '14px 18px', color: '#DC2626', fontSize: '13px' }}>{error}</div>
      )}

      {!loading && siteNotConnected && (
        <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '8px', padding: '14px 18px', color: '#92400E', fontSize: '13px' }}>
          Not enough data — this site hasn&rsquo;t been inspected while signed in yet. Run an inspection from{' '}
          <a href={`/dashboard/site-audit`} style={{ color: '#92400E', fontWeight: 700 }}>Site Audit</a> to populate the Repair Order.
        </div>
      )}

      {!loading && !error && !siteNotConnected && (
        <>
          <div style={{ background: '#fff', border: '1px solid #E8E8E4', borderRadius: '10px', padding: '14px 18px', marginBottom: '16px', fontSize: '12px', color: '#6B6B6B', lineHeight: 1.6 }}>
            <strong style={{ color: '#0F0F0F' }}>Repair Priority</strong> is a transparent score — severity, how many URLs are affected, detection confidence, and how easy the fix is — not a ranking prediction. Higher priority means fix this first, not &ldquo;this will move your rankings.&rdquo;
          </div>

          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' as const }}>
            {STATUS_FILTERS.map(f => {
              const count = f.key === 'OPEN' ? counts.open : f.key === 'FIXED' ? counts.fixed : f.key === 'DISMISSED' ? counts.dismissed : issues.length;
              return (
                <button
                  key={f.key}
                  onClick={() => setStatusFilter(f.key)}
                  style={{
                    padding: '6px 14px',
                    borderRadius: '20px',
                    fontSize: '12px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    border: statusFilter === f.key ? '1px solid #0F0F0F' : '1px solid #E8E8E4',
                    background: statusFilter === f.key ? '#0F0F0F' : '#fff',
                    color: statusFilter === f.key ? '#fff' : '#0F0F0F',
                  }}
                >
                  {f.label} ({count})
                </button>
              );
            })}
          </div>

          {filtered.length === 0 && (
            <div style={{ color: '#9B9B9B', fontSize: '13px', padding: '24px 0', textAlign: 'center' as const }}>
              {issues.length === 0 ? 'No issues recorded yet — run an inspection from Site Audit.' : 'Nothing in this filter.'}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column' as const, gap: '10px' }}>
            {filtered.map((issue, i) => {
              const sev = SEVERITY_STYLE[issue.severity] ?? SEVERITY_STYLE.notice;
              const st = STATUS_STYLE[issue.status] ?? STATUS_STYLE.NEW;
              const isOpen = OPEN_STATUSES.includes(issue.status);
              return (
                <div key={issue.id} style={{ background: '#fff', border: '1px solid #E8E8E4', borderRadius: '10px', padding: '16px 18px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' as const }}>
                    <div style={{ flex: 1, minWidth: '260px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', flexWrap: 'wrap' as const }}>
                        <span style={{ fontSize: '11px', color: '#9B9B9B', fontWeight: 700 }}>#{i + 1}</span>
                        <Pill label={issue.severity} bg={sev.bg} fg={sev.fg} border={sev.border} />
                        <Pill label={st.label} bg={st.bg} fg={st.fg} border={st.border} />
                        <Pill label={issue.category} bg="#F5F4F1" fg="#6B6B6B" border="#E8E8E4" />
                      </div>
                      <div style={{ fontSize: '14px', fontWeight: 600, color: '#0F0F0F' }}>{issue.title}</div>
                      {issue.page_url && (
                        <a href={issue.page_url} target="_blank" rel="noreferrer" style={{ fontSize: '11px', color: '#6B6B6B', textDecoration: 'none', display: 'inline-block', marginTop: '4px' }}>
                          {issue.page_url}
                        </a>
                      )}
                      <div style={{ display: 'flex', gap: '14px', marginTop: '8px', flexWrap: 'wrap' as const, fontSize: '11px', color: '#9B9B9B' }}>
                        <span>Affected: {issue.affected_url_count} URL{issue.affected_url_count !== 1 ? 's' : ''}</span>
                        {issue.implementation_effort && <span>Effort: {issue.implementation_effort}</span>}
                        {issue.confidence && <span>Confidence: {issue.confidence}</span>}
                        <span>{ACTIONABILITY_LABEL[issue.actionability] ?? issue.actionability}</span>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' as const, display: 'flex', flexDirection: 'column' as const, alignItems: 'flex-end', gap: '8px' }}>
                      <div>
                        <div style={{ fontSize: '20px', fontWeight: 800, color: '#0F0F0F' }}>{issue.priority_score ?? '—'}</div>
                        <div style={{ fontSize: '9px', color: '#9B9B9B', textTransform: 'uppercase' as const, letterSpacing: '0.5px' }}>Priority</div>
                      </div>
                      {isOpen && (
                        <button
                          onClick={() => dismiss(issue.id)}
                          disabled={busyId === issue.id}
                          style={{ fontSize: '11px', fontWeight: 700, padding: '5px 12px', background: '#fff', color: '#6B6B6B', border: '1px solid #E8E8E4', borderRadius: '6px', cursor: busyId === issue.id ? 'not-allowed' : 'pointer', opacity: busyId === issue.id ? 0.5 : 1 }}
                        >
                          Dismiss
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

export default function RepairOrderPage() {
  return (
    <Suspense fallback={<div style={{ padding: '32px', fontFamily: 'system-ui, sans-serif', color: '#6B6B6B' }}>Loading…</div>}>
      <RepairOrderInner />
    </Suspense>
  );
}
