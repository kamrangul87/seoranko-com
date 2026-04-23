"use client";

import { useState } from "react";
import Link from "next/link";
import type {
  KeywordResult,
  Cluster,
  ArticleOutput,
  ResearchBrief,
  ImagePrompt,
  Country,
  Tone,
} from "@/types";

// ─── Sidebar ────────────────────────────────────────────────────────────────

type NavItem = { id: string; label: string; icon: React.ReactNode };

const NAV_ITEMS: NavItem[] = [
  {
    id: "keywords",
    label: "Keywords",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
    ),
  },
  {
    id: "articles",
    label: "Articles",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  },
  {
    id: "images",
    label: "Images",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    id: "settings",
    label: "Settings",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
];

// ─── KD Badge ───────────────────────────────────────────────────────────────

function KdBadge({ kd }: { kd: number }) {
  const color =
    kd <= 35 ? "text-[#22c55e] bg-[#22c55e]/10" :
    kd <= 55 ? "text-[#f59e0b] bg-[#f59e0b]/10" :
               "text-[#ef4444] bg-[#ef4444]/10";
  return (
    <span className={`inline-block px-2 py-0.5 rounded-[6px] text-xs font-semibold ${color}`}>
      {kd}
    </span>
  );
}

// ─── Sparkline ──────────────────────────────────────────────────────────────

function Sparkline({ data }: { data: number[] }) {
  if (!data || data.length < 2) return <span className="text-[#6b7280] text-xs">—</span>;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const w = 60;
  const h = 24;
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / range) * (h - 4) - 2;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <polyline points={points} fill="none" stroke="#f59e0b" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ─── Score Ring ─────────────────────────────────────────────────────────────

function ScoreRing({ score, label, color }: { score: number; label: string; color: string }) {
  const r = 28;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative w-16 h-16">
        <svg className="w-16 h-16 -rotate-90" viewBox="0 0 64 64">
          <circle cx="32" cy="32" r={r} fill="none" stroke="#1f1f1f" strokeWidth="5" />
          <circle
            cx="32" cy="32" r={r}
            fill="none"
            stroke={color}
            strokeWidth="5"
            strokeDasharray={circ}
            strokeDashoffset={offset}
            strokeLinecap="round"
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-[#fafafa]">
          {score}
        </span>
      </div>
      <span className="text-[10px] text-[#6b7280] text-center leading-tight">{label}</span>
    </div>
  );
}

// ─── Intent Badge ────────────────────────────────────────────────────────────

const INTENT_STYLES: Record<string, string> = {
  informational: "bg-blue-500/10 text-blue-400",
  commercial:    "bg-purple-500/10 text-purple-400",
  transactional: "bg-green-500/10 text-green-400",
  navigational:  "bg-orange-500/10 text-orange-400",
};

