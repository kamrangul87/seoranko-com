"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { InternalLinksPanel } from "@/components/InternalLinksPanel";
import { OrganisationSchemaSettings } from "@/components/OrganisationSchemaSettings";
import type { InternalLink } from "@/lib/article-master";
import type {
  KeywordResult,
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
  // Org schema fields (added in Phase 1b migration)
  org_name?: string;
  org_url?: string;
  org_description?: string;
  org_linkedin?: string;
  org_twitter?: string;
  org_github?: string;
  org_address_country?: string;
  org_founding_year?: number;
  website_url?: string;
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
    id: "humanize",
    label: "Humanize",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
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
    id: "ranking-agent",
    label: "Ranking Agent",
    href: "/dashboard/ranking-agent",
    icon: (
      <span className="w-4 h-4 flex items-center justify-center text-sm leading-none">🤖</span>
    ),
  },
  {
    id: "site-audit",
    label: "Site Audit",
    href: "/dashboard/site-audit",
    icon: (
      <span className="w-4 h-4 flex items-center justify-center text-sm leading-none">🔍</span>
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

// ─── Score Cell (ring + optional improve button) ─────────────────────────────

function ScoreCell({
  score, label, color, scoreType, onImprove, improving, count, canImprove,
}: {
  score: number;
  label: string;
  color: string;
  scoreType: string;
  onImprove: (type: string, score: number) => void;
  improving: string | null;
  count: number;
  canImprove: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <ScoreRing score={score} label={label} color={color} />
      {canImprove && (
        <button
          onClick={() => onImprove(scoreType, score)}
          disabled={improving !== null}
          title={count > 0 ? `${count}/3 improvements used` : 'Improve this score with AI'}
          className="text-[9px] text-[#6B6B6B] hover:text-[#FF6B2C] transition-colors disabled:opacity-40 flex items-center gap-0.5 mt-0.5"
        >
          {improving === scoreType ? (
            <svg className="w-2.5 h-2.5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : '↻'} Improve{count > 0 ? ` (${count}/3)` : ''}
        </button>
      )}
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
  const [kwEntityPresence, setKwEntityPresence] = useState<{ wikipedia: boolean; reddit: boolean; linkedin: boolean; score: number; recommendations: string[] } | null>(null);
  const [selectedKws, setSelectedKws] = useState<Set<string>>(new Set());
  const [minVolume, setMinVolume] = useState(500);
  const [hideNavigational, setHideNavigational] = useState(true);

  // Cluster state
  const [clusterLoading, setClusterLoading] = useState(false);
  const [clusterError, setClusterError] = useState("");

  // Cluster panel state
  const [clusterPanelOpen, setClusterPanelOpen] = useState(false);
  const [panelKeywords, setPanelKeywords] = useState<Array<{ keyword: string; volume: number; kd: number; intent: string }>>([]);
  const [panelPrimaryKeyword, setPanelPrimaryKeyword] = useState('');
  const [panelClusterName, setPanelClusterName] = useState('');
  const [panelAddKwInput, setPanelAddKwInput] = useState('');

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
  const [internalLinks, setInternalLinks] = useState<InternalLink[]>([]);

  // Images state
  const [images, setImages] = useState<ImagePrompt[]>([]);
  const [imagesLoading, setImagesLoading] = useState(false);
  const [imageError, setImageError] = useState("");
  const [imageTier, setImageTier] = useState<'free' | 'premium'>('free');
  const [imageStored, setImageStored] = useState(false);
  const [injectedArticleHtml, setInjectedArticleHtml] = useState<string>('');
  const [imageStats, setImageStats] = useState<{ requested: number; generated: number; failures: string[] } | null>(null);

  // Score improve state
  const [improveCounts, setImproveCounts] = useState<Record<string, number>>({});
  const [improvingScore, setImprovingScore] = useState<string | null>(null);
  const [scoreToast, setScoreToast] = useState<{ message: string; kind: 'success' | 'error' } | null>(null);

  // Download state
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState<string | null>(null);
  const [articleCopied, setArticleCopied] = useState(false);

  // Humanize state
  const [humanizeInput, setHumanizeInput] = useState('');
  const [humanizeKeyword, setHumanizeKeyword] = useState('');
  const [humanizeLevel, setHumanizeLevel] = useState<'light' | 'medium' | 'aggressive'>('medium');
  const [humanizeLoading, setHumanizeLoading] = useState(false);
  const [humanizeError, setHumanizeError] = useState('');
  const [humanizeResult, setHumanizeResult] = useState<{
    humanizedHtml: string;
    humanScore: number;
    passesDetection: boolean;
    seoPreserved: { linksPreserved: boolean; keywordInFirstParagraph: boolean; statsPreserved: boolean; schemaPreserved: boolean; };
    bannedWordsRemoved: string[];
  } | null>(null);
  const [humanizeCopied, setHumanizeCopied] = useState(false);

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
      if (data.entityPresence) setKwEntityPresence(data.entityPresence);
      else setKwEntityPresence(null);
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

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setClusterPanelOpen(false);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
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
      // Build flat keyword list sorted by volume descending for the side panel
      const sortedKws = [...kwsToCluster].sort((a, b) => b.volume - a.volume);
      const panelKws = sortedKws.map(k => ({ keyword: k.keyword, volume: k.volume, kd: k.kd, intent: k.intent }));
      const clusterName = data.clusters?.[0]?.name ?? (sortedKws[0]?.keyword ?? 'Keyword Cluster');
      setPanelKeywords(panelKws);
      setPanelPrimaryKeyword(sortedKws[0]?.keyword ?? '');
      setPanelClusterName(clusterName);
      setClusterPanelOpen(true);
    } catch (e) {
      setClusterError(e instanceof Error ? e.message : "Clustering failed");
    } finally {
      setClusterLoading(false);
    }
  }

  function handlePanelAddKeyword() {
    const kw = panelAddKwInput.trim();
    if (!kw || panelKeywords.some(pk => pk.keyword === kw)) return;
    const newKw = { keyword: kw, volume: 0, kd: 0, intent: 'informational' };
    setPanelKeywords(prev => [...prev, newKw]);
    if (!panelPrimaryKeyword) setPanelPrimaryKeyword(kw);
    setPanelAddKwInput('');
  }

  function handlePanelGenerateArticle() {
    const ordered = [panelPrimaryKeyword, ...panelKeywords.map(k => k.keyword).filter(k => k !== panelPrimaryKeyword)];
    console.log('[cluster-panel] Generate Article payload:', {
      primaryKeyword: ordered[0],
      secondaryKeywords: ordered.slice(1),
      totalKeywords: ordered.length,
    });
    setClusterPanelOpen(false);
    setActiveNav('articles');
    handleGenerateArticle(ordered);
  }

  function handlePanelCompetitorArticle() {
    const ordered = [panelPrimaryKeyword, ...panelKeywords.map(k => k.keyword).filter(k => k !== panelPrimaryKeyword)];
    console.log('[cluster-panel] Competitor Article payload:', {
      primaryKeyword: ordered[0],
      secondaryKeywords: ordered.slice(1),
      totalKeywords: ordered.length,
    });
    setClusterPanelOpen(false);
    setActiveNav('articles');
    handleCompetitorArticle(ordered);
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
  async function handleGenerateArticle(overrideKws?: string[]) {
    const selectedKwsArray = overrideKws ?? Array.from(selectedKws);
    const kw = fromPipeline && pipelineData?.selectedKeywords?.[0]
      ? pipelineData.selectedKeywords[0]
      : selectedKwsArray[0] ?? seedKeyword;
    if (!kw) return;

    setArticleLoading(true);
    setIsCompetitorMode(false);
    setArticleError('');
    setArticle(null);
    setImproveCounts({});
    setImageStats(null);
    setScoreToast(null);
    setActiveNav('articles');

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
          internalLinks: internalLinks.filter(l => l.url && l.anchorText),
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
          else if (fullArticle.includes('<!--SEORANKO_WITH_IMAGES_START-->')) progressLabel.textContent = 'Images generated and embedded ✓';
          else if (fullArticle.includes('<!--SEORANKO_HUMANIZED_START-->')) progressLabel.textContent = 'Generating images for article...';
          else progressLabel.textContent = 'Humanising and generating images...';
        }
      }

      const doneBar = document.getElementById('article-progress-bar');
      const donePct = document.getElementById('article-progress-pct');
      const doneLabel = document.getElementById('article-progress-label');
      if (doneBar) (doneBar as HTMLElement).style.width = '100%';
      if (donePct) donePct.textContent = '100%';
      if (doneLabel) doneLabel.textContent = 'Article + images complete ✓';

      // Parse score metadata appended by route as HTML comment
      let articleSearchScore: number | undefined;
      let articleAiScore: number | undefined;
      let articleEeatScore: number | undefined;
      let articleReadabilityScore: number | undefined;
      let articleKeywordDensity: number | undefined;
      let articleFactSourcingScore: number | undefined;
      let articleFactPatchedCount: number | undefined;
      let articleLlmsTxtEntry: string | undefined;
      let articleHumanScore: number | undefined;
      let articlePassesDetection: boolean | undefined;
      let articleBannedWords: string[] | undefined;
      let articleRankScore: number | undefined;
      let articleFactDensity: { score: number; grade: string; factsPerHundredWords: number; suggestions: string[] } | undefined;
      let articleFaqs: Array<{ question: string; answer: string }> | undefined;
      let articleAnswerFirst: boolean | undefined;
      let articleHasSchema: boolean | undefined;
      let articleSchemaScriptTag: string | undefined;
      const scoresMatch = fullArticle.match(/\n<!-- SEORANKO_SCORES:(\{[\s\S]*?\}) -->/);
      if (scoresMatch) {
        try {
          const parsed = JSON.parse(scoresMatch[1]);
          articleSearchScore = parsed.searchScore;
          articleAiScore = parsed.aiScore;
          articleEeatScore = parsed.eeatScore;
          articleReadabilityScore = parsed.readabilityScore;
          articleKeywordDensity = parsed.keywordDensity;
          articleFactSourcingScore = parsed.factSourcingScore;
          articleFactPatchedCount = parsed.factPatchedCount;
          articleLlmsTxtEntry = parsed.llmsTxtEntry;
          articleHumanScore = parsed.humanScore;
          articlePassesDetection = parsed.passesDetection;
          articleBannedWords = parsed.bannedWordsRemoved;
          articleRankScore = parsed.rankScore;
          articleFactDensity = parsed.factDensity;
          articleFaqs = parsed.faqs;
          articleAnswerFirst = parsed.answerFirst;
          articleHasSchema = parsed.hasSchema;
          articleSchemaScriptTag = parsed.schemaScriptTag;
        } catch { /* keep undefined */ }
        fullArticle = fullArticle.replace(/\n<!-- SEORANKO_SCORES:\{[\s\S]*?\} -->/, '');
      }

      // Priority: WITH_IMAGES (article + embedded images) > HUMANIZED > base
      const withImagesMatchV2 = fullArticle.match(/\n<!--SEORANKO_WITH_IMAGES_START-->\n([\s\S]*?)\n<!--SEORANKO_WITH_IMAGES_END-->/);
      const humanizedMatchV2 = fullArticle.match(/\n<!--SEORANKO_HUMANIZED_START-->\n([\s\S]*?)\n<!--SEORANKO_HUMANIZED_END-->/);
      const finalArticleHtml = withImagesMatchV2
        ? withImagesMatchV2[1].trim()
        : humanizedMatchV2
          ? humanizedMatchV2[1].trim()
          : fullArticle.replace(/<!--[^>]*-->/g, '').trim();

      // Auto-populate Images tab from embedded image set
      const imageSetMatchV2 = fullArticle.match(/<!--SEORANKO_IMAGE_SET_START-->([\s\S]*?)<!--SEORANKO_IMAGE_SET_END-->/);
      if (imageSetMatchV2) {
        try {
          const imgData = JSON.parse(imageSetMatchV2[1]);
          setImages(imgData.images || []);
          setImageStored(imgData.stored || false);
          if (imgData.imageStats) setImageStats(imgData.imageStats);
          if (withImagesMatchV2) setInjectedArticleHtml(withImagesMatchV2[1].trim());
        } catch { /* ignore parse error */ }
      }

      setArticle({
        seoTitle: kw,
        metaDescription: '',
        article: finalArticleHtml,
        wordCount,
        eeaScore: articleEeatScore ?? 0,
        readabilityScore: articleReadabilityScore ?? 0,
        factSourcingScore: articleFactSourcingScore,
        factPatchedCount: articleFactPatchedCount,
        keywordDensity: articleKeywordDensity ?? 0,
        improvements: [],
        searchScore: articleSearchScore,
        aiScore: articleAiScore,
        llmsTxtEntry: articleLlmsTxtEntry,
        humanScore: articleHumanScore,
        passesDetection: articlePassesDetection,
        bannedWordsRemoved: articleBannedWords,
        rankScore: articleRankScore,
        factDensity: articleFactDensity,
        faqs: articleFaqs,
        answerFirst: articleAnswerFirst,
        hasSchema: articleHasSchema,
        schemaScriptTag: articleSchemaScriptTag,
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
  async function handleCompetitorArticle(overrideKws?: string[]) {
    const selectedKwsArray = overrideKws ?? Array.from(selectedKws);
    const kw = fromPipeline && pipelineData?.selectedKeywords?.[0]
      ? pipelineData.selectedKeywords[0]
      : selectedKwsArray[0] ?? seedKeyword;
    if (!kw) return;

    setArticleLoading(true);
    setIsCompetitorMode(true);
    setArticleError('');
    setArticle(null);
    setImproveCounts({});
    setImageStats(null);
    setScoreToast(null);

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

      // Priority: WITH_IMAGES > HUMANIZED > ENRICHED > base
      const withImagesMatchComp = fullArticle.match(
        /<!--SEORANKO_WITH_IMAGES_START-->\n([\s\S]*?)\n<!--SEORANKO_WITH_IMAGES_END-->/
      );
      const humanizedMatchComp = fullArticle.match(
        /<!--SEORANKO_HUMANIZED_START-->\n([\s\S]*?)\n<!--SEORANKO_HUMANIZED_END-->/
      );
      const enrichedMatch = fullArticle.match(
        /<!--SEORANKO_ENRICHED_START-->\n([\s\S]*?)\n<!--SEORANKO_ENRICHED_END-->/
      );
      const humanScoreMatch = fullArticle.match(/<!--SEORANKO_HUMAN_SCORE:(\d+)-->/);
      const competitorHumanScore = humanScoreMatch ? parseInt(humanScoreMatch[1], 10) : undefined;
      const finalArticle = withImagesMatchComp
        ? withImagesMatchComp[1].trim()
        : humanizedMatchComp
          ? humanizedMatchComp[1].trim()
          : enrichedMatch
            ? enrichedMatch[1]
            : fullArticle.split('<!--SEORANKO_ENRICHING-->')[0];

      // Auto-populate Images tab from embedded image set
      const imageSetMatchComp = fullArticle.match(/<!--SEORANKO_IMAGE_SET_START-->([\s\S]*?)<!--SEORANKO_IMAGE_SET_END-->/);
      if (imageSetMatchComp) {
        try {
          const imgData = JSON.parse(imageSetMatchComp[1]);
          setImages(imgData.images || []);
          setImageStored(imgData.stored || false);
          if (imgData.imageStats) setImageStats(imgData.imageStats);
          if (withImagesMatchComp) setInjectedArticleHtml(withImagesMatchComp[1].trim());
        } catch { /* ignore */ }
      }

      const doneBar = document.getElementById('article-progress-bar');
      const donePct = document.getElementById('article-progress-pct');
      const doneLabel = document.getElementById('article-progress-label');
      if (doneBar) (doneBar as HTMLElement).style.width = '100%';
      if (donePct) donePct.textContent = '100%';
      if (doneLabel) doneLabel.textContent = 'Competitor-beating article complete ✓';

      // Parse scores emitted by the competitor route
      let compSearchScore: number | undefined;
      let compAiScore: number | undefined;
      let compEeatScore = 0;
      let compReadabilityScore = 0;
      let compKeywordDensity = 0;
      let compFactSourcingScore: number | undefined;
      const compScoresMatch = fullArticle.match(/\n<!-- SEORANKO_SCORES:(\{[\s\S]*?\}) -->/);
      if (compScoresMatch) {
        try {
          const parsed = JSON.parse(compScoresMatch[1]);
          compSearchScore = parsed.searchScore;
          compAiScore = parsed.aiScore;
          compEeatScore = parsed.eeatScore ?? 0;
          compReadabilityScore = parsed.readabilityScore ?? 0;
          compKeywordDensity = parsed.keywordDensity ?? 0;
          compFactSourcingScore = parsed.factSourcingScore;
        } catch { /* keep defaults */ }
      }

      setArticle({
        seoTitle: kw,
        metaDescription: '',
        article: finalArticle,
        wordCount,
        eeaScore: compEeatScore,
        readabilityScore: compReadabilityScore,
        keywordDensity: compKeywordDensity,
        improvements: [],
        searchScore: compSearchScore,
        aiScore: compAiScore,
        factSourcingScore: compFactSourcingScore,
        humanScore: competitorHumanScore,
        passesDetection: competitorHumanScore != null ? competitorHumanScore >= 72 : undefined,
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

  // ── Score improvement (streaming) ────────────────────────────────────────
  async function handleImproveScore(scoreType: string, currentScore: number) {
    if (!article) return;
    if ((improveCounts[scoreType] ?? 0) >= 3) return;
    setImprovingScore(scoreType);
    setScoreToast(null);
    try {
      const label = scoreType === 'eeat' ? 'EEAT' : scoreType === 'readability' ? 'Readability' : scoreType === 'human' ? 'Human Score' : 'Keyword Density';
      setScoreToast({ message: `Improving ${label}…`, kind: 'success' });

      const res = await fetch('/api/improve-article-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          articleContent: article.article,
          target: scoreType,
          currentScore,
          keyword: article.seoTitle,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: 'Improvement failed' }));
        throw new Error(errData.error || 'Improvement failed');
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';

      if (!reader) throw new Error('No response stream');

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fullContent += decoder.decode(value);
      }

      // Extract changes summary and clean content
      const changesMatch = fullContent.match(/<!--\s*CHANGES:\s*([\s\S]*?)\s*-->/);
      const changesSummary = changesMatch ? changesMatch[1].trim() : 'Improvements applied';
      const cleanContent = fullContent.replace(/<!--\s*CHANGES:[\s\S]*?-->/g, '').trim();

      if (cleanContent) {
        setArticle(prev => prev ? { ...prev, article: cleanContent } : null);
      }
      setImproveCounts(prev => ({ ...prev, [scoreType]: (prev[scoreType] ?? 0) + 1 }));
      setScoreToast({ message: `${label} improved — ${changesSummary}`, kind: 'success' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      setScoreToast({ message: err.message || 'Improvement failed', kind: 'error' });
    } finally {
      setImprovingScore(null);
      setTimeout(() => setScoreToast(null), 6000);
    }
  }

  async function handleImproveAll() {
    if (!article) return;
    const targets = [
      { type: 'eeat', score: article.eeaScore },
      { type: 'readability', score: article.readabilityScore },
      ...(article.humanScore != null ? [{ type: 'human', score: article.humanScore }] : []),
      { type: 'keyword', score: article.keywordDensity },
    ].filter(({ type, score }) => {
      if (type === 'keyword') return (score as number) < 0.5 || (score as number) > 3;
      return (score as number) < 95 && (improveCounts[type] ?? 0) < 3;
    });
    for (const { type, score } of targets) {
      await handleImproveScore(type, score as number);
    }
  }

  // ── Download ──────────────────────────────────────────────────────────────
  async function handleDownload(format: 'html' | 'zip' | 'markdown' | 'pdf') {
    if (!article) return;
    setDownloadOpen(false);
    setDownloadLoading(true);
    setDownloadStatus('Preparing download…');
    try {
      const res = await fetch('/api/article-download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          articleHtml: article.article,
          format,
          keyword: article.seoTitle || seedKeyword,
          downloadImages: format === 'zip',
          schemaScriptTag: article.schemaScriptTag || '',
          articleUrl: (() => {
            const slug = (article.seoTitle || seedKeyword).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80)
            return `${userProfile?.website_url || 'https://yourdomain.com'}/blog/${slug}`
          })(),
          authorName: userProfile?.name || 'Author',
          metaDescription: article.metaDescription || '',
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Download failed' }));
        setDownloadStatus(`Error: ${err.error}`);
        setTimeout(() => setDownloadStatus(null), 4000);
        return;
      }

      // Determine filename from Content-Disposition header
      const cd = res.headers.get('content-disposition') || '';
      const fnMatch = cd.match(/filename="([^"]+)"/);
      const slug = (article.seoTitle || seedKeyword).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60);
      const ext = format === 'zip' ? 'html' : format === 'pdf' ? 'html' : format;
      const filename = fnMatch ? fnMatch[1] : `${slug}.${ext}`;

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      if (format === 'pdf') {
        // Open print-ready HTML in new tab so user can File → Print → Save as PDF
        window.open(url, '_blank');
        setDownloadStatus('✅ Opened in new tab — use File → Print → Save as PDF');
      } else {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setDownloadStatus(`✅ Downloaded as ${filename}`);
      }

      setTimeout(() => setDownloadStatus(null), 5000);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      setDownloadStatus(`Error: ${err.message}`);
      setTimeout(() => setDownloadStatus(null), 4000);
    } finally {
      setDownloadLoading(false);
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
        body: JSON.stringify({ article: article.article, keyword: seedKeyword, tier: imageTier, count: 3 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Image generation failed");
      setImages(data.images || []);
      setImageStored(data.stored || false);
      if (data.injectedHtml) setInjectedArticleHtml(data.injectedHtml);
      setActiveNav("images");
    } catch (e) {
      setImageError(e instanceof Error ? e.message : "Image generation failed");
    } finally {
      setImagesLoading(false);
    }
  }

  // ── Humanize ─────────────────────────────────────────────────────────────
  async function handleHumanize() {
    const html = humanizeInput.trim() || article?.article || '';
    if (!html) return;
    setHumanizeLoading(true);
    setHumanizeError('');
    setHumanizeResult(null);
    try {
      const res = await fetch('/api/humanize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html, keyword: humanizeKeyword || seedKeyword, level: humanizeLevel }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Humanization failed');
      setHumanizeResult(data);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      setHumanizeError(err.message || 'Humanization failed');
    } finally {
      setHumanizeLoading(false);
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

            {/* Brand Entity Score card — shown when cached data is available */}
            {kwEntityPresence && (
              <div className="bg-white border border-[#E8E8E4] rounded-[10px] p-4 mb-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-[#0F0F0F] uppercase tracking-wide">Brand Entity Score</span>
                    <span style={{ fontFamily: 'monospace', fontSize: '11px', fontWeight: 700, color: '#9B9B9B' }}>●○○</span>
                    <span className="text-[10px] text-[#9B9B9B]">EXPERIMENTAL</span>
                  </div>
                  <span className={`text-sm font-bold ${kwEntityPresence.score >= 66 ? 'text-[#16A34A]' : kwEntityPresence.score >= 33 ? 'text-[#FF6B2C]' : 'text-[#DC2626]'}`}>
                    {kwEntityPresence.score}/100
                  </span>
                </div>
                <div className="flex gap-3 mb-3">
                  {([
                    { label: 'Wikipedia', present: kwEntityPresence.wikipedia },
                    { label: 'Reddit',    present: kwEntityPresence.reddit },
                    { label: 'LinkedIn',  present: kwEntityPresence.linkedin },
                  ] as { label: string; present: boolean }[]).map(({ label, present }) => (
                    <div key={label} className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-[6px] border ${present ? 'bg-green-500/10 border-green-500/20 text-green-600' : 'bg-[#F5F4F1] border-[#E8E8E4] text-[#9B9B9B]'}`}>
                      <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '10px' }}>{present ? '●' : '○'}</span>
                      {label}
                    </div>
                  ))}
                </div>
                {kwEntityPresence.recommendations?.length > 0 && (
                  <ul className="space-y-1">
                    {kwEntityPresence.recommendations.slice(0, 2).map((r: string, i: number) => (
                      <li key={i} className="text-xs text-[#6B6B6B] flex items-start gap-1.5">
                        <span className="text-[#FF6B2C] mt-0.5 flex-shrink-0">→</span>
                        {r}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

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
                        {["Keyword", "Volume", "KD", "CPC", "Intent", "AI Citation", "Trend", ""].map((col) => (
                          <th key={col} className="text-left text-[#6B6B6B] font-medium text-xs uppercase tracking-wide px-4 py-3">
                            {col === "AI Citation" ? (
                              <span title="AI Citation Opportunity — how easy it is to get cited by AI for this keyword">
                                {col} ●○○
                              </span>
                            ) : col}
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
                          <td className="px-4 py-3">
                            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                            {(kw as any).aiCitationOpportunity ? (() => {
                              /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
                              const opp = (kw as any).aiCitationOpportunity;
                              const score = opp.opportunityScore ?? 50;
                              const isHigh = score >= 70;
                              const isMed  = score >= 40 && score < 70;
                              return (
                                <span
                                  title={`Opportunity score: ${score}/100. ${opp.dominantCompetitors?.length > 0 ? 'Competitors cited: ' + opp.dominantCompetitors.slice(0,3).join(', ') : 'No dominant competitors yet.'}`}
                                  style={{
                                    fontSize: '9px', fontWeight: 700, padding: '2px 7px', borderRadius: '20px',
                                    background: isHigh ? '#F0FDF4' : isMed ? '#FFFBEB' : '#FEF2F2',
                                    color: isHigh ? '#15803D' : isMed ? '#D97706' : '#DC2626',
                                    border: `1px solid ${isHigh ? '#BBF7D0' : isMed ? '#FDE68A' : '#FECACA'}`,
                                    whiteSpace: 'nowrap' as const,
                                  }}
                                >
                                  {isHigh ? '●●● WIN' : isMed ? '●●○ MEDIUM' : '●○○ CROWDED'}
                                </span>
                              );
                            })() : <span style={{ color: '#9B9B9B', fontSize: '11px' }}>—</span>}
                          </td>
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
                <InternalLinksPanel links={internalLinks} onChange={setInternalLinks} />
                <div className="flex items-center gap-3 flex-wrap">
                  <button
                    onClick={() => handleGenerateArticle()}
                    disabled={articleLoading}
                    className="bg-[#FF6B2C] hover:bg-[#E85A1E] disabled:opacity-60 disabled:cursor-not-allowed text-[#0a0a0a] font-bold text-sm px-8 py-3 rounded-[8px] transition-colors flex items-center gap-2"
                  >
                    Generate Pipeline Article →
                  </button>
                  <button
                    onClick={() => handleCompetitorArticle()}
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
                <>
                <div className="flex gap-3 items-center">
                  {/* Images auto-embedded badge — shows when images were auto-generated */}
                  {images.length > 0 ? (
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-[6px] px-2.5 py-1.5">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        {images.length} images embedded
                      </div>
                      <button
                        onClick={handleGenerateImages}
                        disabled={imagesLoading}
                        className="text-xs text-[#6B6B6B] hover:text-[#FF6B2C] transition-colors disabled:opacity-50 underline underline-offset-2"
                      >
                        {imagesLoading ? "Regenerating…" : "Regenerate"}
                      </button>
                    </div>
                  ) : (
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
                  )}
                  {/* Download dropdown */}
                  <div className="relative">
                    <button
                      onClick={() => setDownloadOpen(v => !v)}
                      disabled={downloadLoading}
                      className="flex items-center gap-2 bg-[#16a34a] hover:bg-[#15803d] disabled:opacity-50 text-white font-semibold text-sm px-4 py-2.5 rounded-[8px] transition-colors"
                    >
                      {downloadLoading ? (
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                      )}
                      {downloadLoading ? 'Preparing…' : 'Download Article'}
                      <svg className="w-3 h-3 ml-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>

                    {downloadOpen && (
                      <>
                        {/* backdrop */}
                        <div className="fixed inset-0 z-10" onClick={() => setDownloadOpen(false)} />
                        <div className="absolute right-0 top-full mt-1 w-72 bg-white border border-[#E8E8E4] rounded-[10px] shadow-lg z-20 overflow-hidden">
                          <div className="px-3 pt-3 pb-1">
                            <p className="text-[10px] text-[#9B9B9B] uppercase tracking-wide font-medium mb-2">Choose Format</p>
                          </div>
                          {[
                            { fmt: 'zip' as const, icon: '📦', label: 'Self-Contained HTML (images embedded)', desc: 'Images embedded as data URIs — works anywhere, no broken images' },
                            { fmt: 'html' as const, icon: '📄', label: 'HTML File Only', desc: 'For platforms that host images separately' },
                            { fmt: 'markdown' as const, icon: '📝', label: 'Markdown (.md)', desc: 'For Ghost, Notion, Obsidian, or Markdown editors' },
                            { fmt: 'pdf' as const, icon: '🖨', label: 'Print-Ready HTML (for PDF)', desc: 'Opens print-ready page — use File → Print → Save as PDF' },
                          ].map(({ fmt, icon, label, desc }) => (
                            <button
                              key={fmt}
                              onClick={() => handleDownload(fmt)}
                              className="w-full flex items-start gap-3 px-3 py-2.5 hover:bg-[#F5F4F1] transition-colors text-left"
                            >
                              <span className="text-lg leading-none mt-0.5 flex-shrink-0">{icon}</span>
                              <div>
                                <p className="text-sm font-medium text-[#0F0F0F]">{label}{fmt === 'zip' && <span className="ml-1.5 text-[9px] font-bold bg-[#16a34a]/10 text-[#16a34a] px-1.5 py-0.5 rounded-full uppercase tracking-wide">Recommended</span>}</p>
                                <p className="text-[11px] text-[#6B6B6B] leading-tight mt-0.5">{desc}</p>
                              </div>
                            </button>
                          ))}
                          <div className="px-3 py-2 border-t border-[#F5F4F1] mt-1">
                            <p className="text-[10px] text-[#9B9B9B] leading-tight">Self-Contained HTML embeds images directly — no dependency on external URLs</p>
                          </div>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Copy HTML — secondary option for WordPress / custom editors */}
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(article.article).then(() => {
                        setArticleCopied(true);
                        setTimeout(() => setArticleCopied(false), 2000);
                      }).catch(() => {});
                    }}
                    className="flex items-center gap-2 bg-white border border-[#E8E8E4] hover:border-[#FF6B2C]/40 text-[#0F0F0F] font-medium text-sm px-3 py-2.5 rounded-[8px] transition-colors"
                    title="Copy raw HTML for WordPress or custom editors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    {articleCopied ? '✅ Copied!' : 'Copy HTML'}
                  </button>
                </div>

                {/* Download status toast */}
                {downloadStatus && (
                  <div className={`mt-2 text-xs px-3 py-1.5 rounded-[6px] ${downloadStatus.startsWith('Error') ? 'bg-red-50 text-red-700 border border-red-100' : 'bg-green-50 text-green-700 border border-green-100'}`}>
                    {downloadStatus}
                  </div>
                )}
                </>
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
                    <div className="flex items-center justify-between mb-4">
                      <p className="text-xs text-[#6B6B6B] uppercase tracking-wide font-medium">Content Scores</p>
                      {Object.values(improveCounts).some(v => v < 3) && (
                        <button
                          onClick={handleImproveAll}
                          disabled={improvingScore !== null}
                          className="text-[9px] font-semibold text-[#FF6B2C] hover:text-[#E85A1E] disabled:opacity-40 flex items-center gap-0.5 transition-colors"
                        >
                          {improvingScore ? (
                            <svg className="w-2.5 h-2.5 animate-spin" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                          ) : '↻'} Improve All
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <ScoreCell score={article.eeaScore} label="EEAT" color="#f59e0b" scoreType="eeat" onImprove={handleImproveScore} improving={improvingScore} count={improveCounts['eeat'] ?? 0} canImprove={article.eeaScore < 95 && (improveCounts['eeat'] ?? 0) < 3} />
                      <ScoreCell score={article.readabilityScore} label="Readability" color="#22c55e" scoreType="readability" onImprove={handleImproveScore} improving={improvingScore} count={improveCounts['readability'] ?? 0} canImprove={article.readabilityScore < 95 && (improveCounts['readability'] ?? 0) < 3} />
                      {article.searchScore != null && (
                        <ScoreRing score={article.searchScore} label="Search SEO" color="#1D4ED8" />
                      )}
                      {article.aiScore != null && (
                        <ScoreRing score={article.aiScore} label="AI Visibility" color="#EA580C" />
                      )}
                      {article.humanScore != null && (
                        <ScoreCell score={article.humanScore} label="Human Score" color="#7C3AED" scoreType="human" onImprove={handleImproveScore} improving={improvingScore} count={improveCounts['human'] ?? 0} canImprove={article.humanScore < 95 && (improveCounts['human'] ?? 0) < 3} />
                      )}
                      {article.factSourcingScore != null && (
                        <ScoreRing score={article.factSourcingScore} label="Fact Sourcing" color="#0891b2" />
                      )}
                    </div>
                    {scoreToast && (
                      <div className={`mt-3 text-[11px] leading-tight px-2 py-1.5 rounded-[6px] ${scoreToast.kind === 'success' ? 'bg-green-500/10 text-green-700' : 'bg-red-500/10 text-red-700'}`}>
                        {scoreToast.message}
                      </div>
                    )}
                    {article.factPatchedCount != null && article.factPatchedCount > 0 && (
                      <p className="text-xs text-[#0891b2] mt-3 leading-tight">
                        ✅ {article.factPatchedCount} unsourced statistic{article.factPatchedCount === 1 ? '' : 's'} automatically hedged with citations
                      </p>
                    )}

                    {/* RANK Score */}
                    {article.rankScore != null && (
                      <div className="mt-4 pt-4 border-t border-[#E8E8E4]">
                        <div className={`p-3 rounded-lg border-2 ${article.rankScore >= 80 ? 'bg-green-50 border-green-200' : article.rankScore >= 60 ? 'bg-yellow-50 border-yellow-200' : 'bg-red-50 border-red-200'}`}>
                          <div className="flex items-center justify-between mb-1.5">
                            <div>
                              <p className="text-xs font-semibold text-gray-900">RANK Score</p>
                              <p className="text-[10px] text-gray-400">SEO + AEO + GEO</p>
                            </div>
                            <div className={`text-2xl font-bold ${article.rankScore >= 80 ? 'text-green-600' : article.rankScore >= 60 ? 'text-yellow-600' : 'text-red-600'}`}>{article.rankScore}</div>
                          </div>
                          <div className="w-full bg-gray-200 rounded-full h-1.5">
                            <div className={`h-1.5 rounded-full ${article.rankScore >= 80 ? 'bg-green-500' : article.rankScore >= 60 ? 'bg-yellow-500' : 'bg-red-500'}`} style={{ width: `${article.rankScore}%` }} />
                          </div>
                        </div>

                        <div className="grid grid-cols-3 gap-1.5 mt-2">
                          {article.factDensity && (
                            <div className="p-2 bg-gray-50 rounded border border-gray-200 text-center">
                              <div className={`text-base font-bold ${article.factDensity.grade === 'A' ? 'text-green-600' : article.factDensity.grade === 'B' ? 'text-blue-600' : 'text-orange-600'}`}>{article.factDensity.grade}</div>
                              <div className="text-[9px] text-gray-400">Facts/100w</div>
                            </div>
                          )}
                          <div className="p-2 bg-gray-50 rounded border border-gray-200 text-center">
                            <div className={`text-base font-bold ${article.answerFirst ? 'text-green-600' : 'text-red-500'}`}>{article.answerFirst ? '✓' : '✗'}</div>
                            <div className="text-[9px] text-gray-400">Ans. first</div>
                          </div>
                          <div className="p-2 bg-gray-50 rounded border border-gray-200 text-center">
                            <div className={`text-base font-bold ${(article.faqs?.length ?? 0) >= 4 ? 'text-green-600' : 'text-orange-500'}`}>{article.faqs?.length ?? 0}</div>
                            <div className="text-[9px] text-gray-400">FAQs</div>
                          </div>
                        </div>

                        {article.hasSchema && (
                          <div className="flex items-center gap-1.5 mt-2 px-2 py-1.5 bg-purple-50 rounded border border-purple-200">
                            <span className="text-[10px] text-purple-600 font-medium">JSON-LD schema generated</span>
                          </div>
                        )}

                        {/* Canonical URL */}
                        {(() => {
                          const slug = (article.seoTitle || seedKeyword).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80)
                          const canonicalUrl = `${userProfile?.website_url || 'https://yourdomain.com'}/blog/${slug}`
                          return (
                            <div className="flex items-center gap-1.5 mt-2 px-2 py-1.5 bg-gray-50 rounded border border-gray-200">
                              <span className="text-[9px] text-gray-500 font-medium flex-shrink-0">Canonical:</span>
                              <code className="text-[9px] text-gray-600 truncate flex-1 min-w-0">{canonicalUrl}</code>
                              <button
                                onClick={() => navigator.clipboard.writeText(canonicalUrl)}
                                className="text-[9px] text-orange-600 hover:text-orange-700 flex-shrink-0 font-medium"
                              >
                                Copy
                              </button>
                            </div>
                          )
                        })()}

                        {article.factDensity && article.factDensity.suggestions.length > 0 && (
                          <div className="mt-2 p-2 bg-amber-50 rounded border border-amber-200">
                            {article.factDensity.suggestions.slice(0, 2).map((s, i) => (
                              <p key={i} className="text-[9px] text-amber-700 leading-tight">• {s}</p>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    <div className="mt-4 pt-4 border-t border-[#E8E8E4] space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-[#6B6B6B] text-xs">Word Count</span>
                        <span className="text-[#0F0F0F] text-sm font-semibold">{article.wordCount.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-[#6B6B6B] text-xs">Keyword Density</span>
                        <div className="flex items-center gap-1.5">
                          <span className={`text-sm font-semibold ${parseFloat(String(article.keywordDensity)) >= 0.5 && parseFloat(String(article.keywordDensity)) <= 3 ? "text-[#22c55e]" : "text-[#ef4444]"}`}>
                            {article.keywordDensity}{typeof article.keywordDensity === "number" ? "%" : ""}
                          </span>
                          {(parseFloat(String(article.keywordDensity)) < 0.5 || parseFloat(String(article.keywordDensity)) > 3) && (improveCounts['keyword'] ?? 0) < 3 && (
                            <button
                              onClick={() => handleImproveScore('keyword', parseFloat(String(article.keywordDensity)))}
                              disabled={improvingScore !== null}
                              className="text-[9px] text-[#FF6B2C] hover:text-[#E85A1E] disabled:opacity-40 transition-colors"
                              title="Fix keyword density"
                            >
                              ↻
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {imageStats && imageStats.failures.length > 0 && (
                    <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '8px', padding: '10px 14px', marginBottom: '12px', fontSize: '12px', color: '#DC2626' }}>
                      ⚠️ {imageStats.generated} of {imageStats.requested} images generated — {imageStats.failures.length} failed
                      <button
                        onClick={handleGenerateImages}
                        disabled={imagesLoading}
                        className="block mt-1 text-[11px] underline text-red-700 hover:text-red-900 disabled:opacity-50"
                      >
                        {imagesLoading ? 'Regenerating…' : 'Regenerate images'}
                      </button>
                    </div>
                  )}
                  {article.aiScore != null && article.aiScore < 70 && (
                    <div style={{ background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: '8px', padding: '12px 16px', marginBottom: '12px', fontSize: '13px', color: '#92400E' }}>
                      <strong>⚠️ AI Visibility score: {article.aiScore}/100</strong> — below the 70-point threshold.
                      {article.aiScore < 50 && ' Consider adding more question-format headings and 134-167 word answer blocks.'}
                    </div>
                  )}
                  {article.searchScore != null && article.aiScore != null && article.aiScore >= 70 && (
                    <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: '8px', padding: '10px 14px', marginBottom: '12px', fontSize: '12px', color: '#15803D' }}>
                      ✅ <strong>Search SEO: {article.searchScore}/100 · AI Visibility: {article.aiScore}/100</strong> — article is AI-ready
                    </div>
                  )}
                  {article.humanScore != null && (
                    <div style={{ background: article.passesDetection ? '#F5F3FF' : '#FFF7ED', border: `1px solid ${article.passesDetection ? '#DDD6FE' : '#FED7AA'}`, borderRadius: '8px', padding: '10px 14px', marginBottom: '12px', fontSize: '12px', color: article.passesDetection ? '#5B21B6' : '#92400E' }}>
                      {article.passesDetection ? '✅' : '⚠️'} <strong>Human Score: {article.humanScore}/100</strong> — {article.passesDetection ? 'Passes AI detection' : 'May trigger AI detection'}
                      {article.bannedWordsRemoved && article.bannedWordsRemoved.length > 0 && (
                        <div style={{ marginTop: '4px', fontSize: '11px', opacity: 0.8 }}>
                          {article.bannedWordsRemoved.length} AI phrases removed
                        </div>
                      )}
                    </div>
                  )}
                  {article.llmsTxtEntry && (
                    <div style={{ background: '#F5F3FF', border: '1px solid #DDD6FE', borderRadius: '8px', padding: '10px 14px', marginBottom: '12px', fontSize: '11px' }}>
                      <div style={{ fontWeight: 700, color: '#6D28D9', marginBottom: '4px' }}>🤖 Suggested llms.txt entry for this article:</div>
                      <pre style={{ margin: 0, color: '#4C1D95', fontFamily: 'monospace', whiteSpace: 'pre-wrap' as const, fontSize: '10px' }}>{article.llmsTxtEntry}</pre>
                    </div>
                  )}
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

        {/* ── HUMANIZE view ── */}
        {activeNav === "humanize" && (
          <div className="max-w-4xl mx-auto px-8 py-8">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-2xl font-bold mb-1">Humanize Article</h1>
                <p className="text-[#6B6B6B] text-sm">Remove AI patterns and score for human detection. Preserves all SEO signals.</p>
              </div>
            </div>

            <div className="bg-white border border-[#E8E8E4] rounded-[10px] p-6 mb-6">
              <div className="flex items-center gap-4 mb-4 flex-wrap">
                <div className="flex-1 min-w-[200px]">
                  <label className="block text-xs font-semibold text-[#374151] mb-1.5">Humanization Level</label>
                  <div className="flex gap-2">
                    {(['light', 'medium', 'aggressive'] as const).map(lvl => (
                      <button
                        key={lvl}
                        onClick={() => setHumanizeLevel(lvl)}
                        className={`px-3 py-1.5 rounded-[6px] text-xs font-semibold capitalize transition-colors ${humanizeLevel === lvl ? 'bg-[#7C3AED] text-white' : 'bg-[#F5F4F1] text-[#374151] hover:bg-[#E8E8E4]'}`}
                      >
                        {lvl === 'light' ? '⚡ Light' : lvl === 'medium' ? '🔧 Medium' : '🔥 Aggressive'}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="w-48">
                  <label className="block text-xs font-semibold text-[#374151] mb-1.5">Primary Keyword</label>
                  <input
                    type="text"
                    value={humanizeKeyword}
                    onChange={e => setHumanizeKeyword(e.target.value)}
                    placeholder={seedKeyword || 'optional'}
                    className="w-full px-3 py-1.5 text-sm border border-[#E8E8E4] rounded-[6px] outline-none focus:border-[#7C3AED]"
                  />
                </div>
              </div>

              <label className="block text-xs font-semibold text-[#374151] mb-1.5">Article HTML</label>
              <textarea
                value={humanizeInput || (article?.article ?? '')}
                onChange={e => setHumanizeInput(e.target.value)}
                placeholder="Paste HTML article here, or generate an article first..."
                className="w-full h-48 px-3 py-2.5 text-sm border border-[#E8E8E4] rounded-[8px] outline-none focus:border-[#7C3AED] resize-none font-mono"
              />

              <div className="flex items-center gap-3 mt-4">
                <button
                  onClick={handleHumanize}
                  disabled={humanizeLoading || (!humanizeInput.trim() && !article?.article)}
                  className="bg-[#7C3AED] hover:bg-[#6D28D9] text-white font-semibold text-sm px-6 py-2.5 rounded-[8px] transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {humanizeLoading && (
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  )}
                  {humanizeLoading
                    ? humanizeLevel === 'light' ? 'Lightly humanizing…' : humanizeLevel === 'medium' ? 'Humanizing…' : 'Aggressively humanizing…'
                    : '✍️ Humanize Article'}
                </button>
                {article && !humanizeInput && (
                  <span className="text-xs text-[#6B6B6B]">Using current article</span>
                )}
              </div>

              {humanizeError && (
                <div className="mt-3 text-sm text-[#ef4444]">{humanizeError}</div>
              )}
            </div>

            {humanizeLoading && (
              <div className="bg-white border border-[#E8E8E4] rounded-[10px] p-8 text-center">
                <div className="text-3xl mb-4">✍️</div>
                <p className="text-[#6B6B6B] text-sm mb-1">
                  {humanizeLevel === 'light' ? 'Running quick humanization pass…' : humanizeLevel === 'medium' ? 'Rewriting with Claude Sonnet…' : 'Deep rewriting for maximum humanization…'}
                </p>
                <div className="flex gap-2 justify-center mt-4 text-xs text-[#9b9b9b]">
                  <span>Layer 1: removing AI phrases</span>
                  <span>→</span>
                  <span>Layer 2: extracting SEO signals</span>
                  <span>→</span>
                  <span>Layer 3: rewriting</span>
                  <span>→</span>
                  <span>Layer 4: re-injecting SEO</span>
                  <span>→</span>
                  <span>Layer 5: scoring</span>
                </div>
              </div>
            )}

            {humanizeResult && !humanizeLoading && (
              <div className="space-y-5">
                {/* Score row */}
                <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                  <div className="bg-white border border-[#E8E8E4] rounded-[10px] p-4 text-center">
                    <div className={`text-3xl font-black ${humanizeResult.humanScore >= 72 ? 'text-[#7C3AED]' : humanizeResult.humanScore >= 50 ? 'text-[#F59E0B]' : 'text-[#ef4444]'}`}>
                      {humanizeResult.humanScore}
                    </div>
                    <div className="text-xs text-[#6B6B6B] mt-1">Human Score /100</div>
                  </div>
                  <div className="bg-white border border-[#E8E8E4] rounded-[10px] p-4 text-center">
                    <div className={`text-2xl font-bold ${humanizeResult.passesDetection ? 'text-[#22c55e]' : 'text-[#ef4444]'}`}>
                      {humanizeResult.passesDetection ? 'Yes' : 'No'}
                    </div>
                    <div className="text-xs text-[#6B6B6B] mt-1">Passes AI Detection</div>
                  </div>
                  <div className="bg-white border border-[#E8E8E4] rounded-[10px] p-4 text-center">
                    <div className="text-2xl font-bold text-[#0F0F0F]">{humanizeResult.bannedWordsRemoved.length}</div>
                    <div className="text-xs text-[#6B6B6B] mt-1">AI Phrases Found</div>
                  </div>
                  <div className="bg-white border border-[#E8E8E4] rounded-[10px] p-4 text-center">
                    <div className="text-2xl font-bold text-[#0F0F0F]">
                      {[humanizeResult.seoPreserved.linksPreserved, humanizeResult.seoPreserved.keywordInFirstParagraph, humanizeResult.seoPreserved.statsPreserved, humanizeResult.seoPreserved.schemaPreserved].filter(Boolean).length}/4
                    </div>
                    <div className="text-xs text-[#6B6B6B] mt-1">SEO Signals Preserved</div>
                  </div>
                </div>

                {/* SEO checklist + banned words */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-white border border-[#E8E8E4] rounded-[10px] p-4">
                    <p className="text-xs font-semibold text-[#6B6B6B] uppercase tracking-wide mb-3">SEO Preservation</p>
                    <div className="space-y-2">
                      {[
                        { label: 'Links preserved', ok: humanizeResult.seoPreserved.linksPreserved },
                        { label: 'Keyword in first paragraph', ok: humanizeResult.seoPreserved.keywordInFirstParagraph },
                        { label: 'Stats & numbers preserved', ok: humanizeResult.seoPreserved.statsPreserved },
                        { label: 'Schema markup preserved', ok: humanizeResult.seoPreserved.schemaPreserved },
                      ].map(({ label, ok }) => (
                        <div key={label} className="flex items-center gap-2 text-sm">
                          <span className={ok ? 'text-[#22c55e]' : 'text-[#ef4444]'}>{ok ? '✅' : '⚠️'}</span>
                          <span className={ok ? 'text-[#0F0F0F]' : 'text-[#6B6B6B]'}>{label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  {humanizeResult.bannedWordsRemoved.length > 0 && (
                    <div className="bg-white border border-[#E8E8E4] rounded-[10px] p-4">
                      <p className="text-xs font-semibold text-[#6B6B6B] uppercase tracking-wide mb-3">AI Phrases Detected</p>
                      <div className="flex flex-wrap gap-1.5">
                        {humanizeResult.bannedWordsRemoved.map(word => (
                          <span key={word} className="bg-[#FEE2E2] text-[#DC2626] text-xs px-2 py-0.5 rounded-[4px] font-medium">
                            {word}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Copy buttons */}
                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(humanizeResult.humanizedHtml).then(() => {
                        setHumanizeCopied(true);
                        setTimeout(() => setHumanizeCopied(false), 2000);
                      }).catch(() => {});
                    }}
                    className="flex-1 py-2.5 bg-[#7C3AED] hover:bg-[#6D28D9] text-white font-semibold text-sm rounded-[8px] transition-colors"
                  >
                    {humanizeCopied ? '✅ Copied!' : '📋 Copy HTML'}
                  </button>
                  <button
                    onClick={() => {
                      const plain = humanizeResult.humanizedHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
                      navigator.clipboard.writeText(plain).catch(() => {});
                    }}
                    className="flex-1 py-2.5 bg-[#F5F4F1] hover:bg-[#E8E8E4] text-[#374151] font-semibold text-sm rounded-[8px] transition-colors"
                  >
                    📄 Copy Plain Text
                  </button>
                </div>

                {/* Humanized HTML preview */}
                <div className="bg-white border border-[#E8E8E4] rounded-[10px] p-6">
                  <p className="text-xs font-semibold text-[#6B6B6B] uppercase tracking-wide mb-4">Humanized Article</p>
                  <div
                    dangerouslySetInnerHTML={{ __html: humanizeResult.humanizedHtml }}
                    style={{ lineHeight: '1.8', fontSize: '15px', color: '#0F0F0F' }}
                    className="article-rendered"
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── IMAGES view ── */}
        {activeNav === "images" && (
          <div className="max-w-6xl mx-auto px-8 py-8">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-2xl font-bold mb-1">Article Images</h1>
                <p className="text-[#6B6B6B] text-sm">Blog-standard AI images (WebP, auto-sized, stored to CDN).</p>
              </div>
              {article && (
                <div className="flex items-center gap-3">
                  {/* Tier selector */}
                  <div className="flex bg-[#F5F5F0] rounded-[8px] p-0.5 text-xs font-semibold">
                    <button
                      onClick={() => setImageTier('free')}
                      className={`px-3 py-1.5 rounded-[6px] transition-colors ${imageTier === 'free' ? 'bg-white text-[#0a0a0a] shadow-sm' : 'text-[#6B6B6B] hover:text-[#0a0a0a]'}`}
                    >
                      Free
                    </button>
                    <button
                      onClick={() => setImageTier('premium')}
                      className={`px-3 py-1.5 rounded-[6px] transition-colors ${imageTier === 'premium' ? 'bg-white text-[#0a0a0a] shadow-sm' : 'text-[#6B6B6B] hover:text-[#0a0a0a]'}`}
                    >
                      Premium ✦
                    </button>
                  </div>
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
                    {imagesLoading ? "Generating…" : images.length > 0 ? "Regenerate" : "Generate Images"}
                  </button>
                </div>
              )}
            </div>

            {/* Tier info */}
            <div className="flex gap-3 mb-6">
              <div className={`flex-1 border rounded-[8px] p-3 text-xs ${imageTier === 'free' ? 'border-[#FF6B2C] bg-[#FFF8F5]' : 'border-[#E8E8E4] bg-white'}`}>
                <p className="font-semibold mb-0.5">Free — Pollinations.ai</p>
                <p className="text-[#6B6B6B]">Flux model · 1200×630 hero · 800×533 content · WebP optimised</p>
              </div>
              <div className={`flex-1 border rounded-[8px] p-3 text-xs ${imageTier === 'premium' ? 'border-[#FF6B2C] bg-[#FFF8F5]' : 'border-[#E8E8E4] bg-white'}`}>
                <p className="font-semibold mb-0.5">Premium — Replicate Flux Schnell</p>
                <p className="text-[#6B6B6B]">Higher quality · Requires REPLICATE_API_TOKEN env var</p>
              </div>
            </div>

            {imageError && (
              <div className="bg-red-50 border border-red-200 rounded-[8px] p-3 text-sm text-red-700 mb-5">
                {imageError}
              </div>
            )}

            {imagesLoading && (
              <div className="bg-white border border-[#E8E8E4] rounded-[10px] p-12 text-center mb-6">
                <svg className="w-8 h-8 animate-spin text-[#FF6B2C] mx-auto mb-3" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <p className="text-sm text-[#6B6B6B]">Generating prompts → fetching images → resizing to WebP → uploading to CDN…</p>
                <p className="text-xs text-[#6B6B6B] mt-1">This takes ~20–40 seconds</p>
              </div>
            )}

            {images.length === 0 && !imagesLoading && (
              <div className="bg-white border border-[#E8E8E4] rounded-[10px] p-16 text-center">
                <svg className="w-12 h-12 text-[#2a2a2a] mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <p className="text-[#6B6B6B] mb-4">
                  {article ? "Generate blog-standard images for your article" : "Generate an article first"}
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

            {images.length > 0 && !imagesLoading && (
              <>
                {/* Storage confirmation badge */}
                {imageStored && (
                  <div className="flex items-center gap-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-[8px] px-3 py-2 mb-5 w-fit">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Images resized to WebP and stored to Supabase CDN
                  </div>
                )}
                {injectedArticleHtml && (
                  <div className="flex items-center gap-2 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-[8px] px-3 py-2 mb-5 w-fit">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    Hero + content images injected into article HTML with srcset
                  </div>
                )}

                <div className="grid md:grid-cols-3 gap-5">
                  {images.map((img) => (
                    <div key={img.id} className="bg-white border border-[#E8E8E4] rounded-[10px] overflow-hidden">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={img.url}
                        alt={img.altText || img.alt || ''}
                        className="w-full aspect-video object-cover bg-[#FAFAF8]"
                        loading="lazy"
                      />
                      <div className="p-4">
                        <div className="flex items-center justify-between mb-1.5">
                          <p className="text-[#6B6B6B] text-[10px] uppercase tracking-wide font-medium">{img.placement}</p>
                          {img.width && img.height && (
                            <span className="text-[10px] text-[#6B6B6B] bg-[#F5F5F0] px-1.5 py-0.5 rounded font-mono">
                              {img.width}×{img.height}
                            </span>
                          )}
                        </div>
                        <p className="text-sm font-medium mb-2">{img.caption}</p>
                        <p className="text-[#6B6B6B] text-xs leading-relaxed line-clamp-2">Alt: {img.altText || img.alt}</p>
                        {img.url && (
                          <a
                            href={img.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-2 text-[11px] text-[#FF6B2C] hover:underline block truncate"
                          >
                            {img.url.includes('supabase') ? 'View on CDN ↗' : 'View image ↗'}
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </>
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

            {/* Organisation / Publisher Schema Settings */}
            {userProfile && (
              <div className="bg-white border border-[#E8E8E4] rounded-[10px] p-6 mt-5">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-[#6B6B6B] mb-5">GEO Schema</h2>
                <OrganisationSchemaSettings
                  initial={{
                    org_name: userProfile.org_name,
                    org_url: userProfile.org_url,
                    org_description: userProfile.org_description,
                    org_linkedin: userProfile.org_linkedin,
                    org_twitter: userProfile.org_twitter,
                    org_github: userProfile.org_github,
                    org_address_country: userProfile.org_address_country,
                    org_founding_year: userProfile.org_founding_year != null ? String(userProfile.org_founding_year) : '',
                  }}
                  onSave={async (data) => {
                    const supabase = createClient();
                    const { data: { user } } = await supabase.auth.getUser();
                    if (!user) return;
                    await supabase.from('profiles').upsert({
                      id: user.id,
                      org_name: data.org_name || null,
                      org_url: data.org_url || null,
                      org_description: data.org_description || null,
                      org_linkedin: data.org_linkedin || null,
                      org_twitter: data.org_twitter || null,
                      org_github: data.org_github || null,
                      org_address_country: data.org_address_country || 'GB',
                      org_founding_year: data.org_founding_year ? parseInt(data.org_founding_year) : null,
                    });
                    await refreshUserProfile();
                  }}
                />
              </div>
            )}
          </div>
        )}

      </main>

      {/* ── Cluster Side Panel ── */}
      {clusterPanelOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40"
          onClick={() => setClusterPanelOpen(false)}
        />
      )}
      <div
        className="fixed top-0 right-0 h-full bg-white shadow-2xl z-50 flex flex-col w-full md:w-2/5"
        style={{ transform: clusterPanelOpen ? 'translateX(0)' : 'translateX(100%)', transition: 'transform 0.3s ease' }}
      >
        {/* Panel Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E8E8E4] flex-shrink-0">
          <div className="flex items-center gap-2 flex-1 min-w-0 mr-3">
            <svg className="w-4 h-4 text-[#FF6B2C] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h8m-8 6h16" />
            </svg>
            <input
              value={panelClusterName}
              onChange={e => setPanelClusterName(e.target.value)}
              className="text-sm font-bold text-[#0F0F0F] bg-transparent border-0 border-b border-transparent focus:border-[#FF6B2C] focus:outline-none px-1 py-0.5 w-full"
              placeholder="Cluster name…"
            />
          </div>
          <button
            onClick={() => setClusterPanelOpen(false)}
            className="text-[#6B6B6B] hover:text-[#0F0F0F] transition-colors p-1 flex-shrink-0"
            aria-label="Close panel"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Keywords chips */}
        <div className="flex-1 overflow-y-auto p-5">
          <p className="text-xs text-[#6B6B6B] font-medium uppercase tracking-wide mb-3">
            {panelKeywords.length} keyword{panelKeywords.length !== 1 ? 's' : ''} · click any keyword to set as primary
          </p>
          <div className="flex flex-wrap gap-2 mb-4">
            {panelKeywords.map(pk => {
              const isPrimary = pk.keyword === panelPrimaryKeyword;
              return (
                <span
                  key={pk.keyword}
                  className={`inline-flex items-center gap-1.5 border rounded-[8px] px-2.5 py-1.5 text-xs transition-colors ${
                    isPrimary
                      ? 'bg-[#FFF0E8] border-[#FF6B2C]/50 text-[#CC4A0F]'
                      : 'bg-[#FAFAF8] border-[#E8E8E4] text-[#0F0F0F] hover:border-[#FF6B2C]/30'
                  }`}
                >
                  {isPrimary && <span className="text-[9px] font-bold text-[#FF6B2C]">⭐ PRIMARY</span>}
                  <button
                    className="font-medium hover:text-[#FF6B2C] transition-colors"
                    onClick={() => setPanelPrimaryKeyword(pk.keyword)}
                    title="Set as primary keyword"
                  >
                    {pk.keyword}
                  </button>
                  {pk.volume > 0 && (
                    <span className="text-[9px] text-[#9B9B9B]">{pk.volume.toLocaleString()}/mo</span>
                  )}
                  {pk.kd > 0 && <KdBadge kd={pk.kd} />}
                  <button
                    onClick={() => {
                      const updated = panelKeywords.filter(k => k.keyword !== pk.keyword);
                      setPanelKeywords(updated);
                      if (isPrimary && updated.length > 0) setPanelPrimaryKeyword(updated[0].keyword);
                    }}
                    className="text-[#9B9B9B] hover:text-[#ef4444] transition-colors leading-none ml-0.5"
                    aria-label={`Remove ${pk.keyword}`}
                  >×</button>
                </span>
              );
            })}
          </div>

          {/* Add keyword input */}
          <div className="flex gap-2">
            <input
              type="text"
              value={panelAddKwInput}
              onChange={e => setPanelAddKwInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handlePanelAddKeyword(); }}
              placeholder="+ Add keyword…"
              className="flex-1 bg-[#FAFAF8] border border-[#E8E8E4] rounded-[8px] px-3 py-2 text-sm text-[#0F0F0F] placeholder-[#9B9B9B] focus:outline-none focus:border-[#FF6B2C]/50"
            />
            <button
              onClick={handlePanelAddKeyword}
              className="bg-[#FF6B2C] hover:bg-[#E85A1E] text-[#0a0a0a] font-bold text-sm px-3 py-2 rounded-[8px] transition-colors"
            >+</button>
          </div>
        </div>

        {/* Panel Footer — settings + action buttons */}
        <div className="border-t border-[#E8E8E4] p-5 flex-shrink-0 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-[#6B6B6B] text-[10px] font-medium uppercase tracking-wide block mb-1.5">Words</label>
              <select
                value={wordCount}
                onChange={e => setWordCount(Number(e.target.value))}
                className="w-full bg-[#FAFAF8] border border-[#E8E8E4] rounded-[8px] px-2.5 py-2 text-sm text-[#0F0F0F] focus:outline-none focus:border-[#FF6B2C]/50"
              >
                {[1000, 1500, 2000, 2500, 3000].map(n => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[#6B6B6B] text-[10px] font-medium uppercase tracking-wide block mb-1.5">Tone</label>
              <select
                value={tone}
                onChange={e => setTone(e.target.value as Tone)}
                className="w-full bg-[#FAFAF8] border border-[#E8E8E4] rounded-[8px] px-2.5 py-2 text-sm text-[#0F0F0F] focus:outline-none focus:border-[#FF6B2C]/50"
              >
                <option value="professional">Professional</option>
                <option value="conversational">Conversational</option>
                <option value="authoritative">Authoritative</option>
                <option value="friendly">Friendly</option>
              </select>
            </div>
            <div>
              <label className="text-[#6B6B6B] text-[10px] font-medium uppercase tracking-wide block mb-1.5">Market</label>
              <select
                value={country}
                onChange={e => setCountry(e.target.value as Country)}
                className="w-full bg-[#FAFAF8] border border-[#E8E8E4] rounded-[8px] px-2.5 py-2 text-sm text-[#0F0F0F] focus:outline-none focus:border-[#FF6B2C]/50"
              >
                {ALL_COUNTRIES.map(c => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
          </div>

          {panelPrimaryKeyword && (
            <p className="text-xs text-[#6B6B6B]">
              Primary: <span className="text-[#FF6B2C] font-semibold">{panelPrimaryKeyword}</span>
              {panelKeywords.length > 1 && <span> + {panelKeywords.length - 1} secondary keywords</span>}
            </p>
          )}

          <InternalLinksPanel links={internalLinks} onChange={setInternalLinks} />

          <div className="flex gap-3">
            <button
              onClick={handlePanelGenerateArticle}
              disabled={panelKeywords.length === 0}
              className="flex-1 bg-[#FF6B2C] hover:bg-[#E85A1E] disabled:opacity-50 disabled:cursor-not-allowed text-[#0a0a0a] font-bold text-sm px-4 py-3 rounded-[8px] transition-colors"
            >
              Generate Article →
            </button>
            <button
              onClick={handlePanelCompetitorArticle}
              disabled={panelKeywords.length === 0}
              className="flex-1 bg-gradient-to-r from-[#FF6B2C] to-[#FF9A2C] hover:from-[#E85A1E] hover:to-[#E8881E] disabled:opacity-50 disabled:cursor-not-allowed text-[#0a0a0a] font-bold text-sm px-4 py-3 rounded-[8px] transition-all shadow-sm"
            >
              🏆 Competitor Article →
            </button>
          </div>
        </div>
      </div>

    </div>
  );
}
