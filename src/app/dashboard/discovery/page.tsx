"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Opportunity {
  rank: number;
  problem: string;
  gapScore: number;
  volume: number;
  competition: "Low" | "Medium" | "High";
  intent: "Informational" | "Commercial" | "Transactional";
  sources: { youtube: number; trends: number; news: number };
  entities: string[];
  whyGapExists: string;
}

interface Summary {
  total: number;
  avgGapScore: number;
  zeroContentGaps: number;
  sourcesActive: number;
}

type SourceStatus = "loading" | "done" | "error" | "skipped";

// ─── Constants ────────────────────────────────────────────────────────────────

const MARKETS = [
  "Global", "US", "UK", "AU", "CA", "IN", "AE", "SA", "SG", "DE", "FR", "ZA", "PK",
] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function GapBar({ score }: { score: number }) {
  const color = score >= 80 ? "#22c55e" : score >= 50 ? "#FF6B2C" : "#ef4444";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-[#E8E8E4] rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${score}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs font-semibold w-7 text-right" style={{ color }}>{score}</span>
    </div>
  );
}

const COMPETITION_STYLES: Record<string, string> = {
  Low:    "bg-green-500/10 text-green-400",
  Medium: "bg-[#FF6B2C]/10 text-[#FF6B2C]",
  High:   "bg-red-500/10 text-red-400",
};

const INTENT_STYLES: Record<string, string> = {
  Informational: "bg-blue-500/10 text-blue-400",
  Commercial:    "bg-purple-500/10 text-purple-400",
  Transactional: "bg-green-500/10 text-green-400",
};

function SourceDot({ status }: { status: SourceStatus }) {
  if (status === "loading") return <span className="w-2 h-2 rounded-full bg-[#FF6B2C] animate-pulse inline-block" />;
  if (status === "done")    return <span className="w-2 h-2 rounded-full bg-[#22c55e] inline-block" />;
  if (status === "error")   return <span className="w-2 h-2 rounded-full bg-[#ef4444] inline-block" />;
  if (status === "skipped") return <span className="w-2 h-2 rounded-full bg-[#D4D4CE] inline-block" />;
  return <span className="w-2 h-2 rounded-full bg-[#E8E8E4] inline-block" />;
}

// ─── Pipeline Bar ─────────────────────────────────────────────────────────────

