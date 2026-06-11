"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type {
  KeywordResult,
  Cluster,
  ArticleOutput,
  ResearchBrief,
  ImagePrompt,
  Country,
  Tone,
  NlpBrief,
  NlpAnalysis,
  PipelineData,
} from "@/types";

interface UserProfile {
  id: string;
  email: string;
  name: string;
  plan: "free" | "starter" | "pro" | "agency";
  keywords_used_today: number;
  articles_used_today: number;
  keywords_used_month: number;
  articles_used_month: number;
}

const PLAN_USAGE = {
  free:    { label: "Free",    keywords: 5,        articles: 1,        kPeriod: "day",      aPeriod: "lifetime" },
  starter: { label: "Starter", keywords: 500,       articles: 30,       kPeriod: "month",    aPeriod: "month"    },
  pro:     { label: "Pro",     keywords: 2000,      articles: 100,      kPeriod: "month",    aPeriod: "month"    },
  agency:  { label: "Agency",  keywords: Infinity,  articles: Infinity, kPeriod: "month",    aPeriod: "month"    },
};

const COUNTRY_LOCATION_CODES: Record<string, number> = {
  Global: 0,  UK: 2826, US: 2840, AU: 2036, CA: 2124,
  DE: 2276,   FR: 2250, IN: 2356, AE: 2784, SA: 2682,
  SG: 2702,   ZA: 2710, PK: 2586,
};