function IntentBadge({ intent }: { intent: string }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded-[6px] text-xs font-medium capitalize ${INTENT_STYLES[intent] ?? "bg-[#1f1f1f] text-[#6b7280]"}`}>
      {intent}
    </span>
  );
}

// ─── Main Dashboard ──────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [activeNav, setActiveNav] = useState("keywords");

  // Keyword state
  const [seedKeyword, setSeedKeyword] = useState("");
  const [country, setCountry] = useState<Country>("UK");
  const [keywords, setKeywords] = useState<KeywordResult[]>([]);
  const [kwLoading, setKwLoading] = useState(false);
  const [kwError, setKwError] = useState("");
  const [selectedKws, setSelectedKws] = useState<Set<string>>(new Set());

  // Cluster state
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [clusterLoading, setClusterLoading] = useState(false);
  const [selectedCluster, setSelectedCluster] = useState<Cluster | null>(null);

  // Article settings
  const [wordCount, setWordCount] = useState(1500);
  const [tone, setTone] = useState<Tone>("professional");
  const [audience, setAudience] = useState("marketing professionals");
  const [articleLoading, setArticleLoading] = useState(false);
  const [articleStage, setArticleStage] = useState("");
  const [research, setResearch] = useState<ResearchBrief | null>(null);
  const [article, setArticle] = useState<ArticleOutput | null>(null);

  // Images state
  const [images, setImages] = useState<ImagePrompt[]>([]);
  const [imagesLoading, setImagesLoading] = useState(false);

  // ── Keyword search ────────────────────────────────────────────────────────
  async function handleKeywordSearch() {
    if (!seedKeyword.trim()) return;
    setKwLoading(true);
    setKwError("");
    setKeywords([]);
    setClusters([]);
    setSelectedCluster(null);
    setArticle(null);
    try {
      const res = await fetch("/api/keywords", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword: seedKeyword.trim(), country }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch keywords");
      setKeywords(data.keywords);
    } catch (e) {
      setKwError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setKwLoading(false);
    }
  }

  function toggleKeyword(kw: string) {
    setSelectedKws((prev) => {
      const next = new Set(prev);
      if (next.has(kw)) { next.delete(kw); } else { next.add(kw); }
      return next;
    });
  }

  // ── Cluster ───────────────────────────────────────────────────────────────
  async function handleCluster() {
    const kwsToCluster = keywords.filter((k) => selectedKws.size === 0 || selectedKws.has(k.keyword));
    if (kwsToCluster.length === 0) return;
    setClusterLoading(true);
    try {
      const res = await fetch("/api/cluster", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keywords: kwsToCluster }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Clustering failed");
      setClusters(data.clusters);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Clustering failed");
    } finally {
      setClusterLoading(false);
    }
  }

  // ── Article generation ────────────────────────────────────────────────────
  async function handleGenerateArticle() {
    const kw = selectedCluster?.keywords?.[0] ?? seedKeyword;
    if (!kw) return;
    setArticleLoading(true);
    setArticle(null);
    setResearch(null);
    setArticleStage("Connecting…");
    try {
      const res = await fetch("/api/article", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keyword: kw,
          cluster: selectedCluster,
          wordCount,
          tone,
          audience,
          country,
        }),
      });

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: "Generation failed" }));
        throw new Error(err.error || "Generation failed");
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
          const data = JSON.parse(part.slice(6));
          if (data.stage) setArticleStage(data.stage);
          if (data.error) throw new Error(data.error);
          if (data.done) {
            setResearch(data.research);
            setArticle(data.article);
            setActiveNav("articles");
          }
        }
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "Article generation failed");
    } finally {
      setArticleLoading(false);
      setArticleStage("");
    }
  }

  // ── Images ────────────────────────────────────────────────────────────────
  async function handleGenerateImages() {
    if (!article) return;
    setImagesLoading(true);
    try {
      const res = await fetch("/api/images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ article: article.article, keyword: seedKeyword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Image generation failed");
      setImages(data.images);
      setActiveNav("images");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Image generation failed");
    } finally {
      setImagesLoading(false);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen bg-[#0a0a0a] text-[#fafafa] overflow-hidden" style={{ fontFamily: "'Outfit', sans-serif" }}>

      {/* ── Sidebar ── */}
      <aside className="w-56 flex-shrink-0 border-r border-[#1f1f1f] flex flex-col">
        {/* Logo */}
        <div className="px-5 py-5 border-b border-[#1f1f1f]">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-7 h-7 bg-[#f59e0b] rounded-[7px] flex items-center justify-center">
              <span className="text-[#0a0a0a] font-extrabold text-xs">S</span>
            </div>
            <span className="font-bold text-base tracking-tight">Seoranko</span>
          </Link>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {NAV_ITEMS.map(({ id, label, icon }) => (
            <button
              key={id}
              onClick={() => setActiveNav(id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-[8px] text-sm font-medium transition-colors ${
                activeNav === id
                  ? "bg-[#f59e0b]/10 text-[#f59e0b]"
                  : "text-[#6b7280] hover:text-[#fafafa] hover:bg-[#111111]"
              }`}
            >
              {icon}
              {label}
            </button>
          ))}
        </nav>

        {/* Usage */}
        <div className="px-4 py-4 border-t border-[#1f1f1f]">
          <p className="text-[10px] text-[#6b7280] mb-1.5 uppercase tracking-wide font-medium">Usage this month</p>
          <div className="space-y-2">
            {[
              { label: "Keywords", used: 12, max: 50 },
              { label: "Articles", used: 3, max: 10 },
            ].map(({ label, used, max }) => (
              <div key={label}>
                <div className="flex justify-between text-[10px] text-[#6b7280] mb-1">
                  <span>{label}</span>
                  <span>{used}/{max}</span>
                </div>
                <div className="h-1 bg-[#1f1f1f] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#f59e0b] rounded-full"
                    style={{ width: `${(used / max) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </aside>

      {/* ── Main ── */}
      <main className="flex-1 overflow-y-auto">

        {/* ── KEYWORDS view ── */}
        {activeNav === "keywords" && (
          <div className="max-w-6xl mx-auto px-8 py-8">

            {/* Page header */}
            <div className="mb-8">
              <h1 className="text-2xl font-bold mb-1">Keyword Research</h1>
              <p className="text-[#6b7280] text-sm">Enter a seed topic to find ranking opportunities.</p>
            </div>

            {/* Search bar */}
            <div className="bg-[#111111] border border-[#1f1f1f] rounded-[10px] p-4 mb-6">
              <div className="flex flex-col sm:flex-row gap-3">
                <input
                  type="text"
                  value={seedKeyword}
                  onChange={(e) => setSeedKeyword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleKeywordSearch()}
                  placeholder="e.g. content marketing strategy"
                  className="flex-1 bg-[#0a0a0a] border border-[#1f1f1f] rounded-[8px] px-4 py-2.5 text-sm text-[#fafafa] placeholder-[#6b7280] focus:outline-none focus:border-[#f59e0b]/50 transition-colors"
                />
                <div className="flex gap-2">
                  {(["UK", "US", "Global"] as Country[]).map((c) => (
                    <button
                      key={c}
                      onClick={() => setCountry(c)}
                      className={`px-4 py-2.5 rounded-[8px] text-sm font-medium transition-colors ${
                        country === c
                          ? "bg-[#f59e0b] text-[#0a0a0a] font-semibold"
                          : "bg-[#0a0a0a] border border-[#1f1f1f] text-[#6b7280] hover:text-[#fafafa]"
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
                <button
                  onClick={handleKeywordSearch}
                  disabled={kwLoading || !seedKeyword.trim()}
                  className="bg-[#f59e0b] hover:bg-[#d97706] disabled:opacity-50 disabled:cursor-not-allowed text-[#0a0a0a] font-semibold text-sm px-6 py-2.5 rounded-[8px] transition-colors whitespace-nowrap"
                >
                  {kwLoading ? (
                    <span className="flex items-center gap-2">
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Searching…
                    </span>
                  ) : "Search"}
                </button>
              </div>
              {kwError && <p className="text-[#ef4444] text-sm mt-3">{kwError}</p>}
            </div>

            {/* Keywords table */}
            {keywords.length > 0 && (
              <>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm text-[#6b7280]">
                    <span className="text-[#fafafa] font-semibold">{keywords.length}</span> keywords found
                    {selectedKws.size > 0 && <span> · <span className="text-[#f59e0b]">{selectedKws.size} selected</span></span>}
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={handleCluster}
                      disabled={clusterLoading}
                      className="flex items-center gap-2 bg-[#111111] border border-[#1f1f1f] hover:border-[#f59e0b]/40 text-[#fafafa] text-sm font-medium px-4 py-2 rounded-[8px] transition-colors disabled:opacity-50"
                    >
                      {clusterLoading ? (
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4 text-[#f59e0b]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h8m-8 6h16" />
                        </svg>
                      )}
                      {clusterLoading ? "Clustering…" : "Cluster with AI"}
                    </button>
                  </div>
                </div>

                <div className="bg-[#111111] border border-[#1f1f1f] rounded-[10px] overflow-hidden mb-6">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[#1f1f1f]">
                        <th className="text-left text-[#6b7280] font-medium text-xs uppercase tracking-wide px-4 py-3 w-8">
                          <input
                            type="checkbox"
                            className="accent-[#f59e0b]"
                            checked={selectedKws.size === keywords.length && keywords.length > 0}
                            onChange={(e) =>
                              setSelectedKws(e.target.checked ? new Set(keywords.map((k) => k.keyword)) : new Set())
                            }
                          />
                        </th>
                        {["Keyword", "Volume", "KD", "CPC", "Intent", "Trend"].map((col) => (
                          <th key={col} className="text-left text-[#6b7280] font-medium text-xs uppercase tracking-wide px-4 py-3">
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {keywords.map((kw) => (
                        <tr
                          key={kw.keyword}
                          className={`border-b border-[#1f1f1f] last:border-0 hover:bg-[#161616] transition-colors cursor-pointer ${
                            selectedKws.has(kw.keyword) ? "bg-[#f59e0b]/5" : ""
                          }`}
                          onClick={() => toggleKeyword(kw.keyword)}
                        >
                          <td className="px-4 py-3">
                            <input
                              type="checkbox"
                              className="accent-[#f59e0b]"
                              checked={selectedKws.has(kw.keyword)}
                              onChange={() => toggleKeyword(kw.keyword)}
                              onClick={(e) => e.stopPropagation()}
                            />
                          </td>
                          <td className="px-4 py-3 font-medium text-[#fafafa]">{kw.keyword}</td>
                          <td className="px-4 py-3 text-[#6b7280]">{kw.volume.toLocaleString()}</td>
                          <td className="px-4 py-3"><KdBadge kd={kw.kd} /></td>
                          <td className="px-4 py-3 text-[#6b7280]">£{kw.cpc.toFixed(2)}</td>
                          <td className="px-4 py-3"><IntentBadge intent={kw.intent} /></td>
                          <td className="px-4 py-3"><Sparkline data={kw.trend} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {/* Clusters */}
            {clusters.length > 0 && (
              <div className="mb-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="font-bold text-lg">Keyword Clusters</h2>
                  <p className="text-[#6b7280] text-sm">Select a cluster to generate an article</p>
                </div>
                <div className="grid md:grid-cols-3 gap-4">
                  {clusters.map((cluster) => (
                    <div
                      key={cluster.name}
                      onClick={() => setSelectedCluster(cluster)}
                      className={`bg-[#111111] border rounded-[10px] p-5 cursor-pointer transition-all hover:border-[#f59e0b]/40 ${
                        selectedCluster?.name === cluster.name
                          ? "border-[#f59e0b] shadow-lg shadow-amber-500/10"
                          : "border-[#1f1f1f]"
                      }`}
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <p className="font-semibold text-sm">{cluster.name}</p>
                          <IntentBadge intent={cluster.intent} />
                        </div>
                        <div className="text-right">
                          <p className="text-[#f59e0b] font-bold text-lg">{cluster.opportunity}</p>
                          <p className="text-[#6b7280] text-[10px]">opportunity</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {cluster.keywords.slice(0, 4).map((kw) => (
                          <span key={kw} className="bg-[#0a0a0a] border border-[#1f1f1f] rounded-[6px] px-2 py-0.5 text-[11px] text-[#6b7280]">
                            {kw}
                          </span>
                        ))}
                        {cluster.keywords.length > 4 && (
                          <span className="text-[11px] text-[#6b7280]">+{cluster.keywords.length - 4} more</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Article generator settings */}
            {(clusters.length > 0 || keywords.length > 0) && (
              <div className="bg-[#111111] border border-[#1f1f1f] rounded-[10px] p-6">
                <h2 className="font-bold mb-5 flex items-center gap-2">
                  <svg className="w-4 h-4 text-[#f59e0b]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                  Generate Article
                </h2>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
                  <div>
                    <label className="text-[#6b7280] text-xs font-medium block mb-2 uppercase tracking-wide">Word Count</label>
                    <select
                      value={wordCount}
                      onChange={(e) => setWordCount(Number(e.target.value))}
                      className="w-full bg-[#0a0a0a] border border-[#1f1f1f] rounded-[8px] px-3 py-2 text-sm text-[#fafafa] focus:outline-none focus:border-[#f59e0b]/50"
                    >
                      {[1000, 1500, 2000, 2500, 3000].map((n) => (
                        <option key={n} value={n}>{n} words</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-[#6b7280] text-xs font-medium block mb-2 uppercase tracking-wide">Tone</label>
                    <select
                      value={tone}
                      onChange={(e) => setTone(e.target.value as Tone)}
                      className="w-full bg-[#0a0a0a] border border-[#1f1f1f] rounded-[8px] px-3 py-2 text-sm text-[#fafafa] focus:outline-none focus:border-[#f59e0b]/50"
                    >
                      <option value="professional">Professional</option>
                      <option value="conversational">Conversational</option>
                      <option value="authoritative">Authoritative</option>
                      <option value="friendly">Friendly</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-[#6b7280] text-xs font-medium block mb-2 uppercase tracking-wide">Audience</label>
                    <input
                      type="text"
                      value={audience}
                      onChange={(e) => setAudience(e.target.value)}
                      className="w-full bg-[#0a0a0a] border border-[#1f1f1f] rounded-[8px] px-3 py-2 text-sm text-[#fafafa] placeholder-[#6b7280] focus:outline-none focus:border-[#f59e0b]/50"
                      placeholder="e.g. marketing managers"
                    />
                  </div>

                  <div>
                    <label className="text-[#6b7280] text-xs font-medium block mb-2 uppercase tracking-wide">Market</label>
                    <select
                      value={country}
                      onChange={(e) => setCountry(e.target.value as Country)}
                      className="w-full bg-[#0a0a0a] border border-[#1f1f1f] rounded-[8px] px-3 py-2 text-sm text-[#fafafa] focus:outline-none focus:border-[#f59e0b]/50"
                    >
                      <option value="UK">UK</option>
                      <option value="US">US</option>
                      <option value="Global">Global</option>
                    </select>
                  </div>
                </div>

                {selectedCluster && (
                  <div className="bg-[#0a0a0a] border border-[#1f1f1f] rounded-[8px] px-4 py-3 mb-5 flex items-center gap-3">
                    <svg className="w-4 h-4 text-[#f59e0b] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <p className="text-sm">
                      <span className="text-[#6b7280]">Targeting cluster: </span>
                      <span className="font-semibold">{selectedCluster.name}</span>
                      <span className="text-[#6b7280]"> · Primary keyword: </span>
                      <span className="text-[#f59e0b] font-medium">{selectedCluster.keywords[0]}</span>
                    </p>
                  </div>
                )}

                <button
                  onClick={handleGenerateArticle}
                  disabled={articleLoading}
                  className="bg-[#f59e0b] hover:bg-[#d97706] disabled:opacity-60 disabled:cursor-not-allowed text-[#0a0a0a] font-bold text-sm px-8 py-3 rounded-[8px] transition-colors flex items-center gap-2"
                >
                  {articleLoading ? (
                    <>
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      {articleStage || "Generating…"}
                    </>
                  ) : "Generate Article →"}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── ARTICLES view ── */}
        {activeNav === "articles" && (
          <div className="max-w-6xl mx-auto px-8 py-8">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h1 className="text-2xl font-bold mb-1">Generated Article</h1>
                <p className="text-[#6b7280] text-sm">
                  {article ? `"${article.seoTitle}"` : "No article generated yet. Go to Keywords to get started."}
                </p>
              </div>
              {article && (
                <div className="flex gap-3">
                  <button
                    onClick={handleGenerateImages}
                    disabled={imagesLoading}
                    className="flex items-center gap-2 bg-[#111111] border border-[#1f1f1f] hover:border-[#f59e0b]/40 text-[#fafafa] text-sm font-medium px-4 py-2.5 rounded-[8px] transition-colors disabled:opacity-50"
                  >
                    {imagesLoading ? (
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4 text-[#f59e0b]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    )}
                    {imagesLoading ? "Generating…" : "Generate Images"}
                  </button>
                  <button
                    onClick={() => {
                      const text = `${article.seoTitle}\n\n${article.metaDescription}\n\n${article.article}`;
                      navigator.clipboard.writeText(text);
                    }}
                    className="flex items-center gap-2 bg-[#f59e0b] hover:bg-[#d97706] text-[#0a0a0a] font-semibold text-sm px-4 py-2.5 rounded-[8px] transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    Copy Article
                  </button>
                </div>
              )}
            </div>

            {!article && (
              <div className="bg-[#111111] border border-[#1f1f1f] rounded-[10px] p-16 text-center">
                <svg className="w-12 h-12 text-[#2a2a2a] mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <p className="text-[#6b7280] mb-4">No article generated yet</p>
                <button
                  onClick={() => setActiveNav("keywords")}
                  className="bg-[#f59e0b] text-[#0a0a0a] font-semibold text-sm px-6 py-2.5 rounded-[8px] hover:bg-[#d97706] transition-colors"
                >
                  Go to Keyword Research →
                </button>
              </div>
            )}

            {article && (
              <div className="flex gap-6">
                {/* Article content */}
                <div className="flex-1 min-w-0">
                  {/* SEO meta */}
                  <div className="bg-[#111111] border border-[#1f1f1f] rounded-[10px] p-5 mb-5">
                    <p className="text-[#6b7280] text-xs font-medium uppercase tracking-wide mb-1">SEO Title</p>
                    <p className="font-semibold text-[#fafafa] mb-4">{article.seoTitle}</p>
                    <p className="text-[#6b7280] text-xs font-medium uppercase tracking-wide mb-1">Meta Description</p>
                    <p className="text-[#6b7280] text-sm leading-relaxed">{article.metaDescription}</p>
                  </div>

                  {/* Research brief */}
                  {research && (
                    <div className="bg-[#111111] border border-[#1f1f1f] rounded-[10px] p-5 mb-5">
                      <p className="font-semibold text-sm mb-4 flex items-center gap-2">
                        <span className="w-2 h-2 bg-[#f59e0b] rounded-full" />
                        Research Brief
                      </p>
                      <div className="grid md:grid-cols-2 gap-4">
                        <div>
                          <p className="text-[#6b7280] text-xs uppercase tracking-wide font-medium mb-2">Questions Answered</p>
                          <ul className="space-y-1">
                            {research.questions.map((q, i) => (
                              <li key={i} className="text-sm text-[#6b7280] flex gap-2">
                                <span className="text-[#f59e0b] font-bold text-xs mt-0.5">Q</span> {q}
                              </li>
                            ))}
                          </ul>
                        </div>
                        <div>
                          <p className="text-[#6b7280] text-xs uppercase tracking-wide font-medium mb-2">Semantic Keywords</p>
                          <div className="flex flex-wrap gap-1.5">
                            {research.semanticKeywords.map((kw) => (
                              <span key={kw} className="bg-[#0a0a0a] border border-[#1f1f1f] rounded-[6px] px-2 py-0.5 text-[11px] text-[#6b7280]">
                                {kw}
                              </span>
                            ))}
                          </div>
                          <p className="text-[#6b7280] text-xs uppercase tracking-wide font-medium mb-2 mt-4">Content Gaps</p>
                          <ul className="space-y-1">
                            {research.contentGaps.map((g, i) => (
                              <li key={i} className="text-sm text-[#6b7280] flex gap-2">
                                <span className="text-[#22c55e] font-bold text-xs mt-0.5">✓</span> {g}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Full article */}
                  <div className="bg-[#111111] border border-[#1f1f1f] rounded-[10px] p-6">
                    <div
                      className="prose prose-sm prose-invert max-w-none text-[#6b7280] leading-7
                        [&_h1]:text-[#fafafa] [&_h1]:font-bold [&_h1]:text-xl [&_h1]:mb-4 [&_h1]:mt-6
                        [&_h2]:text-[#fafafa] [&_h2]:font-bold [&_h2]:text-lg [&_h2]:mb-3 [&_h2]:mt-6
                        [&_h3]:text-[#fafafa] [&_h3]:font-semibold [&_h3]:mb-2 [&_h3]:mt-4
                        [&_p]:mb-4 [&_p]:text-sm
                        [&_ul]:mb-4 [&_ul]:ml-4 [&_li]:text-sm [&_li]:mb-1
                        [&_strong]:text-[#fafafa]"
                      dangerouslySetInnerHTML={{ __html: article.article.replace(/\n/g, "<br/>") }}
                    />
                  </div>
                </div>

                {/* Scores sidebar */}
                <div className="w-56 flex-shrink-0 space-y-4">
                  <div className="bg-[#111111] border border-[#1f1f1f] rounded-[10px] p-4">
                    <p className="text-xs text-[#6b7280] uppercase tracking-wide font-medium mb-4">Content Scores</p>
                    <div className="grid grid-cols-2 gap-4">
                      <ScoreRing score={article.eeaScore} label="EEAT" color="#f59e0b" />
                      <ScoreRing score={article.readabilityScore} label="Readability" color="#22c55e" />
                    </div>
                    <div className="mt-4 pt-4 border-t border-[#1f1f1f] space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-[#6b7280] text-xs">Word Count</span>
                        <span className="text-[#fafafa] text-sm font-semibold">{article.wordCount.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-[#6b7280] text-xs">Keyword Density</span>
                        <span className={`text-sm font-semibold ${parseFloat(String(article.keywordDensity)) <= 1.5 ? "text-[#22c55e]" : "text-[#ef4444]"}`}>
                          {article.keywordDensity}{typeof article.keywordDensity === "number" ? "%" : ""}
                        </span>
                      </div>
                    </div>
                  </div>

                  {article.improvements.length > 0 && (
                    <div className="bg-[#111111] border border-[#1f1f1f] rounded-[10px] p-4">
                      <p className="text-xs text-[#6b7280] uppercase tracking-wide font-medium mb-3">Improvements</p>
                      <ul className="space-y-2">
                        {article.improvements.map((imp, i) => (
                          <li key={i} className="flex gap-2 text-[11px] text-[#6b7280] leading-relaxed">
                            <span className="text-[#f59e0b] font-bold flex-shrink-0 mt-0.5">→</span>
                            {imp}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── IMAGES view ── */}
        {activeNav === "images" && (
          <div className="max-w-6xl mx-auto px-8 py-8">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h1 className="text-2xl font-bold mb-1">Article Images</h1>
                <p className="text-[#6b7280] text-sm">AI-generated image suggestions for your article.</p>
              </div>
              {article && images.length === 0 && (
                <button
                  onClick={handleGenerateImages}
                  disabled={imagesLoading}
                  className="bg-[#f59e0b] hover:bg-[#d97706] text-[#0a0a0a] font-semibold text-sm px-5 py-2.5 rounded-[8px] transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {imagesLoading && (
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  )}
                  {imagesLoading ? "Generating…" : "Generate Images"}
                </button>
              )}
            </div>

            {images.length === 0 && !imagesLoading && (
              <div className="bg-[#111111] border border-[#1f1f1f] rounded-[10px] p-16 text-center">
                <svg className="w-12 h-12 text-[#2a2a2a] mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <p className="text-[#6b7280] mb-4">
                  {article ? "Generate images for your article" : "Generate an article first"}
                </p>
                {!article && (
                  <button
                    onClick={() => setActiveNav("keywords")}
                    className="bg-[#f59e0b] text-[#0a0a0a] font-semibold text-sm px-6 py-2.5 rounded-[8px] hover:bg-[#d97706] transition-colors"
                  >
                    Go to Keyword Research →
                  </button>
                )}
              </div>
            )}

            {images.length > 0 && (
              <div className="grid md:grid-cols-3 gap-5">
                {images.map((img) => (
                  <div key={img.id} className="bg-[#111111] border border-[#1f1f1f] rounded-[10px] overflow-hidden group">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={img.url}
                      alt={img.altText}
                      className="w-full aspect-video object-cover bg-[#0a0a0a]"
                      loading="lazy"
                    />
                    <div className="p-4">
                      <p className="text-[#6b7280] text-[10px] uppercase tracking-wide font-medium mb-1">{img.placement}</p>
                      <p className="text-sm font-medium mb-2">{img.caption}</p>
                      <p className="text-[#6b7280] text-xs leading-relaxed">Alt: {img.altText}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── SETTINGS view ── */}
        {activeNav === "settings" && (
          <div className="max-w-2xl mx-auto px-8 py-8">
            <h1 className="text-2xl font-bold mb-2">Account</h1>
            <p className="text-[#6b7280] text-sm mb-8">Manage your profile and subscription.</p>

            {/* Profile */}
            <div className="bg-[#111111] border border-[#1f1f1f] rounded-[10px] p-6 mb-5">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-[#6b7280] mb-5">Profile</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1.5">Display Name</label>
                  <input
                    type="text"
                    defaultValue="My Account"
                    className="w-full bg-[#0a0a0a] border border-[#1f1f1f] focus:border-[#f59e0b] outline-none rounded-[8px] px-3 py-2.5 text-sm text-[#fafafa] transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">Email</label>
                  <input
                    type="email"
                    defaultValue="user@example.com"
                    readOnly
                    className="w-full bg-[#0a0a0a] border border-[#1f1f1f] rounded-[8px] px-3 py-2.5 text-sm text-[#6b7280] cursor-not-allowed"
                  />
                </div>
              </div>
            </div>

            {/* Plan */}
            <div className="bg-[#111111] border border-[#1f1f1f] rounded-[10px] p-6 mb-5">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-[#6b7280] mb-5">Subscription</h2>
              <div className="flex items-center justify-between mb-6">
                <div>
                  <p className="text-sm font-medium mb-0.5">Current Plan</p>
                  <span className="inline-flex items-center gap-1.5 bg-[#f59e0b]/10 text-[#f59e0b] text-xs font-bold px-2.5 py-1 rounded-full uppercase tracking-wide">
                    Free
                  </span>
                </div>
                <button className="bg-[#f59e0b] hover:bg-[#d97706] text-[#0a0a0a] font-semibold text-sm px-5 py-2.5 rounded-[10px] transition-colors">
                  Upgrade Plan
                </button>
              </div>
              <div className="bg-[#0a0a0a] border border-[#1f1f1f] rounded-[8px] p-4 text-xs text-[#6b7280]">
                Upgrade to <span className="text-[#fafafa] font-medium">Starter £19/mo</span> for 50 keyword searches and 10 articles per month.
              </div>
            </div>

            {/* Usage */}
            <div className="bg-[#111111] border border-[#1f1f1f] rounded-[10px] p-6">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-[#6b7280] mb-5">Usage This Month</h2>
              <div className="space-y-5">
                {[
                  { label: "Keyword Searches", used: 1, limit: 1, unit: "searches/day" },
                  { label: "AI Articles", used: 0, limit: 1, unit: "article" },
                  { label: "AI Clusters", used: 0, limit: 1, unit: "cluster/day" },
                ].map(({ label, used, limit, unit }) => {
                  const pct = Math.min(100, Math.round((used / limit) * 100));
                  const barColor = pct >= 100 ? "#ef4444" : pct >= 75 ? "#f59e0b" : "#22c55e";
                  return (
                    <div key={label}>
                      <div className="flex justify-between items-center mb-1.5">
                        <span className="text-sm font-medium">{label}</span>
                        <span className="text-xs text-[#6b7280]">{used} / {limit} {unit}</span>
                      </div>
                      <div className="h-1.5 bg-[#0a0a0a] rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${pct}%`, backgroundColor: barColor }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="text-[#6b7280] text-xs mt-5">Usage resets daily at midnight UTC.</p>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}