function PipelineBar({ step }: { step: "discovery" | "nlp" | "keywords" | "article" }) {
  const steps = [
    { id: "discovery", label: "Discovery" },
    { id: "nlp",       label: "NLP Analysis" },
    { id: "keywords",  label: "Keywords" },
    { id: "article",   label: "Article" },
  ] as const;
  const currentIndex = steps.findIndex((s) => s.id === step);
  return (
    <div className="flex items-center mb-6 bg-white border border-[#E8E8E4] rounded-[10px] px-5 py-3">
      {steps.map((s, i) => {
        const isDone = i < currentIndex;
        const isCurrent = i === currentIndex;
        return (
          <div key={s.id} className="flex items-center flex-1 last:flex-none">
            <div className={`flex items-center gap-1.5 text-xs font-medium whitespace-nowrap ${isCurrent ? "text-[#FF6B2C]" : isDone ? "text-[#22c55e]" : "text-[#9B9B9B]"}`}>
              {isDone ? (
                <span className="w-4 h-4 rounded-full bg-[#22c55e]/20 flex items-center justify-center">
                  <svg className="w-2.5 h-2.5 text-[#22c55e]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                </span>
              ) : (
                <span className={`w-4 h-4 rounded-full flex items-center justify-center ${isCurrent ? "bg-[#FF6B2C]/20" : "bg-[#E8E8E4]"}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${isCurrent ? "bg-[#FF6B2C]" : "bg-[#D4D4CE]"}`} />
                </span>
              )}
              {s.label}
            </div>
            {i < steps.length - 1 && (
              <div className={`flex-1 h-px mx-3 ${isDone ? "bg-[#22c55e]/40" : "bg-[#E8E8E4]"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function Sidebar({ onSignOut }: { onSignOut: () => void }) {
  const navItems = [
    { label: "Keywords",     href: "/dashboard",           icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg> },
    { label: "Articles",     href: "/dashboard",           icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg> },
    { label: "Discovery",    href: "/dashboard/discovery", icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg> },
    { label: "NLP Analyser", href: "/dashboard/nlp",       icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg> },
  ];
  return (
    <aside className="w-56 flex-shrink-0 bg-[#FAFAF8] border-r border-[#E8E8E4] flex flex-col">
      <div className="p-4 border-b border-[#E8E8E4]">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="w-7 h-7 bg-[#FF6B2C] rounded-[6px] flex items-center justify-center">
            <span className="text-[#0a0a0a] font-extrabold text-xs">S</span>
          </div>
          <span className="font-bold text-base tracking-tight text-[#0F0F0F]">Seoranko</span>
        </Link>
      </div>
      <nav className="flex-1 p-3 space-y-0.5">
        {navItems.map(({ label, href, icon }) => {
          const active = label === "Discovery";
          return (
            <Link
              key={label}
              href={href}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-[8px] text-sm font-medium transition-colors ${
                active ? "bg-[#FF6B2C]/10 text-[#FF6B2C]" : "text-[#6B6B6B] hover:text-[#0F0F0F] hover:bg-[#F5F4F1]"
              }`}
            >
              {icon}{label}
            </Link>
          );
        })}
      </nav>
      <div className="p-3 border-t border-[#E8E8E4]">
        <button
          onClick={onSignOut}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-[8px] text-sm font-medium text-[#6B6B6B] hover:text-[#0F0F0F] hover:bg-[#F5F4F1] transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          Sign Out
        </button>
      </div>
    </aside>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function DiscoveryPage() {
  const router = useRouter();
  const [niche, setNiche] = useState("");
  const [depth, setDepth] = useState<"quick" | "deep">("quick");
  const [region, setRegion] = useState("Global");
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState("");
  const [status, setStatus] = useState<Record<string, SourceStatus>>({});
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  function clearPipeline() {
    localStorage.removeItem("discovery_opportunity");
    localStorage.removeItem("nlp_analysis");
    localStorage.removeItem("article_brief");
  }

  async function handleRun() {
    if (!niche.trim()) return;
    setLoading(true);
    setError("");
    setOpportunities([]);
    setSummary(null);
    setStage("Connecting…");
    setStatus({});
    setCounts({});
    setExpanded(null);
    clearPipeline();

    try {
      const res = await fetch("/api/discovery/find", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ niche: niche.trim(), depth, region }),
      });

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: "Request failed" }));
        throw new Error((err as { error?: string }).error || "Request failed");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          if (!part.startsWith("data: ")) continue;
          const data = JSON.parse(part.slice(6)) as {
            stage?: string;
            status?: Record<string, SourceStatus>;
            counts?: Record<string, number>;
            error?: string;
            done?: boolean;
            opportunities?: Opportunity[];
            summary?: Summary;
          };
          if (data.stage) setStage(data.stage);
          if (data.status) setStatus(data.status);
          if (data.counts) setCounts(data.counts);
          if (data.error) throw new Error(data.error);
          if (data.done) {
            setOpportunities(data.opportunities ?? []);
            setSummary(data.summary ?? null);
            if (data.counts) setCounts(data.counts);
            setStage("");
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  const [analysingOpp, setAnalysingOpp] = useState<string | null>(null);

  async function handleNlpAnalyse(opp: Opportunity) {
    setAnalysingOpp(opp.problem);
    try {
      const res = await fetch('/api/utils/extract-keyword', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ problem: opp.problem }),
      });
      const { keyword: shortKeyword } = await res.json();
      const resolvedKeyword = shortKeyword || opp.problem.split(' ').slice(0, 3).join(' ');

      const payload = {
        problem:      opp.problem,
        fullProblem:  opp.problem,
        shortKeyword: resolvedKeyword,
        entities:     opp.entities,
        gapScore:     opp.gapScore,
        volume:       opp.volume,
        competition:  opp.competition,
        intent:       opp.intent,
        whyGapExists: opp.whyGapExists,
        region,
      };
      localStorage.setItem("discovery_opportunity", JSON.stringify(payload));
      router.push(
        `/dashboard/nlp?keyword=${encodeURIComponent(resolvedKeyword)}&from=discovery&region=${encodeURIComponent(region)}`
      );
    } catch {
      // Fallback: navigate with first 3 words of problem
      const fallback = opp.problem.split(' ').slice(0, 3).join(' ');
      localStorage.setItem("discovery_opportunity", JSON.stringify({
        problem: opp.problem, fullProblem: opp.problem, shortKeyword: fallback,
        entities: opp.entities, gapScore: opp.gapScore, volume: opp.volume,
        competition: opp.competition, intent: opp.intent, whyGapExists: opp.whyGapExists, region,
      }));
      router.push(
        `/dashboard/nlp?keyword=${encodeURIComponent(fallback)}&from=discovery&region=${encodeURIComponent(region)}`
      );
    } finally {
      setAnalysingOpp(null);
    }
  }

  return (
    <div
      className="flex h-screen bg-[#FAFAF8] text-[#0F0F0F] overflow-hidden"
      style={{ fontFamily: "'Outfit', sans-serif" }}
    >
      <Sidebar onSignOut={handleSignOut} />

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-8 py-8">

          {/* Header */}
          <div className="mb-6">
            <h1 className="text-2xl font-bold mb-1">Content Gap Discovery</h1>
            <p className="text-[#6B6B6B] text-sm">
              Find untapped content opportunities by scanning YouTube, Google Trends, and News.
            </p>
          </div>

          {/* Pipeline bar */}
          <PipelineBar step="discovery" />

          {/* Input card */}
          <div className="bg-white border border-[#E8E8E4] rounded-[10px] p-5 mb-6">
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                type="text"
                value={niche}
                onChange={(e) => setNiche(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !loading && handleRun()}
                placeholder="e.g. electric vehicles, keto diet, SaaS pricing"
                className="flex-1 bg-[#FAFAF8] border border-[#E8E8E4] rounded-[8px] px-4 py-2.5 text-sm text-[#0F0F0F] placeholder-[#9B9B9B] focus:outline-none focus:border-[#FF6B2C]/50 transition-colors"
              />

              {/* Market selector */}
              <select
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                className="bg-[#FAFAF8] border border-[#E8E8E4] rounded-[8px] px-3 py-2.5 text-sm text-[#0F0F0F] focus:outline-none focus:border-[#FF6B2C]/50 transition-colors"
              >
                {MARKETS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>

              {/* Depth toggle */}
              <div className="flex gap-2">
                {(["quick", "deep"] as const).map((d) => (
                  <button
                    key={d}
                    onClick={() => setDepth(d)}
                    className={`px-4 py-2.5 rounded-[8px] text-sm font-medium transition-colors capitalize ${
                      depth === d
                        ? "bg-[#FF6B2C] text-[#0a0a0a] font-semibold"
                        : "bg-[#FAFAF8] border border-[#E8E8E4] text-[#6B6B6B] hover:text-[#0F0F0F]"
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>

              <button
                onClick={handleRun}
                disabled={loading || !niche.trim()}
                className="bg-[#FF6B2C] hover:bg-[#E85A1E] disabled:opacity-50 disabled:cursor-not-allowed text-[#0a0a0a] font-semibold text-sm px-6 py-2.5 rounded-[8px] transition-colors whitespace-nowrap flex items-center gap-2"
              >
                {loading ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Running…
                  </>
                ) : "Find Gaps"}
              </button>
            </div>

            {/* Source status */}
            {Object.keys(status).length > 0 && (
              <div className="mt-4 pt-4 border-t border-[#E8E8E4] flex flex-wrap gap-4 items-center">
                {Object.entries(status).map(([src, st]) => {
                  const count = counts[src];
                  const showCount = st === "done" && count !== undefined;
                  const isEmpty = st === "done" && count === 0;
                  return (
                    <div key={src} className="flex items-center gap-1.5 text-xs">
                      <SourceDot status={isEmpty ? "error" : st} />
                      <span className={`capitalize ${st === "skipped" ? "text-[#9B9B9B]" : "text-[#6B6B6B]"}`}>
                        {src}
                      </span>
                      {showCount && (
                        <span className={`font-medium ${count > 0 ? "text-[#22c55e]" : "text-[#ef4444]"}`}>
                          {count > 0 ? `${count} signals` : "0"}
                        </span>
                      )}
                    </div>
                  );
                })}
                {stage && <span className="text-xs text-[#FF6B2C] ml-auto animate-pulse">{stage}</span>}
              </div>
            )}

            {error && (
              <div className="mt-3 bg-[#ef4444]/10 border border-[#ef4444]/20 rounded-[8px] px-4 py-3">
                <p className="text-[#ef4444] text-sm">{error}</p>
              </div>
            )}
          </div>

          {/* Summary */}
          {summary && (
            <div className="grid grid-cols-4 gap-4 mb-6">
              {[
                { label: "Opportunities",    value: summary.total },
                { label: "Avg Gap Score",    value: `${summary.avgGapScore}/100` },
                { label: "Zero-Content Gaps", value: summary.zeroContentGaps },
                { label: "Sources Active",   value: `${summary.sourcesActive}/3` },
              ].map(({ label, value }) => (
                <div key={label} className="bg-white border border-[#E8E8E4] rounded-[10px] p-4 text-center">
                  <p className="text-xl font-bold text-[#FF6B2C]">{value}</p>
                  <p className="text-xs text-[#6B6B6B] mt-1">{label}</p>
                </div>
              ))}
            </div>
          )}

          {/* Opportunities list */}
          {opportunities.length > 0 && (
            <div className="space-y-3">
              {opportunities.map((opp) => {
                const isExpanded = expanded === opp.rank;
                return (
                  <div
                    key={opp.rank}
                    className="bg-white border border-[#E8E8E4] rounded-[10px] overflow-hidden"
                  >
                    <button
                      onClick={() => setExpanded(isExpanded ? null : opp.rank)}
                      className="w-full flex items-center gap-4 px-5 py-4 hover:bg-[#F5F4F1] transition-colors text-left"
                    >
                      <span className="text-[#6B6B6B] text-sm font-semibold w-6 flex-shrink-0">#{opp.rank}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[#0F0F0F] truncate">{opp.problem}</p>
                        <p className="text-xs text-[#6B6B6B] mt-0.5 truncate">{opp.whyGapExists}</p>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <div className="w-28">
                          <GapBar score={opp.gapScore} />
                        </div>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-[6px] ${COMPETITION_STYLES[opp.competition] ?? "bg-[#E8E8E4] text-[#6B6B6B]"}`}>
                          {opp.competition}
                        </span>
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-[6px] ${INTENT_STYLES[opp.intent] ?? "bg-[#E8E8E4] text-[#6B6B6B]"}`}>
                          {opp.intent}
                        </span>
                        <svg
                          className={`w-4 h-4 text-[#6B6B6B] transition-transform flex-shrink-0 ${isExpanded ? "rotate-180" : ""}`}
                          fill="none" stroke="currentColor" viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="px-5 pb-5 border-t border-[#E8E8E4] pt-4">
                        <div className="grid md:grid-cols-3 gap-4">
                          <div className="space-y-3">
                            <p className="text-[#6B6B6B] text-xs font-semibold uppercase tracking-wide">Stats</p>
                            <div className="space-y-2">
                              <div className="flex justify-between text-sm">
                                <span className="text-[#6B6B6B]">Est. Volume</span>
                                <span className="font-medium">{opp.volume.toLocaleString()}/mo</span>
                              </div>
                              <div className="flex justify-between text-sm">
                                <span className="text-[#6B6B6B]">Gap Score</span>
                                <span className="font-medium text-[#FF6B2C]">{opp.gapScore}/100</span>
                              </div>
                              <div className="flex justify-between text-sm">
                                <span className="text-[#6B6B6B]">Competition</span>
                                <span className={`font-medium ${COMPETITION_STYLES[opp.competition]?.split(" ")[1] ?? ""}`}>{opp.competition}</span>
                              </div>
                              <div className="flex justify-between text-sm">
                                <span className="text-[#6B6B6B]">Market</span>
                                <span className="font-medium">{region}</span>
                              </div>
                            </div>
                          </div>

                          <div className="space-y-3">
                            <p className="text-[#6B6B6B] text-xs font-semibold uppercase tracking-wide">Signal Sources</p>
                            <div className="space-y-2">
                              {Object.entries(opp.sources).map(([src, count]) => (
                                <div key={src} className="flex justify-between text-sm">
                                  <span className="text-[#6B6B6B] capitalize">{src}</span>
                                  <span className="font-medium">{count} signals</span>
                                </div>
                              ))}
                            </div>
                          </div>

                          <div className="space-y-3">
                            <p className="text-[#6B6B6B] text-xs font-semibold uppercase tracking-wide">Key Entities</p>
                            <div className="flex flex-wrap gap-1.5">
                              {opp.entities.length > 0 ? opp.entities.map((e) => (
                                <span key={e} className="bg-[#FAFAF8] border border-[#E8E8E4] rounded-[6px] px-2 py-0.5 text-[11px] text-[#6B6B6B]">
                                  {e}
                                </span>
                              )) : <span className="text-xs text-[#6B6B6B]">None identified</span>}
                            </div>
                          </div>
                        </div>

                        <div className="mt-4 pt-4 border-t border-[#E8E8E4] flex items-start gap-2 mb-4">
                          <svg className="w-4 h-4 text-[#FF6B2C] flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <p className="text-sm text-[#6B6B6B]">
                            <span className="text-[#0F0F0F] font-medium">Why gap exists: </span>
                            {opp.whyGapExists}
                          </p>
                        </div>

                        {/* Pipeline CTA */}
                        <button
                          onClick={() => handleNlpAnalyse(opp)}
                          disabled={analysingOpp !== null}
                          className="w-full flex items-center justify-center gap-2 bg-[#FF6B2C] hover:bg-[#E85A1E] disabled:opacity-60 disabled:cursor-not-allowed text-[#0a0a0a] font-semibold text-sm px-4 py-2.5 rounded-[8px] transition-colors"
                        >
                          {analysingOpp === opp.problem ? (
                            <>
                              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                              </svg>
                              Extracting keyword…
                            </>
                          ) : (
                            <>
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                              </svg>
                              Run NLP Analysis →
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Empty state */}
          {!loading && opportunities.length === 0 && !error && (
            <div className="bg-white border border-[#E8E8E4] rounded-[10px] p-16 text-center">
              <svg className="w-12 h-12 text-[#D4D4CE] mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              <p className="text-[#6B6B6B] text-sm">Enter a niche above to discover content gaps</p>
            </div>
          )}

        </div>
      </main>
    </div>
  );
}