const ALL_COUNTRIES: { value: Country; label: string }[] = [
  { value: "Global", label: "Global"         },
  { value: "US",     label: "United States"  },
  { value: "UK",     label: "United Kingdom" },
  { value: "AU",     label: "Australia"      },
  { value: "CA",     label: "Canada"         },
  { value: "IN",     label: "India"          },
  { value: "AE",     label: "UAE"            },
  { value: "SA",     label: "Saudi Arabia"   },
  { value: "SG",     label: "Singapore"      },
  { value: "DE",     label: "Germany"        },
  { value: "FR",     label: "France"         },
  { value: "ZA",     label: "South Africa"   },
  { value: "PK",     label: "Pakistan"       },
];

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
            <div className={`flex items-center gap-1.5 text-xs font-medium whitespace-nowrap ${isCurrent ? "text-[#FF6B2C]" : isDone ? "text-[#22c55e]" : "text-[#374151]"}`}>
              {isDone ? (
                <span className="w-4 h-4 rounded-full bg-[#22c55e]/20 flex items-center justify-center">
                  <svg className="w-2.5 h-2.5 text-[#22c55e]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                </span>
              ) : (
                <span className={`w-4 h-4 rounded-full flex items-center justify-center ${isCurrent ? "bg-[#FF6B2C]/20" : "bg-[#F5F4F1]"}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${isCurrent ? "bg-[#FF6B2C]" : "bg-[#374151]"}`} />
                </span>
              )}
              {s.label}
            </div>
            {i < steps.length - 1 && (
              <div className={`flex-1 h-px mx-3 ${isDone ? "bg-[#22c55e]/40" : "bg-[#F5F4F1]"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Sidebar ────────────────────────────────────────────────────────────────

type NavItem = { id: string; label: string; icon: React.ReactNode; href?: string };

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
    id: "improve",
    label: "Improve Article",
    href: "/dashboard/improve",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21.75 6.75a4.5 4.5 0 01-4.884 4.484c-1.076-.091-2.264.071-2.95.904l-7.152 8.684a2.548 2.548 0 11-3.586-3.586l8.684-7.152c.833-.686.995-1.874.904-2.95a4.5 4.5 0 016.336-4.486l-3.276 3.276a3.004 3.004 0 002.25 2.25l3.276-3.276c.256.565.398 1.192.398 1.852z" />
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
    id: "discovery",
    label: "Discovery",
    href: "/dashboard/discovery",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
      </svg>
    ),
  },
  {
    id: "nlp",
    label: "NLP Analyser",
    href: "/dashboard/nlp",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
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
    kd <= 55 ? "text-[#FF6B2C] bg-[#FF6B2C]/10" :
               "text-[#ef4444] bg-[#ef4444]/10";
  return (
    <span className={`inline-block px-2 py-0.5 rounded-[6px] text-xs font-semibold ${color}`}>
      {kd}
    </span>
  );
}

// ─── Sparkline ──────────────────────────────────────────────────────────────

function Sparkline({ data }: { data: number[] }) {
  if (!data || data.length < 2) return <span className="text-[#6B6B6B] text-xs">—</span>;
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
  const displayScore = score < 15 ? score * 10 : score;
  const r = 28;
  const circ = 2 * Math.PI * r;
  const offset = circ - (displayScore / 100) * circ;
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
        <span className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xs font-bold text-[#0F0F0F] leading-none">{displayScore}</span>
          <span className="text-[8px] text-[#6B6B6B] leading-none">/100</span>
        </span>
      </div>
      <span className="text-[10px] text-[#6B6B6B] text-center leading-tight">{label}</span>
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
    <span className={`inline-block px-2 py-0.5 rounded-[6px] text-xs font-medium capitalize ${INTENT_STYLES[intent] ?? "bg-[#F5F4F1] text-[#6B6B6B]"}`}>
      {intent}
    </span>
  );
}

// ─── Main Dashboard ──────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [activeNav, setActiveNav] = useState("keywords");
  const [nlpBrief, setNlpBrief] = useState<NlpBrief | null>(null);

  // Pipeline state
  const [fromNlp, setFromNlp] = useState(false);
  const [nlpAnalysis, setNlpAnalysis] = useState<NlpAnalysis | null>(null);
  const [fromPipeline, setFromPipeline] = useState(false);
  const [pipelineData, setPipelineData] = useState<PipelineData | null>(null);

  // Auth state
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);

  async function refreshUserProfile() {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from("user_profiles")
      .select("*")
      .eq("id", user.id)
      .single();
    if (data) setUserProfile(data as UserProfile);
  }

  // Keyword state
  const [seedKeyword, setSeedKeyword] = useState("");
  const [country, setCountry] = useState<Country>("Global");
  const [keywords, setKeywords] = useState<KeywordResult[]>([]);
  const [kwLoading, setKwLoading] = useState(false);
  const [kwError, setKwError] = useState("");
  const [kwBroaderNotice, setKwBroaderNotice] = useState("");
  const [selectedKws, setSelectedKws] = useState<Set<string>>(new Set());
  const [minVolume, setMinVolume] = useState(500);
  const [hideNavigational, setHideNavigational] = useState(true);

  // Cluster state
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [clusterLoading, setClusterLoading] = useState(false);
  const [clusterError, setClusterError] = useState("");
  const [selectedCluster, setSelectedCluster] = useState<Cluster | null>(null);
  const [editingCluster, setEditingCluster] = useState<string | null>(null);
  const [clusterEdits, setClusterEdits] = useState<Record<string, string[]>>({});
  const [newKwInputs, setNewKwInputs] = useState<Record<string, string>>({});

  // Article settings
  const [wordCount, setWordCount] = useState(2000);
  const [tone, setTone] = useState<Tone>("professional");
  const [audience, setAudience] = useState("general readers");
  const [articleLoading, setArticleLoading] = useState(false);
  const [isCompetitorMode, setIsCompetitorMode] = useState(false);
  const [articleError, setArticleError] = useState("");
  const [research] = useState<ResearchBrief | null>(null);
  const [article, setArticle] = useState<ArticleOutput | null>(null);
  const [pipelineLog] = useState<string[]>([]);
  const [lastSecondaryKws, setLastSecondaryKws] = useState<string[]>([]);

  // Images state
  const [images, setImages] = useState<ImagePrompt[]>([]);
  const [imagesLoading, setImagesLoading] = useState(false);
  const [imageError, setImageError] = useState("");

  const visibleKeywords = keywords.filter((k) =>
    k.volume >= minVolume &&
    (!hideNavigational || k.intent.toLowerCase() !== 'navigational')
  );

  // ── Keyword search ────────────────────────────────────────────────────────
  const runKeywordSearch = useCallback(async (kw: string, ctry: Country) => {
    if (!kw.trim()) return;
    setKwLoading(true);
    setKwError("");
    setKwBroaderNotice("");
    setKeywords([]);
    setClusters([]);
    setSelectedCluster(null);
    setArticle(null);
    try {
      const res = await fetch("/api/keywords", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword: kw.trim(), country: ctry }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch keywords");
      setKeywords(data.keywords);
      if (data.broaderKeyword) {
        setKwBroaderNotice(`Showing results for "${data.usedKeyword}" — broader keyword used for more results`);
      }
    } catch (e) {
      setKwError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setKwLoading(false);
    }
  }, []);

  const runNlpKeywordSearch = useCallback(async (kw: string, ctry: Country) => {
    if (!kw.trim()) return;
    setKwLoading(true);
    setKwError("");
    setKwBroaderNotice("");
    setKeywords([]);
    setClusters([]);
    setSelectedCluster(null);
    setArticle(null);

    const words = kw.trim().split(/\s+/);
    const variations = Array.from(new Set([
      kw.trim(),
      ...(words.length >= 3 ? [words.slice(0, 2).join(' ')] : []),
      ...(words.length >= 2 ? [words[0]] : []),
    ]));

    try {
      const results = await Promise.all(
        variations.map((v) =>
          fetch("/api/keywords", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ keyword: v, country: ctry }),
          }).then((r) => r.json()).catch(() => ({ keywords: [] }))
        )
      );

      const seen = new Set<string>();
      const merged: KeywordResult[] = [];
      for (const data of results) {
        for (const k of (data.keywords ?? []) as KeywordResult[]) {
          if (!seen.has(k.keyword)) {
            seen.add(k.keyword);
            merged.push(k);
          }
        }
      }
      merged.sort((a, b) => b.volume - a.volume);
      setKeywords(merged);
      const smartSelected = merged.filter(
        (k) => k.volume >= 500 && k.kd <= 30 && k.intent.toLowerCase() !== 'navigational'
      );
      setSelectedKws(new Set((smartSelected.length > 0 ? smartSelected : []).map((k) => k.keyword)));
      if (variations.length > 1) {
        setKwBroaderNotice(`Searched ${variations.map((v) => `"${v}"`).join(', ')} — ${merged.length} keywords merged`);
      }
    } catch (e) {
      setKwError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setKwLoading(false);
    }
  }, []);

  async function handleKeywordSearch() {
    await runKeywordSearch(seedKeyword, country);
  }

  function clearPipeline() {
    localStorage.removeItem("discovery_opportunity");
    localStorage.removeItem("nlp_analysis");
    localStorage.removeItem("article_brief");
    setFromNlp(false);
    setNlpAnalysis(null);
    setFromPipeline(false);
    setPipelineData(null);
    setNlpBrief(null);
  }

  useEffect(() => {
    refreshUserProfile();
    const params = new URLSearchParams(window.location.search);
    const kwParam = params.get("keyword");
    const fromParam = params.get("from");
    const stepParam = params.get("step");

    // Step 4: article generation with full pipeline data
    if (stepParam === "article" && fromParam === "pipeline") {
      try {
        const stored = localStorage.getItem("article_brief");
        if (stored) {
          const brief = JSON.parse(stored) as PipelineData;
          setFromPipeline(true);
          setPipelineData(brief);
          setSeedKeyword(brief.selectedKeywords?.[0] ?? brief.nlpData?.keyword ?? "");
          setCountry((brief.targetMarket ?? "Global") as Country);
          setActiveNav("articles");
        }
      } catch { /* ignore */ }
      return;
    }

    // Step 3: keyword research from NLP
    if (fromParam === "nlp" && kwParam) {
      try {
        const stored = localStorage.getItem("nlp_analysis");
        if (stored) {
          const analysis = JSON.parse(stored) as NlpAnalysis;
          // Prefer stored shortKeyword (Claude-extracted) over raw URL param (may be long sentence)
          const searchKeyword = analysis.shortKeyword
            || analysis.brief?.primaryKeyword
            || kwParam;
          setNlpAnalysis(analysis);
          setFromNlp(true);
          setSeedKeyword(searchKeyword);
          const mkt = (analysis.targetMarket ?? "Global") as Country;
          setCountry(mkt);
          setMinVolume(100);
          setActiveNav("keywords");
          runNlpKeywordSearch(searchKeyword, mkt);
          return;
        }
      } catch { /* ignore */ }
      setSeedKeyword(kwParam);

      // Fallback: old nlp_brief_data flow (direct NLP → article)
      try {
        const briefStored = localStorage.getItem("nlp_brief_data");
        if (briefStored) {
          setNlpBrief(JSON.parse(briefStored) as NlpBrief);
          localStorage.removeItem("nlp_brief_data");
        }
      } catch { /* ignore */ }
      setActiveNav("articles");
      return;
    }

    if (kwParam) {
      setSeedKeyword(kwParam);
      setActiveNav("articles");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSignOut() {
    await fetch("/api/auth/signout", { method: "POST" });
    window.location.href = "/login";
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
    const kwsToCluster = visibleKeywords.filter((k) => selectedKws.size === 0 || selectedKws.has(k.keyword));
    if (kwsToCluster.length === 0) return;
    setClusterLoading(true);
    setClusterError("");
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
      setClusterError(e instanceof Error ? e.message : "Clustering failed");
    } finally {
      setClusterLoading(false);
    }
  }

  // ── Cluster editing helpers ───────────────────────────────────────────────
  function getClusterKeywords(cluster: Cluster): string[] {
    return clusterEdits[cluster.name] ?? cluster.keywords;
  }

  function addKeywordToCluster(clusterName: string) {
    const input = (newKwInputs[clusterName] ?? "").trim();
    if (!input) return;
    const current = clusterEdits[clusterName] ?? (clusters.find((c) => c.name === clusterName)?.keywords ?? []);
    if (!current.includes(input)) {
      setClusterEdits((prev) => ({ ...prev, [clusterName]: [...current, input] }));
    }
    setNewKwInputs((prev) => ({ ...prev, [clusterName]: "" }));
  }

  function removeKeywordFromCluster(clusterName: string, kw: string) {
    const current = clusterEdits[clusterName] ?? (clusters.find((c) => c.name === clusterName)?.keywords ?? []);
    setClusterEdits((prev) => ({ ...prev, [clusterName]: current.filter((k) => k !== kw) }));
  }

  // ── Pipeline article generation ───────────────────────────────────────────
  function handleGeneratePipelineArticle() {
    if (!nlpAnalysis) return;
    const selectedArr = selectedKws.size > 0
      ? Array.from(selectedKws)
      : visibleKeywords.slice(0, 5).map((k) => k.keyword);
    const kw = nlpAnalysis.keyword || nlpAnalysis.brief?.recommendedH1 || seedKeyword;
    const payload: PipelineData = {
      nlpData:          nlpAnalysis,
      selectedKeywords: selectedArr.length > 0 ? selectedArr : [kw],
      targetMarket:     country,
    };
    setFromPipeline(true);
    setPipelineData(payload);
    setActiveNav("articles");
  }

  // ── Article generation ────────────────────────────────────────────────────
  async function handleGenerateArticle() {
    const selectedKwsArray = Array.from(selectedKws);
    const kw = fromPipeline && pipelineData?.selectedKeywords?.[0]
      ? pipelineData.selectedKeywords[0]
      : selectedKwsArray[0] ?? seedKeyword;
    if (!kw) return;

    setArticleLoading(true);
    setArticleError('');
    setArticle(null);

    const finalSecondaryKws = selectedKwsArray.filter((k: string) => k !== kw);
    setLastSecondaryKws(finalSecondaryKws.length > 0 ? finalSecondaryKws : [kw]);

    try {
      const response = await fetch('/api/article-v2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keyword: kw,
          wordCount: wordCount || 2000,
          tone: tone || 'professional',
          market: country || 'United Kingdom',
          secondaryKeywords: finalSecondaryKws.length > 0 ? finalSecondaryKws : [kw],
          entities: nlpAnalysis?.entities ?? [],
          topicalGaps: nlpAnalysis?.topicalGaps ?? [],
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Server error' }));
        setArticleError(err.error || 'Article generation failed');
        return;
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let fullArticle = '';

      setActiveNav('articles');

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        fullArticle += chunk;
        const estimatedTotal = (wordCount || 1500) * 6;
        const progress = Math.min(95, Math.round((fullArticle.length / estimatedTotal) * 100));
        const progressBar = document.getElementById('article-progress-bar');
        const progressPct = document.getElementById('article-progress-pct');
        const progressLabel = document.getElementById('article-progress-label');
        if (progressBar) (progressBar as HTMLElement).style.width = progress + '%';
        if (progressPct) progressPct.textContent = progress + '%';
        if (progressLabel) {
          if (progress < 20) progressLabel.textContent = 'Researching topic and structure...';
          else if (progress < 40) progressLabel.textContent = 'Writing introduction and key sections...';
          else if (progress < 60) progressLabel.textContent = 'Adding expert insights and data...';
          else if (progress < 80) progressLabel.textContent = 'Writing FAQ and conclusion...';
          else progressLabel.textContent = 'Finalising and quality checking...';
        }
      }

      const doneBar = document.getElementById('article-progress-bar');
      const donePct = document.getElementById('article-progress-pct');
      const doneLabel = document.getElementById('article-progress-label');
      if (doneBar) (doneBar as HTMLElement).style.width = '100%';
      if (donePct) donePct.textContent = '100%';
      if (doneLabel) doneLabel.textContent = 'Article complete ✓';

      setArticle({
        seoTitle: kw,
        metaDescription: '',
        article: fullArticle,
        wordCount,
        eeaScore: 0,
        readabilityScore: 0,
        keywordDensity: 0,
        improvements: [],
      });

      refreshUserProfile();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      setArticleError(`Request failed: ${err.message}`);
    } finally {
      setArticleLoading(false);
    }
  }

  // ── Competitor article generation ─────────────────────────────────────────
  async function handleCompetitorArticle() {
    const selectedKwsArray = Array.from(selectedKws);
    const kw = fromPipeline && pipelineData?.selectedKeywords?.[0]
      ? pipelineData.selectedKeywords[0]
      : selectedKwsArray[0] ?? seedKeyword;
    if (!kw) return;

    setArticleLoading(true);
    setIsCompetitorMode(true);
    setArticleError('');
    setArticle(null);

    const finalSecondaryKws = selectedKwsArray.filter((k: string) => k !== kw);
    setLastSecondaryKws(finalSecondaryKws.length > 0 ? finalSecondaryKws : [kw]);

    try {
      const response = await fetch('/api/article-competitor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keyword: kw,
          wordCount: wordCount || 2000,
          tone: tone || 'professional',
          market: country || 'United Kingdom',
          secondaryKeywords: finalSecondaryKws.length > 0 ? finalSecondaryKws : [kw],
          entities: nlpAnalysis?.entities ?? [],
          topicalGaps: nlpAnalysis?.topicalGaps ?? [],
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Server error' }));
        setArticleError(err.error || 'Competitor article generation failed');
        return;
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let fullArticle = '';

      setActiveNav('articles');

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        fullArticle += chunk;
        const isEnriching = fullArticle.includes('<!--SEORANKO_ENRICHING-->');
        // Progress is based on the base article content only (before enrichment marker)
        const baseContent = isEnriching
          ? fullArticle.split('<!--SEORANKO_ENRICHING-->')[0]
          : fullArticle;
        const estimatedTotal = (wordCount || 1500) * 6;
        const progress = Math.min(95, Math.round((baseContent.length / estimatedTotal) * 100));
        const progressBar = document.getElementById('article-progress-bar');
        const progressPct = document.getElementById('article-progress-pct');
        const progressLabel = document.getElementById('article-progress-label');
        if (progressBar) (progressBar as HTMLElement).style.width = (isEnriching ? 97 : progress) + '%';
        if (progressPct) progressPct.textContent = (isEnriching ? 97 : progress) + '%';
        if (progressLabel) {
          if (isEnriching) {
            progressLabel.textContent = 'Adding missing facts from competitor research...';
          } else if (progress < 20) {
            progressLabel.textContent = 'Analysing top 4 competitor articles...';
          } else if (progress < 40) {
            progressLabel.textContent = 'Extracting competitor NLP data...';
          } else if (progress < 60) {
            progressLabel.textContent = 'Identifying content gaps...';
          } else if (progress < 80) {
            progressLabel.textContent = 'Writing superior article...';
          } else {
            progressLabel.textContent = 'Adding unique insights competitors missed...';
          }
        }
      }

      // Extract enriched article if enrichment ran, otherwise use base article
      const enrichedMatch = fullArticle.match(
        /<!--SEORANKO_ENRICHED_START-->\n([\s\S]*?)\n<!--SEORANKO_ENRICHED_END-->/
      );
      const finalArticle = enrichedMatch
        ? enrichedMatch[1]
        : fullArticle.split('<!--SEORANKO_ENRICHING-->')[0];

      const doneBar = document.getElementById('article-progress-bar');
      const donePct = document.getElementById('article-progress-pct');
      const doneLabel = document.getElementById('article-progress-label');
      if (doneBar) (doneBar as HTMLElement).style.width = '100%';
      if (donePct) donePct.textContent = '100%';
      if (doneLabel) doneLabel.textContent = 'Competitor-beating article complete ✓';

      setArticle({
        seoTitle: kw,
        metaDescription: '',
        article: finalArticle,
        wordCount,
        eeaScore: 0,
        readabilityScore: 0,
        keywordDensity: 0,
        improvements: [],
      });

      refreshUserProfile();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      setArticleError(`Request failed: ${err.message}`);
    } finally {
      setArticleLoading(false);
      setIsCompetitorMode(false);
    }
  }

  // ── Images ────────────────────────────────────────────────────────────────
  async function handleGenerateImages() {
    if (!article) return;
    setImagesLoading(true);
    setImageError("");
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
      setImageError(e instanceof Error ? e.message : "Image generation failed");
    } finally {
      setImagesLoading(false);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen bg-[#FAFAF8] text-[#0F0F0F] overflow-hidden" style={{ fontFamily: "'Outfit', sans-serif", fontSize: '15px' }}>

      {/* ── Sidebar ── */}
      <aside className="w-56 flex-shrink-0 border-r border-[#E8E8E4] flex flex-col">
        {/* Logo */}
        <div className="px-5 py-5 border-b border-[#E8E8E4]">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-7 h-7 bg-[#FF6B2C] rounded-[7px] flex items-center justify-center">
              <span className="text-[#0a0a0a] font-extrabold text-xs">S</span>
            </div>
            <span className="font-bold text-base tracking-tight">Seoranko</span>
          </Link>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {NAV_ITEMS.map(({ id, label, icon, href }) =>
            href ? (
              <Link
                key={id}
                href={href}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-[8px] text-sm font-medium transition-colors text-[#6B6B6B] hover:text-[#0F0F0F] hover:bg-white"
              >
                {icon}
                {label}
              </Link>
            ) : (
              <button
                key={id}
                onClick={() => setActiveNav(id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-[8px] text-sm font-medium transition-colors ${
                  activeNav === id
                    ? "bg-[#FF6B2C]/10 text-[#FF6B2C]"
                    : "text-[#6B6B6B] hover:text-[#0F0F0F] hover:bg-white"
                }`}
              >
                {icon}
                {label}
              </button>
            )
          )}
        </nav>

        {/* Usage */}
        <div className="px-4 py-4 border-t border-[#E8E8E4]">
          {userProfile ? (() => {
            const meta = PLAN_USAGE[userProfile.plan] ?? PLAN_USAGE.free;
            const kwUsed = meta.kPeriod === "day" ? userProfile.keywords_used_today : userProfile.keywords_used_month;
            const artUsed = userProfile.articles_used_month;
            const kwMax = meta.keywords;
            const artMax = meta.articles;
            const rows = [
              { label: "Keywords", used: kwUsed, max: kwMax, period: meta.kPeriod },
              { label: "Articles",  used: artUsed, max: artMax, period: meta.aPeriod },
            ];
            return (
              <div className="space-y-2">
                <p className="text-[10px] text-[#6B6B6B] mb-1.5 uppercase tracking-wide font-medium">Usage</p>
                {rows.map(({ label, used, max, period }) => {
                  const isUnlimited = max === Infinity;
                  const periodLabel = period === "lifetime" ? "lifetime" : period === "day" ? "today" : "mo";
                  return (
                    <div key={label}>
                      <div className="flex justify-between text-[10px] text-[#6B6B6B] mb-1">
                        <span>{label}</span>
                        <span>{isUnlimited ? "∞" : `${used}/${max} ${periodLabel}`}</span>
                      </div>
                      {!isUnlimited && (
                        <div className="h-1 bg-[#F5F4F1] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-[#FF6B2C] rounded-full"
                            style={{ width: `${Math.min(100, (used / max) * 100)}%` }}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })() : (
            <div className="space-y-2">
              <div className="h-1 bg-[#F5F4F1] rounded-full animate-pulse" />
              <div className="h-1 bg-[#F5F4F1] rounded-full animate-pulse" />
            </div>
          )}
        </div>

        {/* User / Sign out */}
        <div className="px-4 py-3 border-t border-[#E8E8E4]">
          {userProfile && (
            <div className="flex items-center gap-2.5 mb-2.5">
              <div className="w-7 h-7 rounded-full bg-[#FF6B2C]/20 flex items-center justify-center flex-shrink-0">
                <span className="text-[#FF6B2C] text-xs font-bold uppercase">
                  {userProfile.name?.[0] ?? userProfile.email[0]}
                </span>
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-[#0F0F0F] truncate">{userProfile.name || userProfile.email}</p>
                <span className="inline-block text-[9px] font-bold uppercase tracking-wide text-[#FF6B2C] bg-[#FF6B2C]/10 px-1.5 py-0.5 rounded-full">
                  {(PLAN_USAGE[userProfile.plan] ?? PLAN_USAGE.free).label}
                </span>
              </div>
            </div>
          )}
          <button
            onClick={handleSignOut}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-[8px] text-xs font-medium text-[#6B6B6B] hover:text-[#0F0F0F] hover:bg-white transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Sign Out
          </button>
        </div>
      </aside>

      {/* ── Main ── */}
      <main className="flex-1 overflow-y-auto">

        {/* ── KEYWORDS view ── */}
        {activeNav === "keywords" && (
          <div className="max-w-6xl mx-auto px-8 py-8">

            {/* Page header */}
            <div className="mb-6">
              <h1 className="text-2xl font-bold mb-1">Keyword Research</h1>
              <p className="text-[#6B6B6B] text-sm">Enter a seed topic to find ranking opportunities across 13+ markets.</p>
            </div>

            {/* Pipeline bar */}
            {fromNlp && <PipelineBar step="keywords" />}

            {/* NLP analysis banner */}
            {fromNlp && nlpAnalysis && (
              <div className="flex items-center justify-between bg-[#22c55e]/5 border border-[#22c55e]/20 rounded-[10px] px-4 py-3 mb-6">
                <div className="flex items-center gap-3">
                  <span className="w-2 h-2 rounded-full bg-[#22c55e]" />
                  <div>
                    <p className="text-sm font-semibold text-[#22c55e]">NLP analysis loaded</p>
                    <p className="text-xs text-[#9B9B9B] mt-0.5">
                      {nlpAnalysis.entities.length} entities · {nlpAnalysis.topicalGaps.length} topical gaps · market: {nlpAnalysis.targetMarket}
                    </p>
                  </div>
                </div>
                <button onClick={clearPipeline} className="text-[#6B6B6B] hover:text-[#ef4444] transition-colors">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            )}

            {/* Search bar */}
            <div className="bg-white border border-[#E8E8E4] rounded-[10px] p-4 mb-6">
              <div className="flex flex-col sm:flex-row gap-3">
                <input
                  type="text"
                  value={seedKeyword}
                  onChange={(e) => setSeedKeyword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleKeywordSearch()}
                  placeholder="e.g. content marketing strategy"
                  className="flex-1 bg-[#FAFAF8] border border-[#E8E8E4] rounded-[8px] px-4 py-2.5 text-sm text-[#0F0F0F] placeholder-[#6b7280] focus:outline-none focus:border-[#FF6B2C]/50 transition-colors"
                />
                <select
                  value={country}
                  onChange={(e) => setCountry(e.target.value as Country)}
                  className="bg-[#FAFAF8] border border-[#E8E8E4] rounded-[8px] px-3 py-2.5 text-sm text-[#0F0F0F] focus:outline-none focus:border-[#FF6B2C]/50 transition-colors"
                >
                  {ALL_COUNTRIES.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
                <button
                  onClick={handleKeywordSearch}
                  disabled={kwLoading || !seedKeyword.trim()}
                  className="bg-[#FF6B2C] hover:bg-[#E85A1E] disabled:opacity-50 disabled:cursor-not-allowed text-[#0a0a0a] font-semibold text-sm px-6 py-2.5 rounded-[8px] transition-colors whitespace-nowrap"
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
              {kwBroaderNotice && (
                <div className="flex items-center gap-2 mt-3 bg-[#FF6B2C]/10 border border-[#FF6B2C]/20 rounded-[8px] px-3 py-2">
                  <svg className="w-3.5 h-3.5 text-[#FF6B2C] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-[#FF6B2C] text-xs">{kwBroaderNotice}</p>
                </div>
              )}
            </div>

            {/* Keywords table */}
            {keywords.length > 0 && (
              <>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm text-[#6B6B6B]">
                    <span className="text-[#0F0F0F] font-semibold">{keywords.length}</span>{" "}keywords found
                    {visibleKeywords.length !== keywords.length && (
                      <span>
                        {" "}· {visibleKeywords.length} match filters ·{" "}
                        <button
                          onClick={() => { setMinVolume(0); setHideNavigational(false); }}
                          className="text-[#FF6B2C] hover:underline"
                        >
                          Show all {keywords.length}
                        </button>
                      </span>
                    )}
                    {selectedKws.size > 0 && <span> · <span className="text-[#FF6B2C]">{selectedKws.size} selected</span></span>}
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={handleCluster}
                      disabled={clusterLoading}
                      className="flex items-center gap-2 bg-white border border-[#E8E8E4] hover:border-[#FF6B2C]/40 text-[#0F0F0F] text-sm font-medium px-4 py-2 rounded-[8px] transition-colors disabled:opacity-50"
                    >
                      {clusterLoading ? (
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4 text-[#FF6B2C]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h8m-8 6h16" />
                        </svg>
                      )}
                      {clusterLoading ? "Clustering…" : "Cluster with AI"}
                    </button>
                  </div>
                </div>

                {clusterError && (
                  <div className="bg-red-900/20 border border-red-500/30 rounded-[8px] px-4 py-3 mb-4 text-red-400 text-sm">
                    {clusterError}
                  </div>
                )}

                {/* Filter + bulk selection row */}
                <div className="flex gap-2 mb-3 flex-wrap items-center">
                  {/* Volume filter */}
                  <select
                    value={minVolume}
                    onChange={(e) => setMinVolume(Number(e.target.value))}
                    className="bg-white border border-[#E8E8E4] rounded-lg text-sm text-[#0F0F0F] px-3 py-2 focus:outline-none focus:border-[#FF6B2C] transition-colors"
                  >
                    <option value={0}>All volumes</option>
                    <option value={100}>100+ searches/mo</option>
                    <option value={500}>500+ searches/mo</option>
                    <option value={1000}>1,000+ searches/mo</option>
                    <option value={5000}>5,000+ searches/mo</option>
                  </select>

                  {/* Hide Navigational toggle */}
                  <button
                    onClick={() => setHideNavigational((v) => !v)}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border transition-colors ${
                      hideNavigational
                        ? "bg-[#FFF0E8] text-[#CC4A0F] border-[#FF6B2C]/30"
                        : "bg-white text-[#6B6B6B] border-[#E8E8E4]"
                    }`}
                  >
                    <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${hideNavigational ? "bg-[#FF6B2C]" : "bg-[#D4D4CE]"}`} />
                    Hide Navigational
                  </button>

                  {/* Divider */}
                  <div className="w-px h-6 bg-[#E8E8E4]" />

                  {/* Bulk selection buttons */}
                  <button
                    onClick={() => setSelectedKws(new Set(
                      visibleKeywords
                        .filter((k) => ['commercial', 'transactional'].includes(k.intent.toLowerCase()))
                        .map((k) => k.keyword)
                    ))}
                    className="bg-[#FFF0E8] text-[#CC4A0F] border border-[#FF6B2C]/30 px-4 py-2 rounded-lg text-sm font-semibold transition-colors hover:bg-[#FFE4D4]"
                  >
                    Select Commercial + Transactional
                  </button>
                  <button
                    onClick={() => setSelectedKws(new Set(visibleKeywords.map((k) => k.keyword)))}
                    className="bg-[#FFF0E8] text-[#CC4A0F] border border-[#FF6B2C]/30 px-4 py-2 rounded-lg text-sm font-semibold transition-colors hover:bg-[#FFE4D4]"
                  >
                    Select All
                  </button>
                  <button
                    onClick={() => setSelectedKws(new Set())}
                    className="border border-[#E8E8E4] text-[#6B6B6B] px-4 py-2 rounded-lg text-sm transition-colors hover:border-[#D4D4CE] hover:text-[#0F0F0F]"
                  >
                    Clear Selection
                  </button>
                </div>

                <div className="bg-white border border-[#E8E8E4] rounded-[10px] overflow-hidden mb-6">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[#E8E8E4]">
                        <th className="text-left text-[#6B6B6B] font-medium text-xs uppercase tracking-wide px-4 py-3 w-8">
                          <input
                            type="checkbox"
                            className="accent-[#f59e0b]"
                            checked={visibleKeywords.length > 0 && visibleKeywords.every((k) => selectedKws.has(k.keyword))}
                            onChange={(e) =>
                              setSelectedKws(e.target.checked ? new Set(visibleKeywords.map((k) => k.keyword)) : new Set())
                            }
                          />
                        </th>
                        {["Keyword", "Volume", "KD", "CPC", "Intent", "Trend", ""].map((col) => (
                          <th key={col} className="text-left text-[#6B6B6B] font-medium text-xs uppercase tracking-wide px-4 py-3">
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {visibleKeywords.map((kw) => (
                        <tr
                          key={kw.keyword}
                          className={`border-b border-[#E8E8E4] last:border-0 hover:bg-[#F0EFEB] transition-colors cursor-pointer ${
                            selectedKws.has(kw.keyword) ? "bg-[#FF6B2C]/5" : ""
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
                          <td className="px-4 py-3 font-medium text-[#0F0F0F]">{kw.keyword}</td>
                          <td className="px-4 py-3 text-[#6B6B6B]">{kw.volume.toLocaleString()}</td>
                          <td className="px-4 py-3"><KdBadge kd={kw.kd} /></td>
                          <td className="px-4 py-3 text-[#6B6B6B]">£{kw.cpc.toFixed(2)}</td>
                          <td className="px-4 py-3"><IntentBadge intent={kw.intent} /></td>
                          <td className="px-4 py-3"><Sparkline data={kw.trend} /></td>
                          <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                            <Link
                              href={`/dashboard/nlp?keyword=${encodeURIComponent(kw.keyword)}&location_code=${COUNTRY_LOCATION_CODES[country] ?? 0}`}
                              className="text-xs font-semibold text-[#FF6B2C] hover:text-[#d97706] transition-colors whitespace-nowrap"
                            >
                              NLP →
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Pipeline CTA — generate article with full pipeline data */}
                {fromNlp && (
                  <div className="mb-6">
                    <button
                      onClick={handleGeneratePipelineArticle}
                      className="w-full flex items-center justify-between bg-[#FF6B2C] hover:bg-[#E85A1E] text-[#0a0a0a] font-bold text-sm px-6 py-4 rounded-[10px] transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span>→ Generate Optimised Article with Full Pipeline Data</span>
                      </div>
                      <span className="text-xs font-normal opacity-80">
                        Discovery + NLP + {selectedKws.size > 0 ? selectedKws.size : visibleKeywords.length} keywords
                      </span>
                    </button>
                  </div>
                )}
              </>
            )}

            {/* Clusters */}
            {clusters.length > 0 && (
              <div className="mb-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="font-bold text-lg">Keyword Clusters</h2>
                  <p className="text-[#6B6B6B] text-sm">Select a cluster to generate an article</p>
                </div>
                <div className="grid md:grid-cols-3 gap-4">
                  {clusters.map((cluster) => {
                    const isSelected = selectedCluster?.name === cluster.name;
                    const isEditing = editingCluster === cluster.name;
                    const kws = getClusterKeywords(cluster);
                    return (
                      <div
                        key={cluster.name}
                        className={`bg-white border rounded-[10px] p-5 transition-all ${
                          isSelected ? "border-[#FF6B2C] shadow-lg shadow-amber-500/10" : "border-[#E8E8E4] hover:border-[#FF6B2C]/40"
                        }`}
                      >
                        <div className="flex items-start justify-between mb-3">
                          <div
                            className="flex-1 cursor-pointer"
                            onClick={() => { setSelectedCluster(cluster); setEditingCluster(null); }}
                          >
                            <p className="font-semibold text-sm mb-1">{cluster.name}</p>
                            <IntentBadge intent={cluster.intent} />
                          </div>
                          <div className="flex items-center gap-2 ml-2">
                            <div className="text-right">
                              <p className="text-[#FF6B2C] font-bold text-lg leading-none">{cluster.opportunity}</p>
                              <p className="text-[#6B6B6B] text-[10px]">score</p>
                            </div>
                            <button
                              onClick={(e) => { e.stopPropagation(); setEditingCluster(isEditing ? null : cluster.name); }}
                              className="text-[#6B6B6B] hover:text-[#0F0F0F] p-1 rounded transition-colors"
                              title="Edit keywords"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                            </button>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-1.5 mb-3">
                          {kws.map((kw) => (
                            <span
                              key={kw}
                              className="inline-flex items-center gap-1 bg-[#FAFAF8] border border-[#E8E8E4] rounded-[6px] px-2 py-0.5 text-[11px] text-[#6B6B6B]"
                            >
                              {kw}
                              {isEditing && (
                                <button
                                  onClick={() => removeKeywordFromCluster(cluster.name, kw)}
                                  className="text-[#6B6B6B] hover:text-[#ef4444] leading-none ml-0.5"
                                >×</button>
                              )}
                            </span>
                          ))}
                        </div>

                        {isEditing && (
                          <div className="flex gap-1.5 mt-2">
                            <input
                              type="text"
                              value={newKwInputs[cluster.name] ?? ""}
                              onChange={(e) => setNewKwInputs((prev) => ({ ...prev, [cluster.name]: e.target.value }))}
                              onKeyDown={(e) => { if (e.key === "Enter") addKeywordToCluster(cluster.name); }}
                              placeholder="Add keyword…"
                              className="flex-1 bg-[#FAFAF8] border border-[#E8E8E4] rounded-[6px] px-2.5 py-1.5 text-xs text-[#0F0F0F] placeholder-[#6b7280] focus:outline-none focus:border-[#FF6B2C]/50"
                            />
                            <button
                              onClick={() => addKeywordToCluster(cluster.name)}
                              className="bg-[#FF6B2C] hover:bg-[#E85A1E] text-[#0a0a0a] font-bold text-xs px-2.5 py-1.5 rounded-[6px] transition-colors"
                            >+</button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Article generator settings */}
            {(keywords.length > 0 || clusters.length > 0) && (
              <div className="bg-white border border-[#E8E8E4] rounded-[10px] p-6">
                <h2 className="font-bold mb-5 flex items-center gap-2">
                  <svg className="w-4 h-4 text-[#FF6B2C]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                  Generate Article
                </h2>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
                  <div>
                    <label className="text-[#6B6B6B] text-xs font-medium block mb-2 uppercase tracking-wide">Word Count</label>
                    <select
                      value={wordCount}
                      onChange={(e) => setWordCount(Number(e.target.value))}
                      className="w-full bg-[#FAFAF8] border border-[#E8E8E4] rounded-[8px] px-3 py-2 text-sm text-[#0F0F0F] focus:outline-none focus:border-[#FF6B2C]/50"
                    >
                      {[1000, 1500, 2000, 2500, 3000].map((n) => (
                        <option key={n} value={n}>{n} words</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-[#6B6B6B] text-xs font-medium block mb-2 uppercase tracking-wide">Tone</label>
                    <select
                      value={tone}
                      onChange={(e) => setTone(e.target.value as Tone)}
                      className="w-full bg-[#FAFAF8] border border-[#E8E8E4] rounded-[8px] px-3 py-2 text-sm text-[#0F0F0F] focus:outline-none focus:border-[#FF6B2C]/50"
                    >
                      <option value="professional">Professional</option>
                      <option value="conversational">Conversational</option>
                      <option value="authoritative">Authoritative</option>
                      <option value="friendly">Friendly</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-[#6B6B6B] text-xs font-medium block mb-2 uppercase tracking-wide">Audience</label>
                    <input
                      type="text"
                      value={audience}
                      onChange={(e) => setAudience(e.target.value)}
                      className="w-full bg-[#FAFAF8] border border-[#E8E8E4] rounded-[8px] px-3 py-2 text-sm text-[#0F0F0F] placeholder-[#6b7280] focus:outline-none focus:border-[#FF6B2C]/50"
                      placeholder="e.g. marketing managers"
                    />
                  </div>

                  <div>
                    <label className="text-[#6B6B6B] text-xs font-medium block mb-2 uppercase tracking-wide">Market</label>
                    <select
                      value={country}
                      onChange={(e) => setCountry(e.target.value as Country)}
                      className="w-full bg-[#FAFAF8] border border-[#E8E8E4] rounded-[8px] px-3 py-2 text-sm text-[#0F0F0F] focus:outline-none focus:border-[#FF6B2C]/50"
                    >
                      {ALL_COUNTRIES.map((c) => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {selectedCluster && (
                  <div className="bg-[#FAFAF8] border border-[#E8E8E4] rounded-[8px] px-4 py-3 mb-5 flex items-center gap-3">
                    <svg className="w-4 h-4 text-[#FF6B2C] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <p className="text-sm">
                      <span className="text-[#6B6B6B]">Targeting cluster: </span>
                      <span className="font-semibold">{selectedCluster.name}</span>
                      <span className="text-[#6B6B6B]"> · Primary keyword: </span>
                      <span className="text-[#FF6B2C] font-medium">{selectedCluster.keywords[0]}</span>
                    </p>
                  </div>
                )}

                {articleLoading && (
                  <div style={{padding:'32px', background:'#FFF0E8', borderRadius:'12px', border:'1px solid rgba(255,107,44,0.2)', margin:'24px 0'}}>
                    <div style={{display:'flex', justifyContent:'space-between', marginBottom:'8px'}}>
                      <span style={{fontSize:'14px', fontWeight:600, color:'#CC4A0F'}}>{isCompetitorMode ? '🏆 Analysing competitors & writing superior article...' : '✍️ Writing your article...'}</span>
                      <span style={{fontSize:'14px', fontWeight:700, color:'#FF6B2C'}} id="article-progress-pct">0%</span>
                    </div>
                    <div style={{background:'rgba(255,107,44,0.15)', borderRadius:'8px', height:'8px', overflow:'hidden'}}>
                      <div id="article-progress-bar" style={{height:'100%', background:'#FF6B2C', borderRadius:'8px', width:'0%', transition:'width 0.3s ease'}}></div>
                    </div>
                    <div style={{marginTop:'12px', fontSize:'13px', color:'#CC4A0F'}} id="article-progress-label">Preparing article structure...</div>
                  </div>
                )}

                <div className="flex items-center gap-3 flex-wrap">
                  <button
                    onClick={handleGenerateArticle}
                    disabled={articleLoading}
                    className="bg-[#FF6B2C] hover:bg-[#E85A1E] disabled:opacity-60 disabled:cursor-not-allowed text-[#0a0a0a] font-bold text-sm px-8 py-3 rounded-[8px] transition-colors flex items-center gap-2"
                  >
                    {articleLoading && !isCompetitorMode ? (
                      <>
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Generating…
                      </>
                    ) : "Generate Article →"}
                  </button>
                  <button
                    onClick={handleCompetitorArticle}
                    disabled={articleLoading}
                    className="bg-gradient-to-r from-[#FF6B2C] to-[#FF9A2C] hover:from-[#E85A1E] hover:to-[#E8881E] disabled:opacity-60 disabled:cursor-not-allowed text-[#0a0a0a] font-bold text-sm px-8 py-3 rounded-[8px] transition-all flex items-center gap-2 shadow-sm"
                  >
                    {articleLoading && isCompetitorMode ? (
                      <>
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Analysing…
                      </>
                    ) : "🏆 Competitor-Beating Article"}
                  </button>
                </div>

                {articleError && (
                  <div className="bg-red-900/20 border border-red-500/30 rounded-[8px] px-4 py-3 mt-4 text-red-400 text-sm">
                    {articleError}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── ARTICLES view ── */}
        {activeNav === "articles" && (
          <div className="max-w-6xl mx-auto px-8 py-8">

            {/* Pipeline bar */}
            {fromPipeline && <PipelineBar step="article" />}

            {/* Pipeline data banner */}
            {fromPipeline && pipelineData && (
              <div className="flex items-center justify-between bg-[#22c55e]/5 border border-[#22c55e]/20 rounded-[10px] px-4 py-3 mb-6">
                <div className="flex items-center gap-3">
                  <span className="w-2 h-2 rounded-full bg-[#22c55e]" />
                  <div>
                    <p className="text-sm font-semibold text-[#22c55e]">Full pipeline data loaded — Discovery + NLP + Keywords injected into article</p>
                    <p className="text-xs text-[#9B9B9B] mt-0.5">
                      {pipelineData.nlpData?.entities?.length ?? 0} entities · {pipelineData.nlpData?.topicalGaps?.length ?? 0} topical gaps · {pipelineData.selectedKeywords?.length ?? 0} keywords · market: {pipelineData.targetMarket}
                    </p>
                  </div>
                </div>
                <button onClick={clearPipeline} className="text-[#6B6B6B] hover:text-[#ef4444] transition-colors">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            )}

            {/* Legacy NLP brief banner */}
            {nlpBrief && !fromPipeline && (
              <div className="flex items-center justify-between bg-[#FF6B2C]/10 border border-[#FF6B2C]/30 rounded-[10px] px-4 py-3 mb-6">
                <div className="flex items-center gap-3">
                  <svg className="w-4 h-4 text-[#FF6B2C] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                  <div>
                    <p className="text-sm font-semibold text-[#FF6B2C]">NLP Brief loaded — your article will be pre-optimised with entity data, topical coverage, and content structure</p>
                    <p className="text-xs text-[#9B9B9B] mt-0.5">
                      {nlpBrief.entities.length} entities · {nlpBrief.topicalGaps.length} topical gaps · {nlpBrief.lsiTerms.length} LSI terms · {nlpBrief.structure.length} sections
                    </p>
                  </div>
                </div>
                <button onClick={() => setNlpBrief(null)} className="text-[#6B6B6B] hover:text-[#0F0F0F] transition-colors">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            )}

            {/* Article gen form for pipeline flow */}
            {fromPipeline && !article && !articleLoading && pipelineData && (
              <div className="bg-white border border-[#E8E8E4] rounded-[10px] p-6 mb-6">
                <h2 className="font-bold mb-5 flex items-center gap-2">
                  <svg className="w-4 h-4 text-[#FF6B2C]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  Article Settings
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
                  <div>
                    <label className="text-[#6B6B6B] text-xs font-medium block mb-2 uppercase tracking-wide">Word Count</label>
                    <select
                      value={wordCount}
                      onChange={(e) => setWordCount(Number(e.target.value))}
                      className="w-full bg-[#FAFAF8] border border-[#E8E8E4] rounded-[8px] px-3 py-2 text-sm text-[#0F0F0F] focus:outline-none focus:border-[#FF6B2C]/50"
                    >
                      {[1000, 1500, 2000, 2500, 3000].map((n) => (
                        <option key={n} value={n}>{n} words</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[#6B6B6B] text-xs font-medium block mb-2 uppercase tracking-wide">Tone</label>
                    <select
                      value={tone}
                      onChange={(e) => setTone(e.target.value as Tone)}
                      className="w-full bg-[#FAFAF8] border border-[#E8E8E4] rounded-[8px] px-3 py-2 text-sm text-[#0F0F0F] focus:outline-none focus:border-[#FF6B2C]/50"
                    >
                      <option value="professional">Professional</option>
                      <option value="conversational">Conversational</option>
                      <option value="authoritative">Authoritative</option>
                      <option value="friendly">Friendly</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[#6B6B6B] text-xs font-medium block mb-2 uppercase tracking-wide">Audience</label>
                    <input
                      type="text"
                      value={audience}
                      onChange={(e) => setAudience(e.target.value)}
                      className="w-full bg-[#FAFAF8] border border-[#E8E8E4] rounded-[8px] px-3 py-2 text-sm text-[#0F0F0F] placeholder-[#6b7280] focus:outline-none focus:border-[#FF6B2C]/50"
                      placeholder="e.g. general readers"
                    />
                  </div>
                  <div>
                    <label className="text-[#6B6B6B] text-xs font-medium block mb-2 uppercase tracking-wide">Market</label>
                    <select
                      value={country}
                      onChange={(e) => setCountry(e.target.value as Country)}
                      className="w-full bg-[#FAFAF8] border border-[#E8E8E4] rounded-[8px] px-3 py-2 text-sm text-[#0F0F0F] focus:outline-none focus:border-[#FF6B2C]/50"
                    >
                      {ALL_COUNTRIES.map((c) => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="bg-[#FAFAF8] border border-[#E8E8E4] rounded-[8px] px-4 py-3 mb-5">
                  <p className="text-xs text-[#6B6B6B]">
                    Primary keyword: <span className="text-[#FF6B2C] font-medium">{pipelineData.selectedKeywords?.[0]}</span>
                    {pipelineData.selectedKeywords && pipelineData.selectedKeywords.length > 1 && (
                      <span className="ml-2">+ {pipelineData.selectedKeywords.length - 1} secondary</span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  <button
                    onClick={handleGenerateArticle}
                    disabled={articleLoading}
                    className="bg-[#FF6B2C] hover:bg-[#E85A1E] disabled:opacity-60 disabled:cursor-not-allowed text-[#0a0a0a] font-bold text-sm px-8 py-3 rounded-[8px] transition-colors flex items-center gap-2"
                  >
                    Generate Pipeline Article →
                  </button>
                  <button
                    onClick={handleCompetitorArticle}
                    disabled={articleLoading}
                    className="bg-gradient-to-r from-[#FF6B2C] to-[#FF9A2C] hover:from-[#E85A1E] hover:to-[#E8881E] disabled:opacity-60 disabled:cursor-not-allowed text-[#0a0a0a] font-bold text-sm px-8 py-3 rounded-[8px] transition-all flex items-center gap-2 shadow-sm"
                  >
                    🏆 Competitor-Beating Article
                  </button>
                </div>
              </div>
            )}

            {articleLoading && (
              <div style={{padding:'32px', background:'#FFF0E8', borderRadius:'12px', border:'1px solid rgba(255,107,44,0.2)', marginBottom:'24px'}}>
                <div style={{display:'flex', justifyContent:'space-between', marginBottom:'8px'}}>
                  <span style={{fontSize:'14px', fontWeight:600, color:'#CC4A0F'}}>{isCompetitorMode ? '🏆 Analysing competitors & writing superior article...' : '✍️ Writing your article...'}</span>
                  <span style={{fontSize:'14px', fontWeight:700, color:'#FF6B2C'}} id="article-progress-pct">0%</span>
                </div>
                <div style={{background:'rgba(255,107,44,0.15)', borderRadius:'8px', height:'8px', overflow:'hidden'}}>
                  <div id="article-progress-bar" style={{height:'100%', background:'#FF6B2C', borderRadius:'8px', width:'0%', transition:'width 0.3s ease'}}></div>
                </div>
                <div style={{marginTop:'12px', fontSize:'13px', color:'#CC4A0F'}} id="article-progress-label">Preparing article structure...</div>
              </div>
            )}

            {articleError && (
              <div className="bg-red-900/20 border border-red-500/30 rounded-[8px] px-4 py-3 mb-6 text-red-400 text-sm">
                {articleError}
              </div>
            )}

            <div className="flex items-center justify-between mb-8">
              <div>
                <h1 className="text-2xl font-bold mb-1">Generated Article</h1>
                <p className="text-[#6B6B6B] text-sm">
                  {article ? `"${article.seoTitle}"` : "No article generated yet. Go to Keywords to get started."}
                </p>
              </div>
              {article && (
                <div className="flex gap-3">
                  <button
                    onClick={handleGenerateImages}
                    disabled={imagesLoading}
                    className="flex items-center gap-2 bg-white border border-[#E8E8E4] hover:border-[#FF6B2C]/40 text-[#0F0F0F] text-sm font-medium px-4 py-2.5 rounded-[8px] transition-colors disabled:opacity-50"
                  >
                    {imagesLoading ? (
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4 text-[#FF6B2C]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                    className="flex items-center gap-2 bg-[#FF6B2C] hover:bg-[#E85A1E] text-[#0a0a0a] font-semibold text-sm px-4 py-2.5 rounded-[8px] transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    Copy Article
                  </button>
                </div>
              )}
            </div>

            {imageError && (
              <div className="bg-red-900/20 border border-red-500/30 rounded-[8px] px-4 py-3 mb-4 text-red-400 text-sm">
                {imageError}
              </div>
            )}

            {!article && !articleLoading && !fromPipeline && (
              <div className="bg-white border border-[#E8E8E4] rounded-[10px] p-16 text-center">
                <svg className="w-12 h-12 text-[#2a2a2a] mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <p className="text-[#6B6B6B] mb-4">No article generated yet</p>
                <button
                  onClick={() => setActiveNav("keywords")}
                  className="bg-[#FF6B2C] text-[#0a0a0a] font-semibold text-sm px-6 py-2.5 rounded-[8px] hover:bg-[#E85A1E] transition-colors"
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
                  <div className="bg-white border border-[#E8E8E4] rounded-[10px] p-5 mb-5">
                    <p className="text-[#6B6B6B] text-xs font-medium uppercase tracking-wide mb-1">SEO Title</p>
                    <p className="font-semibold text-[#0F0F0F] mb-4">{article.seoTitle}</p>
                    <p className="text-[#6B6B6B] text-xs font-medium uppercase tracking-wide mb-1">Meta Description</p>
                    <p className="text-[#6B6B6B] text-sm leading-relaxed">{article.metaDescription}</p>
                  </div>

                  {/* Research brief */}
                  {research && (
                    <div className="bg-white border border-[#E8E8E4] rounded-[10px] p-5 mb-5">
                      <p className="font-semibold text-sm mb-4 flex items-center gap-2">
                        <span className="w-2 h-2 bg-[#FF6B2C] rounded-full" />
                        Research Brief
                      </p>
                      <div className="grid md:grid-cols-2 gap-4">
                        <div>
                          <p className="text-[#6B6B6B] text-xs uppercase tracking-wide font-medium mb-2">Questions Answered</p>
                          <ul className="space-y-1">
                            {research.questions.map((q, i) => (
                              <li key={i} className="text-sm text-[#6B6B6B] flex gap-2">
                                <span className="text-[#FF6B2C] font-bold text-xs mt-0.5">Q</span> {q}
                              </li>
                            ))}
                          </ul>
                        </div>
                        <div>
                          <p className="text-[#6B6B6B] text-xs uppercase tracking-wide font-medium mb-2">Semantic Keywords</p>
                          <div className="flex flex-wrap gap-1.5">
                            {research.semanticKeywords.map((kw) => (
                              <span key={kw} className="bg-[#FAFAF8] border border-[#E8E8E4] rounded-[6px] px-2 py-0.5 text-[11px] text-[#6B6B6B]">
                                {kw}
                              </span>
                            ))}
                          </div>
                          <p className="text-[#6B6B6B] text-xs uppercase tracking-wide font-medium mb-2 mt-4">Content Gaps</p>
                          <ul className="space-y-1">
                            {research.contentGaps.map((g, i) => (
                              <li key={i} className="text-sm text-[#6B6B6B] flex gap-2">
                                <span className="text-[#22c55e] font-bold text-xs mt-0.5">✓</span> {g}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Full article — only shown after generation completes */}
                  {!articleLoading && (
                    <>
                      <div style={{display:'flex', gap:'16px', padding:'12px 16px', background:'#F5F4F1', borderRadius:'8px', marginBottom:'16px', fontSize:'13px', color:'#6B6B6B', flexWrap:'wrap'}}>
                        <span>📝 <strong style={{color:'#0F0F0F'}}>{article.article.replace(/<[^>]*>/g, '').trim().split(/\s+/).filter(Boolean).length} words</strong></span>
                        <span>✅ <strong style={{color:'#16A34A'}}>Complete</strong></span>
                        <span>🇬🇧 <strong style={{color:'#0F0F0F'}}>UK English</strong></span>
                        <span>📅 <strong style={{color:'#0F0F0F'}}>June 2026</strong></span>
                        {lastSecondaryKws.length > 0 && (
                          <span>🔑 <strong style={{color:'#0F0F0F'}}>
                            {lastSecondaryKws.filter((k: string) => article.article.replace(/<[^>]*>/g, '').toLowerCase().includes(k.toLowerCase())).length}/{lastSecondaryKws.length} keywords
                          </strong></span>
                        )}
                      </div>
                      <div className="bg-white border border-[#E8E8E4] rounded-[10px] p-6">
                        <div
                          dangerouslySetInnerHTML={{ __html: article.article }}
                          style={{ lineHeight: '1.8', fontSize: '15px', color: '#0F0F0F' }}
                          className="article-rendered"
                        />
                      </div>
                    </>
                  )}
                </div>

                {/* Scores sidebar */}
                <div className="w-56 flex-shrink-0 space-y-4">
                  <div className="bg-white border border-[#E8E8E4] rounded-[10px] p-4">
                    <p className="text-xs text-[#6B6B6B] uppercase tracking-wide font-medium mb-4">Content Scores</p>
                    <div className="grid grid-cols-2 gap-4">
                      <ScoreRing score={article.eeaScore} label="EEAT" color="#f59e0b" />
                      <ScoreRing score={article.readabilityScore} label="Readability" color="#22c55e" />
                    </div>
                    <div className="mt-4 pt-4 border-t border-[#E8E8E4] space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-[#6B6B6B] text-xs">Word Count</span>
                        <span className="text-[#0F0F0F] text-sm font-semibold">{article.wordCount.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-[#6B6B6B] text-xs">Keyword Density</span>
                        <span className={`text-sm font-semibold ${parseFloat(String(article.keywordDensity)) <= 1.5 ? "text-[#22c55e]" : "text-[#ef4444]"}`}>
                          {article.keywordDensity}{typeof article.keywordDensity === "number" ? "%" : ""}
                        </span>
                      </div>
                    </div>
                  </div>

                  {article.improvements.length > 0 && (
                    <div className="bg-white border border-[#E8E8E4] rounded-[10px] p-4">
                      <p className="text-xs text-[#6B6B6B] uppercase tracking-wide font-medium mb-3">Improvements</p>
                      <ul className="space-y-2">
                        {article.improvements.map((imp, i) => (
                          <li key={i} className="flex gap-2 text-[11px] text-[#6B6B6B] leading-relaxed">
                            <span className="text-[#FF6B2C] font-bold flex-shrink-0 mt-0.5">→</span>
                            {imp}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {pipelineLog.length > 0 && (
                    <div className="bg-white border border-[#E8E8E4] rounded-[10px] p-4">
                      <p className="text-xs text-[#6B6B6B] uppercase tracking-wide font-medium mb-3">Pipeline Log</p>
                      <ul className="space-y-1.5">
                        {pipelineLog.map((entry, i) => {
                          const isOk = entry.startsWith('✅') || entry.includes('verified') || entry.includes('clean') || entry.includes('complete') || entry.includes('written') || entry.includes('collected');
                          const isWarn = entry.startsWith('⚠️') || entry.includes('Removed') || entry.includes('issues');
                          const isBlock = entry.startsWith('🚫') || entry.startsWith('BLOCKER');
                          const color = isBlock ? 'text-[#ef4444]' : isWarn ? 'text-[#FF6B2C]' : isOk ? 'text-[#22c55e]' : 'text-[#6B6B6B]';
                          return (
                            <li key={i} className={`text-[11px] leading-relaxed ${color}`}>{entry}</li>
                          );
                        })}
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
                <p className="text-[#6B6B6B] text-sm">AI-generated image suggestions for your article.</p>
              </div>
              {article && images.length === 0 && (
                <button
                  onClick={handleGenerateImages}
                  disabled={imagesLoading}
                  className="bg-[#FF6B2C] hover:bg-[#E85A1E] text-[#0a0a0a] font-semibold text-sm px-5 py-2.5 rounded-[8px] transition-colors disabled:opacity-50 flex items-center gap-2"
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
              <div className="bg-white border border-[#E8E8E4] rounded-[10px] p-16 text-center">
                <svg className="w-12 h-12 text-[#2a2a2a] mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <p className="text-[#6B6B6B] mb-4">
                  {article ? "Generate images for your article" : "Generate an article first"}
                </p>
                {!article && (
                  <button
                    onClick={() => setActiveNav("keywords")}
                    className="bg-[#FF6B2C] text-[#0a0a0a] font-semibold text-sm px-6 py-2.5 rounded-[8px] hover:bg-[#E85A1E] transition-colors"
                  >
                    Go to Keyword Research →
                  </button>
                )}
              </div>
            )}

            {images.length > 0 && (
              <div className="grid md:grid-cols-3 gap-5">
                {images.map((img) => (
                  <div key={img.id} className="bg-white border border-[#E8E8E4] rounded-[10px] overflow-hidden group">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={img.url}
                      alt={img.altText}
                      className="w-full aspect-video object-cover bg-[#FAFAF8]"
                      loading="lazy"
                    />
                    <div className="p-4">
                      <p className="text-[#6B6B6B] text-[10px] uppercase tracking-wide font-medium mb-1">{img.placement}</p>
                      <p className="text-sm font-medium mb-2">{img.caption}</p>
                      <p className="text-[#6B6B6B] text-xs leading-relaxed">Alt: {img.altText}</p>
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
            <p className="text-[#6B6B6B] text-sm mb-8">Manage your profile and subscription.</p>

            {/* Profile */}
            <div className="bg-white border border-[#E8E8E4] rounded-[10px] p-6 mb-5">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-[#6B6B6B] mb-5">Profile</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1.5">Display Name</label>
                  <input
                    type="text"
                    defaultValue={userProfile?.name ?? ""}
                    readOnly
                    className="w-full bg-[#FAFAF8] border border-[#E8E8E4] rounded-[8px] px-3 py-2.5 text-sm text-[#0F0F0F] cursor-not-allowed"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">Email</label>
                  <input
                    type="email"
                    defaultValue={userProfile?.email ?? ""}
                    readOnly
                    className="w-full bg-[#FAFAF8] border border-[#E8E8E4] rounded-[8px] px-3 py-2.5 text-sm text-[#6B6B6B] cursor-not-allowed"
                  />
                </div>
              </div>
            </div>

            {/* Plan */}
            <div className="bg-white border border-[#E8E8E4] rounded-[10px] p-6 mb-5">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-[#6B6B6B] mb-5">Subscription</h2>
              <div className="flex items-center justify-between mb-6">
                <div>
                  <p className="text-sm font-medium mb-0.5">Current Plan</p>
                  <span className="inline-flex items-center gap-1.5 bg-[#FF6B2C]/10 text-[#FF6B2C] text-xs font-bold px-2.5 py-1 rounded-full uppercase tracking-wide">
                    {(PLAN_USAGE[userProfile?.plan ?? "free"] ?? PLAN_USAGE.free).label}
                  </span>
                </div>
                {(userProfile?.plan === "free" || userProfile?.plan === "starter") && (
                  <button className="bg-[#FF6B2C] hover:bg-[#E85A1E] text-[#0a0a0a] font-semibold text-sm px-5 py-2.5 rounded-[10px] transition-colors">
                    Upgrade Plan
                  </button>
                )}
              </div>
              {userProfile?.plan === "free" && (
                <div className="bg-[#FAFAF8] border border-[#E8E8E4] rounded-[8px] p-4 text-xs text-[#6B6B6B]">
                  Upgrade to <span className="text-[#0F0F0F] font-medium">Starter £19/mo</span> for 500 keyword searches and 30 articles per month.
                </div>
              )}
            </div>

            {/* Usage */}
            {userProfile && (() => {
              const meta = PLAN_USAGE[userProfile.plan] ?? PLAN_USAGE.free;
              const unlimited = meta.keywords === Infinity;
              const rows = [
                { label: "Keyword Searches", used: meta.kPeriod === "day" ? userProfile.keywords_used_today : userProfile.keywords_used_month, limit: meta.keywords, unit: meta.kPeriod === "day" ? "/day" : "/mo" },
                { label: "AI Articles",      used: userProfile.articles_used_month, limit: meta.articles, unit: meta.aPeriod === "lifetime" ? " lifetime" : "/mo" },
              ];
              return (
                <div className="bg-white border border-[#E8E8E4] rounded-[10px] p-6">
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-[#6B6B6B] mb-5">Usage</h2>
                  <div className="space-y-5">
                    {rows.map(({ label, used, limit }) => {
                      const pct = unlimited ? 0 : Math.min(100, Math.round((used / limit) * 100));
                      const barColor = pct >= 100 ? "#ef4444" : pct >= 75 ? "#f59e0b" : "#22c55e";
                      return (
                        <div key={label}>
                          <div className="flex justify-between items-center mb-1.5">
                            <span className="text-sm font-medium">{label}</span>
                            <span className="text-xs text-[#6B6B6B]">
                              {unlimited ? `${used} / ∞` : `${used} / ${limit}`}
                            </span>
                          </div>
                          {!unlimited && (
                            <div className="h-1.5 bg-[#FAFAF8] rounded-full overflow-hidden">
                              <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: barColor }} />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-[#6B6B6B] text-xs mt-5">
                    Keywords reset {meta.kPeriod === "day" ? "daily at midnight UTC" : "on the 1st of each month"}.
                    {meta.aPeriod === "lifetime" ? " Free plan includes 1 article lifetime." : ""}
                  </p>
                </div>
              );
            })()}
          </div>
        )}

      </main>
    </div>
  );
}
