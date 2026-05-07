"use client";

import { useState, useRef, useEffect, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import type { NlpAnalysis } from "@/types";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Intent {
  type: string;
  confidence: number;
  explanation: string;
}

interface Eeat {
  experience: number;
  expertise: number;
  authoritativeness: number;
  trustworthiness: number;
}

interface SerpFeature {
  name: string;
  available: boolean;
  tip: string;
}

interface PassiveVoiceExample {
  original: string;
  suggested: string;
}

interface Readability {
  fleschKincaid: number;
  avgSentenceLength: number;
  passiveVoicePercent: number;
  tone: string;
}

interface Brief {
  recommendedH1: string;
  structure: { tag: string; text: string }[];
  wordCount: number;
  tone: string;
  targetAudience: string;
}

interface LsiTerm {
  term: string;
  frequency: string;
  status: string;
}

interface InternalLink {
  anchor: string;
  targetPage: string;
  relevance: number;
}

interface SemanticZone {
  score: number;
  verdict: string;
  recommendation: string;
}

interface NlpResults {
  intent: Intent;
  entities: string[];
  subtopics: string[];
  serpFeatures: SerpFeature[];
  eeat: Eeat;
  missingEntities: string[];
  topicalGaps: string[];
  coveredTopics: string[];
  passiveVoiceExamples: PassiveVoiceExample[];
  readability: Readability;
  brief: Brief;
  lsiTerms: LsiTerm[];
  schema: string;
  internalLinkSuggestions: InternalLink[];
  semanticSimilarityZone: SemanticZone;
  overallScore: number;
  message?: string;
}

interface DiscoveryOpportunity {
  problem: string;
  entities: string[];
  gapScore: number;
  volume: number;
  competition: string;
  intent: string;
  whyGapExists: string;
  region: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const LOCATIONS = [
  { label: "Global",        code: 0    },
  { label: "United Kingdom", code: 2826 },
  { label: "United States", code: 2840 },
  { label: "Australia",     code: 2036 },
  { label: "Canada",        code: 2124 },
  { label: "Germany",       code: 2276 },
  { label: "France",        code: 2250 },
  { label: "India",         code: 2356 },
  { label: "UAE",           code: 2784 },
  { label: "Saudi Arabia",  code: 2682 },
  { label: "Singapore",     code: 2702 },
  { label: "South Africa",  code: 2710 },
  { label: "Pakistan",      code: 2586 },
];

const LOCATION_TO_MARKET: Record<number, string> = {
  0:    "Global",
  2826: "UK",
  2840: "US",
  2036: "AU",
  2124: "CA",
  2276: "DE",
  2250: "FR",
  2356: "IN",
  2784: "AE",
  2682: "SA",
  2702: "SG",
  2710: "ZA",
  2586: "PK",
};

const REGION_TO_LOCATION: Record<string, number> = {
  Global: 0, UK: 2826, US: 2840, AU: 2036, CA: 2124,
  DE: 2276, FR: 2250, IN: 2356, AE: 2784, SA: 2682,
  SG: 2702, ZA: 2710, PK: 2586,
};

const TABS = ["Overview", "Entities", "Topics", "E-E-A-T", "Readability", "Brief"] as const;
type Tab = (typeof TABS)[number];

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
    <div className="flex items-center mb-6 bg-[#111111] border border-[#1f1f1f] rounded-[10px] px-5 py-3">
      {steps.map((s, i) => {
        const isDone = i < currentIndex;
        const isCurrent = i === currentIndex;
        return (
          <div key={s.id} className="flex items-center flex-1 last:flex-none">
            <div className={`flex items-center gap-1.5 text-xs font-medium whitespace-nowrap ${isCurrent ? "text-[#f59e0b]" : isDone ? "text-[#22c55e]" : "text-[#374151]"}`}>
              {isDone ? (
                <span className="w-4 h-4 rounded-full bg-[#22c55e]/20 flex items-center justify-center">
                  <svg className="w-2.5 h-2.5 text-[#22c55e]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                </span>
              ) : (
                <span className={`w-4 h-4 rounded-full flex items-center justify-center ${isCurrent ? "bg-[#f59e0b]/20" : "bg-[#1f1f1f]"}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${isCurrent ? "bg-[#f59e0b]" : "bg-[#374151]"}`} />
                </span>
              )}
              {s.label}
            </div>
            {i < steps.length - 1 && (
              <div className={`flex-1 h-px mx-3 ${isDone ? "bg-[#22c55e]/40" : "bg-[#1f1f1f]"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── ScoreRing ────────────────────────────────────────────────────────────────

function ScoreRing({ score, size = "md" }: { score: number; size?: "sm" | "md" | "lg" }) {
  const dims = { sm: 56, md: 80, lg: 100 };
  const strokes = { sm: 6, md: 8, lg: 10 };
  const d = dims[size];
  const sw = strokes[size];
  const r = (d - sw) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  const color = score >= 70 ? "#22c55e" : score >= 40 ? "#f59e0b" : "#ef4444";
  const fontSize = size === "lg" ? "text-xl" : size === "md" ? "text-base" : "text-xs";

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: d, height: d }}>
      <svg width={d} height={d} className="-rotate-90">
        <circle cx={d / 2} cy={d / 2} r={r} fill="none" stroke="#1f1f1f" strokeWidth={sw} />
        <circle
          cx={d / 2} cy={d / 2} r={r} fill="none"
          stroke={color} strokeWidth={sw}
          strokeDasharray={circ} strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.6s ease" }}
        />
      </svg>
      <span className={`absolute font-bold ${fontSize}`} style={{ color }}>
        {score}
      </span>
    </div>
  );
}

// ─── ScoreBar ─────────────────────────────────────────────────────────────────

function ScoreBar({ label, value }: { label: string; value: number }) {
  const color = value >= 70 ? "#22c55e" : value >= 40 ? "#f59e0b" : "#ef4444";
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="text-[#9ca3af]">{label}</span>
        <span className="font-semibold" style={{ color }}>{value}</span>
      </div>
      <div className="h-1.5 bg-[#1f1f1f] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${value}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

// ─── Sidebar Nav ─────────────────────────────────────────────────────────────

function SidebarNav({ onSignOut }: { onSignOut: () => void }) {
  const items = [
    { href: "/dashboard",           label: "Keywords",    icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg> },
    { href: "/dashboard",           label: "Articles",    icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg> },
    { href: "/dashboard/discovery", label: "Discovery",   icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg> },
    { href: "/dashboard/nlp",       label: "NLP Analyser", icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg> },
  ];

  return (
    <aside className="w-56 flex-shrink-0 bg-[#0a0a0a] border-r border-[#1f1f1f] flex flex-col">
      <div className="p-4 border-b border-[#1f1f1f]">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="w-7 h-7 bg-[#f59e0b] rounded-[6px] flex items-center justify-center">
            <span className="text-[#0a0a0a] font-extrabold text-xs">S</span>
          </div>
          <span className="font-bold text-base tracking-tight text-[#fafafa]">Seoranko</span>
        </Link>
      </div>
      <nav className="flex-1 p-3 space-y-0.5">
        {items.map(({ href, label, icon }) => {
          const active = label === "NLP Analyser";
          return (
            <Link
              key={label}
              href={href}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-[8px] text-sm font-medium transition-colors ${
                active ? "bg-[#f59e0b]/10 text-[#f59e0b]" : "text-[#6b7280] hover:text-[#fafafa] hover:bg-[#111111]"
              }`}
            >
              {icon}{label}
            </Link>
          );
        })}
      </nav>
      <div className="p-3 border-t border-[#1f1f1f]">
        <button
          onClick={onSignOut}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-[8px] text-sm font-medium text-[#6b7280] hover:text-[#fafafa] hover:bg-[#111111] transition-colors"
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

// ─── Main inner component (uses useSearchParams) ──────────────────────────────

function NlpPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialKeyword = searchParams.get("keyword") ?? "";
  const initialLocation = parseInt(searchParams.get("location_code") ?? "0") || 0;
  const fromDiscoveryParam = searchParams.get("from") === "discovery";
  const regionParam = searchParams.get("region") ?? "Global";

  const [keyword, setKeyword] = useState(initialKeyword);
  const [draft, setDraft] = useState("");
  const [showDraft, setShowDraft] = useState(false);
  const [locationCode, setLocationCode] = useState(() => {
    if (initialLocation) return initialLocation;
    if (fromDiscoveryParam && regionParam) return REGION_TO_LOCATION[regionParam] ?? 0;
    return 0;
  });
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");
  const [results, setResults] = useState<NlpResults | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("Overview");
  const [copied, setCopied] = useState(false);
  const [fromDiscovery, setFromDiscovery] = useState(false);
  const [discoveryOpportunity, setDiscoveryOpportunity] = useState<DiscoveryOpportunity | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);

  useEffect(() => {
    return () => { readerRef.current?.cancel(); };
  }, []);

  useEffect(() => {
    if (fromDiscoveryParam) {
      setFromDiscovery(true);
      try {
        const stored = localStorage.getItem("discovery_opportunity");
        if (stored) setDiscoveryOpportunity(JSON.parse(stored) as DiscoveryOpportunity);
      } catch { /* ignore */ }
    }
    if (initialKeyword.trim()) {
      runAnalysis(initialKeyword.trim(), locationCode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  function clearPipeline() {
    localStorage.removeItem("discovery_opportunity");
    localStorage.removeItem("nlp_analysis");
    localStorage.removeItem("article_brief");
    setFromDiscovery(false);
    setDiscoveryOpportunity(null);
  }

  async function runAnalysis(kw: string, locCode?: number) {
    if (!kw.trim()) return;

    readerRef.current?.cancel();
    setLoading(true);
    setError("");
    setResults(null);
    setStage("Starting analysis…");

    const effectiveLocation = locCode ?? locationCode;

    try {
      const body: Record<string, unknown> = { keyword: kw.trim() };
      if (draft.trim()) body.draft = draft.trim();
      if (effectiveLocation) body.location_code = effectiveLocation;

      const res = await fetch("/api/nlp/analyse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok || !res.body) {
        const errData = await res.json().catch(() => ({}));
        setError((errData as { error?: string }).error ?? "Analysis failed");
        setLoading(false);
        return;
      }

      const reader = res.body.getReader();
      readerRef.current = reader;
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.replace(/^data: /, "").trim();
          if (!line) continue;
          try {
            const msg = JSON.parse(line) as {
              stage?: string;
              done?: boolean;
              results?: NlpResults;
              error?: string;
            };
            if (msg.error) { setError(msg.error); setLoading(false); return; }
            if (msg.stage) setStage(msg.stage);
            if (msg.done && msg.results) {
              setResults(msg.results);
              setLoading(false);
              setStage("");
            }
          } catch { /* skip malformed */ }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setLoading(false);
    }
  }

  function handleAnalyse(e: React.FormEvent) {
    e.preventDefault();
    runAnalysis(keyword);
  }

  function copySchema() {
    if (!results?.schema) return;
    navigator.clipboard.writeText(results.schema).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleResearchKeywords() {
    if (!results) return;
    const targetMarket = LOCATION_TO_MARKET[locationCode] ?? "Global";
    const analysis: NlpAnalysis = {
      keyword:        keyword,
      recommendedH1:  results.brief?.recommendedH1 ?? keyword,
      intent:         results.intent ?? { type: "informational", confidence: 50, explanation: "" },
      entities:       results.entities ?? [],
      missingEntities: results.missingEntities ?? [],
      subtopics:      results.subtopics ?? [],
      topicalGaps:    results.topicalGaps ?? [],
      lsiTerms:       results.lsiTerms ?? [],
      brief:          results.brief ?? { recommendedH1: keyword, structure: [], wordCount: 1500, tone: "professional", targetAudience: "general" },
      overallScore:   results.overallScore,
      location_code:  locationCode,
      targetMarket,
    };
    localStorage.setItem("nlp_analysis", JSON.stringify(analysis));
    router.push(`/dashboard?from=nlp&keyword=${encodeURIComponent(keyword)}`);
  }

  return (
    <div className="flex h-screen bg-[#0a0a0a]" style={{ fontFamily: "'Outfit', sans-serif" }}>
      <SidebarNav onSignOut={handleSignOut} />

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto p-6 space-y-6">

          {/* Header */}
          <div>
            <h1 className="text-2xl font-bold text-[#fafafa]">NLP Analyser</h1>
            <p className="text-[#6b7280] text-sm mt-1">
              SERP analysis, E-E-A-T scoring, content gaps, and brief generation
            </p>
          </div>

          {/* Pipeline bar (only when from discovery) */}
          {fromDiscovery && <PipelineBar step="nlp" />}

          {/* Discovery banner */}
          {fromDiscovery && discoveryOpportunity && (
            <div className="bg-[#22c55e]/5 border border-[#22c55e]/20 rounded-[10px] px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="w-2 h-2 rounded-full bg-[#22c55e]" />
                    <p className="text-xs font-semibold text-[#22c55e] uppercase tracking-wide">From Discovery Engine</p>
                  </div>
                  <p className="text-sm font-medium text-[#fafafa] mb-2">{discoveryOpportunity.problem}</p>
                  <div className="flex flex-wrap gap-3 text-xs text-[#6b7280]">
                    <span>Gap Score: <span className="text-[#f59e0b] font-semibold">{discoveryOpportunity.gapScore}/100</span></span>
                    <span>Volume: <span className="text-[#fafafa] font-medium">{discoveryOpportunity.volume.toLocaleString()}/mo</span></span>
                    <span>Competition: <span className="text-[#fafafa] font-medium">{discoveryOpportunity.competition}</span></span>
                    <span>Market: <span className="text-[#fafafa] font-medium">{discoveryOpportunity.region}</span></span>
                  </div>
                </div>
                <button
                  onClick={clearPipeline}
                  className="text-[#6b7280] hover:text-[#ef4444] transition-colors flex-shrink-0"
                  title="Clear pipeline"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          )}

          {/* Input form */}
          <form onSubmit={handleAnalyse} className="bg-[#111111] border border-[#1f1f1f] rounded-[12px] p-5 space-y-4">
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-xs font-medium text-[#9ca3af] mb-1.5 uppercase tracking-wide">Keyword</label>
                <input
                  type="text"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="e.g. best protein powder UK"
                  required
                  className="w-full bg-[#0a0a0a] border border-[#1f1f1f] rounded-[8px] px-4 py-2.5 text-sm text-[#fafafa] placeholder-[#4b5563] focus:outline-none focus:border-[#f59e0b]/50 transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#9ca3af] mb-1.5 uppercase tracking-wide">Location</label>
                <select
                  value={locationCode}
                  onChange={(e) => setLocationCode(Number(e.target.value))}
                  className="bg-[#0a0a0a] border border-[#1f1f1f] rounded-[8px] px-3 py-2.5 text-sm text-[#fafafa] focus:outline-none focus:border-[#f59e0b]/50 transition-colors"
                >
                  {LOCATIONS.map((l) => (
                    <option key={l.code} value={l.code}>{l.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Draft toggle */}
            <div>
              <button
                type="button"
                onClick={() => setShowDraft(!showDraft)}
                className="flex items-center gap-2 text-xs text-[#6b7280] hover:text-[#f59e0b] transition-colors"
              >
                <svg className={`w-3.5 h-3.5 transition-transform ${showDraft ? "rotate-90" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                {showDraft ? "Hide" : "Add"} draft content for E-E-A-T scoring
              </button>
              {showDraft && (
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Paste your draft article here for full E-E-A-T and readability analysis…"
                  rows={6}
                  className="mt-2 w-full bg-[#0a0a0a] border border-[#1f1f1f] rounded-[8px] px-4 py-3 text-sm text-[#fafafa] placeholder-[#4b5563] focus:outline-none focus:border-[#f59e0b]/50 transition-colors resize-none"
                />
              )}
            </div>

            <div className="flex items-center justify-between">
              <button
                type="submit"
                disabled={loading || !keyword.trim()}
                className="bg-[#f59e0b] hover:bg-[#d97706] disabled:opacity-50 disabled:cursor-not-allowed text-[#0a0a0a] font-bold text-sm px-6 py-2.5 rounded-[8px] transition-colors flex items-center gap-2"
              >
                {loading && (
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                )}
                {loading ? "Analysing…" : "Analyse"}
              </button>
              {loading && stage && (
                <span className="text-xs text-[#6b7280] animate-pulse">{stage}</span>
              )}
            </div>
          </form>

          {/* Error */}
          {error && (
            <div className="bg-[#ef4444]/10 border border-[#ef4444]/20 rounded-[10px] px-4 py-3">
              <p className="text-[#ef4444] text-sm">{error}</p>
            </div>
          )}

          {/* Loading skeleton */}
          {loading && !results && (
            <div className="bg-[#111111] border border-[#1f1f1f] rounded-[12px] p-8 flex flex-col items-center gap-4">
              <div className="w-16 h-16 rounded-full border-4 border-[#1f1f1f] border-t-[#f59e0b] animate-spin" />
              <div className="text-center space-y-1">
                <p className="text-[#fafafa] font-medium text-sm">{stage || "Running analysis…"}</p>
                <p className="text-[#4b5563] text-xs">This may take 15–30 seconds</p>
              </div>
            </div>
          )}

          {/* Results */}
          {results && (
            <div className="space-y-4">

              {/* Pipeline CTA — shown when from discovery */}
              {fromDiscovery && (
                <button
                  onClick={handleResearchKeywords}
                  className="w-full flex items-center justify-between bg-[#f59e0b] hover:bg-[#d97706] text-[#0a0a0a] font-bold text-sm px-5 py-3.5 rounded-[10px] transition-colors"
                >
                  <span>→ Research Keywords with Full Pipeline Data</span>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                  </svg>
                </button>
              )}

              {/* Score summary bar */}
              <div className="bg-[#111111] border border-[#1f1f1f] rounded-[12px] p-5 flex items-center gap-6">
                <div className="flex flex-col items-center gap-1">
                  <ScoreRing score={results.overallScore} size="lg" />
                  <span className="text-xs text-[#6b7280]">Overall Score</span>
                </div>
                <div className="flex-1 grid grid-cols-2 gap-x-6 gap-y-3">
                  <div>
                    <p className="text-xs text-[#6b7280] mb-0.5">Intent</p>
                    <span className="text-sm font-semibold text-[#f59e0b] capitalize">{results.intent?.type}</span>
                    <span className="text-xs text-[#4b5563] ml-2">({results.intent?.confidence}% confidence)</span>
                  </div>
                  <div>
                    <p className="text-xs text-[#6b7280] mb-0.5">Entities found</p>
                    <span className="text-sm font-semibold text-[#fafafa]">{results.entities?.length ?? 0}</span>
                  </div>
                  <div>
                    <p className="text-xs text-[#6b7280] mb-0.5">Topical gaps</p>
                    <span className="text-sm font-semibold text-[#fafafa]">{results.topicalGaps?.length ?? 0}</span>
                  </div>
                  <div>
                    <p className="text-xs text-[#6b7280] mb-0.5">Semantic zone</p>
                    <span className="text-sm font-semibold text-[#fafafa]">{results.semanticSimilarityZone?.verdict ?? "N/A"}</span>
                  </div>
                </div>
              </div>

              {/* Tabs */}
              <div className="border-b border-[#1f1f1f] flex gap-1">
                {TABS.map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
                      activeTab === tab
                        ? "text-[#f59e0b] border-[#f59e0b]"
                        : "text-[#6b7280] border-transparent hover:text-[#fafafa]"
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div className="bg-[#111111] border border-[#1f1f1f] rounded-[12px] p-5">

                {/* Overview */}
                {activeTab === "Overview" && (
                  <div className="space-y-5">
                    <div>
                      <h3 className="text-sm font-semibold text-[#fafafa] mb-2">Search Intent</h3>
                      <p className="text-sm text-[#9ca3af]">{results.intent?.explanation}</p>
                    </div>
                    {results.serpFeatures?.length > 0 && (
                      <div>
                        <h3 className="text-sm font-semibold text-[#fafafa] mb-3">SERP Features</h3>
                        <div className="grid grid-cols-2 gap-2">
                          {results.serpFeatures.map((f, i) => (
                            <div key={i} className={`flex items-start gap-2 p-3 rounded-[8px] border ${f.available ? "border-[#22c55e]/20 bg-[#22c55e]/5" : "border-[#1f1f1f] bg-[#0a0a0a]"}`}>
                              <span className={`mt-0.5 w-3 h-3 rounded-full flex-shrink-0 ${f.available ? "bg-[#22c55e]" : "bg-[#374151]"}`} />
                              <div>
                                <p className="text-xs font-medium text-[#fafafa]">{f.name}</p>
                                <p className="text-xs text-[#6b7280] mt-0.5">{f.tip}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {results.semanticSimilarityZone && (
                      <div>
                        <h3 className="text-sm font-semibold text-[#fafafa] mb-2">Semantic Similarity</h3>
                        <div className="flex items-center gap-4 p-4 bg-[#0a0a0a] rounded-[8px] border border-[#1f1f1f]">
                          <ScoreRing score={results.semanticSimilarityZone.score} size="sm" />
                          <div>
                            <p className="text-sm font-semibold text-[#fafafa]">{results.semanticSimilarityZone.verdict}</p>
                            <p className="text-xs text-[#6b7280] mt-0.5">{results.semanticSimilarityZone.recommendation}</p>
                          </div>
                        </div>
                      </div>
                    )}
                    {results.message && (
                      <div className="p-3 bg-[#f59e0b]/5 border border-[#f59e0b]/20 rounded-[8px]">
                        <p className="text-xs text-[#f59e0b]">{results.message}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Entities */}
                {activeTab === "Entities" && (
                  <div className="space-y-5">
                    {results.entities?.length > 0 && (
                      <div>
                        <h3 className="text-sm font-semibold text-[#fafafa] mb-3">
                          Competitor Entities <span className="text-[#4b5563] font-normal">({results.entities.length})</span>
                        </h3>
                        <div className="flex flex-wrap gap-2">
                          {results.entities.map((e, i) => (
                            <span key={i} className="px-2.5 py-1 bg-[#0a0a0a] border border-[#1f1f1f] rounded-[6px] text-xs text-[#9ca3af]">{e}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {results.missingEntities?.length > 0 && (
                      <div>
                        <h3 className="text-sm font-semibold text-[#fafafa] mb-3">
                          Missing from Your Draft <span className="text-[#ef4444]/70 font-normal">({results.missingEntities.length})</span>
                        </h3>
                        <div className="flex flex-wrap gap-2">
                          {results.missingEntities.map((e, i) => (
                            <span key={i} className="px-2.5 py-1 bg-[#ef4444]/5 border border-[#ef4444]/20 rounded-[6px] text-xs text-[#ef4444]">{e}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {results.internalLinkSuggestions?.length > 0 && (
                      <div>
                        <h3 className="text-sm font-semibold text-[#fafafa] mb-3">Internal Link Suggestions</h3>
                        <div className="space-y-2">
                          {results.internalLinkSuggestions.map((l, i) => (
                            <div key={i} className="flex items-center justify-between p-3 bg-[#0a0a0a] border border-[#1f1f1f] rounded-[8px]">
                              <div>
                                <p className="text-xs font-medium text-[#f59e0b]">{l.anchor}</p>
                                <p className="text-xs text-[#6b7280] mt-0.5">{l.targetPage}</p>
                              </div>
                              <span className="text-xs text-[#4b5563]">Relevance: {l.relevance}%</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Topics */}
                {activeTab === "Topics" && (
                  <div className="space-y-5">
                    {results.subtopics?.length > 0 && (
                      <div>
                        <h3 className="text-sm font-semibold text-[#fafafa] mb-3">
                          Competitor Subtopics <span className="text-[#4b5563] font-normal">({results.subtopics.length})</span>
                        </h3>
                        <div className="flex flex-wrap gap-2">
                          {results.subtopics.map((t, i) => (
                            <span key={i} className="px-2.5 py-1 bg-[#0a0a0a] border border-[#1f1f1f] rounded-[6px] text-xs text-[#9ca3af]">{t}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {results.coveredTopics?.length > 0 && (
                      <div>
                        <h3 className="text-sm font-semibold text-[#fafafa] mb-3">
                          Covered in Draft <span className="text-[#22c55e]/70 font-normal">({results.coveredTopics.length})</span>
                        </h3>
                        <div className="flex flex-wrap gap-2">
                          {results.coveredTopics.map((t, i) => (
                            <span key={i} className="px-2.5 py-1 bg-[#22c55e]/5 border border-[#22c55e]/20 rounded-[6px] text-xs text-[#22c55e]">{t}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {results.topicalGaps?.length > 0 && (
                      <div>
                        <h3 className="text-sm font-semibold text-[#fafafa] mb-3">
                          Topical Gaps <span className="text-[#ef4444]/70 font-normal">({results.topicalGaps.length})</span>
                        </h3>
                        <div className="flex flex-wrap gap-2">
                          {results.topicalGaps.map((t, i) => (
                            <span key={i} className="px-2.5 py-1 bg-[#ef4444]/5 border border-[#ef4444]/20 rounded-[6px] text-xs text-[#ef4444]">{t}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {results.lsiTerms?.length > 0 && (
                      <div>
                        <h3 className="text-sm font-semibold text-[#fafafa] mb-3">LSI Terms</h3>
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-left border-b border-[#1f1f1f]">
                              <th className="pb-2 text-[#6b7280] font-medium">Term</th>
                              <th className="pb-2 text-[#6b7280] font-medium">Frequency</th>
                              <th className="pb-2 text-[#6b7280] font-medium">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {results.lsiTerms.map((t, i) => (
                              <tr key={i} className="border-b border-[#0f0f0f]">
                                <td className="py-2 text-[#9ca3af]">{t.term}</td>
                                <td className="py-2 text-[#6b7280]">{t.frequency}</td>
                                <td className="py-2">
                                  <span className={`px-2 py-0.5 rounded-[4px] ${
                                    t.status === "present" || t.status === "covered"
                                      ? "bg-[#22c55e]/10 text-[#22c55e]"
                                      : "bg-[#ef4444]/10 text-[#ef4444]"
                                  }`}>{t.status}</span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {/* E-E-A-T */}
                {activeTab === "E-E-A-T" && (
                  <div className="space-y-5">
                    <div className="grid grid-cols-2 gap-4">
                      {(["experience", "expertise", "authoritativeness", "trustworthiness"] as (keyof Eeat)[]).map((key) => (
                        <div key={key} className="flex items-center gap-4 p-4 bg-[#0a0a0a] rounded-[8px] border border-[#1f1f1f]">
                          <ScoreRing score={results.eeat?.[key] ?? 0} size="sm" />
                          <div>
                            <p className="text-sm font-medium text-[#fafafa] capitalize">{key}</p>
                            <p className="text-xs text-[#6b7280] mt-0.5">
                              {results.eeat?.[key] >= 70 ? "Strong" : results.eeat?.[key] >= 40 ? "Moderate" : "Needs work"}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                    {!draft.trim() && (
                      <div className="p-3 bg-[#f59e0b]/5 border border-[#f59e0b]/20 rounded-[8px]">
                        <p className="text-xs text-[#f59e0b]">Add draft content above to get your personal E-E-A-T scores instead of competitor benchmarks.</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Readability */}
                {activeTab === "Readability" && (
                  <div className="space-y-5">
                    {results.readability && (
                      <>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="p-4 bg-[#0a0a0a] rounded-[8px] border border-[#1f1f1f]">
                            <p className="text-xs text-[#6b7280] mb-1">Flesch-Kincaid Grade</p>
                            <p className="text-2xl font-bold text-[#fafafa]">{results.readability.fleschKincaid}</p>
                          </div>
                          <div className="p-4 bg-[#0a0a0a] rounded-[8px] border border-[#1f1f1f]">
                            <p className="text-xs text-[#6b7280] mb-1">Avg Sentence Length</p>
                            <p className="text-2xl font-bold text-[#fafafa]">{results.readability.avgSentenceLength} <span className="text-sm font-normal text-[#6b7280]">words</span></p>
                          </div>
                          <div className="p-4 bg-[#0a0a0a] rounded-[8px] border border-[#1f1f1f]">
                            <p className="text-xs text-[#6b7280] mb-1">Passive Voice</p>
                            <p className="text-2xl font-bold text-[#fafafa]">{results.readability.passiveVoicePercent}<span className="text-sm font-normal text-[#6b7280]">%</span></p>
                          </div>
                          <div className="p-4 bg-[#0a0a0a] rounded-[8px] border border-[#1f1f1f]">
                            <p className="text-xs text-[#6b7280] mb-1">Tone</p>
                            <p className="text-lg font-semibold text-[#fafafa] capitalize">{results.readability.tone}</p>
                          </div>
                        </div>
                        {results.passiveVoiceExamples?.length > 0 && (
                          <div>
                            <h3 className="text-sm font-semibold text-[#fafafa] mb-3">Passive Voice Examples</h3>
                            <div className="space-y-2">
                              {results.passiveVoiceExamples.map((ex, i) => (
                                <div key={i} className="p-3 bg-[#0a0a0a] rounded-[8px] border border-[#1f1f1f] space-y-1.5">
                                  <p className="text-xs text-[#ef4444]">Before: <span className="text-[#9ca3af]">{ex.original}</span></p>
                                  <p className="text-xs text-[#22c55e]">After: <span className="text-[#9ca3af]">{ex.suggested}</span></p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                    {!draft.trim() && (
                      <div className="p-3 bg-[#f59e0b]/5 border border-[#f59e0b]/20 rounded-[8px]">
                        <p className="text-xs text-[#f59e0b]">Add draft content above to get readability scores for your article.</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Brief */}
                {activeTab === "Brief" && results.brief && (
                  <div className="space-y-5">
                    {/* Write Article CTA (legacy — direct flow) */}
                    {!fromDiscovery && (
                      <button
                        onClick={() => {
                          const payload = {
                            recommendedH1: results.brief.recommendedH1,
                            structure:     results.brief.structure,
                            wordCount:     results.brief.wordCount,
                            tone:          results.brief.tone,
                            entities:      results.entities ?? [],
                            lsiTerms:      results.lsiTerms ?? [],
                            topicalGaps:   results.topicalGaps ?? [],
                            intent:        results.intent?.type ?? "informational",
                            serpFeatures:  results.serpFeatures ?? [],
                          };
                          localStorage.setItem("nlp_brief_data", JSON.stringify(payload));
                          router.push(`/dashboard?from=nlp&keyword=${encodeURIComponent(results.brief.recommendedH1)}`);
                        }}
                        className="flex items-center justify-between w-full bg-[#f59e0b] hover:bg-[#d97706] text-[#0a0a0a] font-bold text-sm px-5 py-3 rounded-[10px] transition-colors"
                      >
                        <span>Write This Article →</span>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                        </svg>
                      </button>
                    )}

                    <div className="p-4 bg-[#0a0a0a] rounded-[8px] border border-[#1f1f1f] space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-[#6b7280]">Recommended H1</p>
                        <span className="text-xs text-[#4b5563]">{results.brief.wordCount} words · {results.brief.tone} · {results.brief.targetAudience}</span>
                      </div>
                      <p className="text-sm font-semibold text-[#fafafa]">{results.brief.recommendedH1}</p>
                    </div>

                    {results.brief.structure?.length > 0 && (
                      <div>
                        <h3 className="text-sm font-semibold text-[#fafafa] mb-3">Article Structure</h3>
                        <div className="space-y-1">
                          {results.brief.structure.map((s, i) => (
                            <div key={i} className={`flex items-center gap-2 py-1.5 px-3 rounded-[6px] ${s.tag === "H2" ? "bg-[#0a0a0a] border border-[#1f1f1f]" : "pl-6"}`}>
                              <span className={`text-xs font-mono font-bold ${s.tag === "H2" ? "text-[#f59e0b]" : "text-[#4b5563]"}`}>{s.tag}</span>
                              <span className="text-sm text-[#9ca3af]">{s.text}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {results.schema && (
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <h3 className="text-sm font-semibold text-[#fafafa]">JSON-LD Schema</h3>
                          <button
                            onClick={copySchema}
                            className="text-xs text-[#f59e0b] hover:text-[#d97706] transition-colors flex items-center gap-1"
                          >
                            {copied ? (
                              <><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg> Copied</>
                            ) : (
                              <><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg> Copy</>
                            )}
                          </button>
                        </div>
                        <pre className="bg-[#0a0a0a] border border-[#1f1f1f] rounded-[8px] p-4 text-xs text-[#9ca3af] overflow-x-auto whitespace-pre-wrap break-all">
                          {results.schema}
                        </pre>
                      </div>
                    )}

                    {results.lsiTerms?.length > 0 && (
                      <div>
                        <h3 className="text-sm font-semibold text-[#fafafa] mb-3">
                          LSI / Secondary Keywords <span className="text-[#4b5563] font-normal">({results.lsiTerms.length})</span>
                        </h3>
                        <div className="flex flex-wrap gap-2">
                          {results.lsiTerms.map((t, i) => (
                            <span key={i} className={`px-2.5 py-1 rounded-[6px] text-xs border ${
                              t.status === "present" || t.status === "covered"
                                ? "bg-[#22c55e]/5 border-[#22c55e]/20 text-[#22c55e]"
                                : "bg-[#0a0a0a] border-[#1f1f1f] text-[#9ca3af]"
                            }`}>{t.term}</span>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-3">
                      <ScoreBar label="Overall Score" value={results.overallScore} />
                      <ScoreBar label="Semantic Similarity" value={results.semanticSimilarityZone?.score ?? 0} />
                    </div>
                  </div>
                )}

              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

// ─── Page export (wrapped in Suspense for useSearchParams) ────────────────────

export default function NlpPage() {
  return (
    <Suspense fallback={
      <div className="flex h-screen bg-[#0a0a0a] items-center justify-center" style={{ fontFamily: "'Outfit', sans-serif" }}>
        <div className="w-8 h-8 rounded-full border-2 border-[#1f1f1f] border-t-[#f59e0b] animate-spin" />
      </div>
    }>
      <NlpPageInner />
    </Suspense>
  );
}
