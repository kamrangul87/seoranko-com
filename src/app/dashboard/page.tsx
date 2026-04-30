"use client";

import { useState, useEffect } from "react";
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
          <span className="text-xs font-bold text-[#fafafa] leading-none">{displayScore}</span>
          <span className="text-[8px] text-[#6b7280] leading-none">/100</span>
        </span>
      </div>
      <span className="text-[10px] text-[#6b7280] text-center leading-tight">{label}</span>
    </div>
  );
}

// ─── Article Renderer ────────────────────────────────────────────────────────

function ArticleRenderer({ text }: { text: string }) {
  const lines = text.split("\n");

  const tocStart = lines.findIndex((l) => l.trim().match(/^##\s+Table of Contents/i));
  const tocItems: { label: string; anchor: string }[] = [];
  let tocEnd = tocStart + 1;

  if (tocStart !== -1) {
    while (tocEnd < lines.length) {
      const m = lines[tocEnd].match(/^-\s+\[([^\]]+)\]\(#([^)]+)\)/);
      if (m) { tocItems.push({ label: m[1], anchor: m[2] }); tocEnd++; }
      else if (lines[tocEnd].trim() === "") { tocEnd++; }
      else break;
    }
  }

  function renderInline(str: string): React.ReactNode[] {
    const parts = str.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g);
    return parts.map((part, i) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return <strong key={i} className="text-[#fafafa] font-semibold">{part.slice(2, -2)}</strong>;
      }
      const lm = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (lm) {
        return <a key={i} href={lm[2]} target="_blank" rel="noopener noreferrer" className="text-[#f59e0b] hover:underline">{lm[1]}</a>;
      }
      return <span key={i}>{part}</span>;
    });
  }

  const contentLines: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (tocStart !== -1 && i >= tocStart && i < tocEnd) continue;
    contentLines.push(lines[i]);
  }

  const elements: React.ReactNode[] = [];

  if (tocItems.length > 0) {
    elements.push(
      <div key="toc" className="bg-[#0a0a0a] border border-[#f59e0b]/20 rounded-[10px] p-5 mb-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-[#f59e0b] mb-3">Table of Contents</p>
        <ol className="space-y-1.5">
          {tocItems.map((item, idx) => (
            <li key={idx}>
              <a
                href={`#${item.anchor}`}
                onClick={(e) => {
                  e.preventDefault();
                  document.getElementById(item.anchor)?.scrollIntoView({ behavior: "smooth" });
                }}
                className="text-sm text-[#6b7280] hover:text-[#f59e0b] transition-colors flex items-center gap-2"
              >
                <span className="text-[#f59e0b] text-xs font-semibold w-4 flex-shrink-0">{idx + 1}.</span>
                {item.label}
              </a>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  contentLines.forEach((line, i) => {
    if (line.startsWith("## ")) {
      const heading = line.slice(3).trim();
      const id = heading.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      elements.push(
        <h2 key={`h2-${i}`} id={id} className="text-[#fafafa] font-bold text-lg mb-3 mt-8 scroll-mt-6">
          {heading}
        </h2>
      );
    } else if (line.startsWith("### ")) {
      elements.push(
        <h3 key={`h3-${i}`} className="text-[#fafafa] font-semibold mb-2 mt-5">
          {line.slice(4).trim()}
        </h3>
      );
    } else if (line.match(/^[-*]\s+/)) {
      elements.push(
        <div key={`li-${i}`} className="flex gap-2 mb-1.5 ml-1">
          <span className="text-[#f59e0b] text-xs mt-1 flex-shrink-0">•</span>
          <span className="text-sm text-[#6b7280] leading-relaxed">{renderInline(line.replace(/^[-*]\s+/, ""))}</span>
        </div>
      );
    } else if (line.trim() !== "") {
      elements.push(
        <p key={`p-${i}`} className="text-sm text-[#6b7280] mb-4 leading-7">
          {renderInline(line.trim())}
        </p>
      );
    }
  });

  return <div>{elements}</div>;
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
  const [nlpBrief, setNlpBrief] = useState<{ keyword: string; tone: string } | null>(null);

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

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    refreshUserProfile();
    // Pre-fill from NLP Analyser deep-link
    const params = new URLSearchParams(window.location.search);
    const kwParam = params.get("keyword");
    const toneParam = params.get("tone");
    const briefParam = params.get("brief");
    if (kwParam) {
      setSeedKeyword(kwParam);
      setActiveNav("articles");
      if (briefParam) {
        setNlpBrief({ keyword: kwParam, tone: toneParam ?? "professional" });
      }
    }
  }, []);

  async function handleSignOut() {
    await fetch("/api/auth/signout", { method: "POST" });
    window.location.href = "/login";
  }

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
  const [editingCluster, setEditingCluster] = useState<string | null>(null);
  const [clusterEdits, setClusterEdits] = useState<Record<string, string[]>>({});
  const [newKwInputs, setNewKwInputs] = useState<Record<string, string>>({});

  // Article settings
  const [wordCount, setWordCount] = useState(1000);
  const [tone, setTone] = useState<Tone>("professional");
  const [audience, setAudience] = useState("marketing professionals");
  const [articleLoading, setArticleLoading] = useState(false);
  const [articleStage, setArticleStage] = useState("");
  const [articleProgress, setArticleProgress] = useState(0);
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

  // ── Article generation ────────────────────────────────────────────────────
  async function handleGenerateArticle() {
    const editedKws = selectedCluster ? getClusterKeywords(selectedCluster) : null;
    const kw = editedKws?.[0] ?? seedKeyword;
    if (!kw) return;
    setArticleLoading(true);
    setArticle(null);
    setResearch(null);
    setArticleStage("Connecting…");
    setArticleProgress(5);

    // Fake progress timer — increments toward stage caps until SSE updates take over
    const progressRef = { value: 5 };
    const progressTimer = setInterval(() => {
      progressRef.value = Math.min(progressRef.value + 0.6, 88);
      setArticleProgress(Math.round(progressRef.value));
    }, 600);

    const clusterToSend = selectedCluster
      ? { ...selectedCluster, keywords: editedKws ?? selectedCluster.keywords }
      : null;

    try {
      const res = await fetch("/api/article", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keyword: kw,
          cluster: clusterToSend,
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
          if (data.stage) {
            setArticleStage(data.stage);
            // Map known stages to progress targets
            if (data.stage.startsWith("Writing your")) { progressRef.value = Math.max(progressRef.value, 20); setArticleProgress(20); }
            if (data.stage.startsWith("Writing…"))     { progressRef.value = Math.max(progressRef.value, 40); }
            if (data.stage.startsWith("Finalising"))   { progressRef.value = 90; setArticleProgress(90); }
          }
          if (data.error) throw new Error(data.error);
          if (data.done) {
            clearInterval(progressTimer);
            setArticleProgress(100);
            setResearch(data.research);
            setArticle(data.article);
            setActiveNav("articles");
            refreshUserProfile();
          }
        }
      }
    } catch (e) {
      clearInterval(progressTimer);
      alert(e instanceof Error ? e.message : "Article generation failed");
    } finally {
      setArticleLoading(false);
      setArticleStage("");
      setTimeout(() => setArticleProgress(0), 800);
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
          {NAV_ITEMS.map(({ id, label, icon, href }) =>
            href ? (
              <Link
                key={id}
                href={href}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-[8px] text-sm font-medium transition-colors text-[#6b7280] hover:text-[#fafafa] hover:bg-[#111111]"
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
                    ? "bg-[#f59e0b]/10 text-[#f59e0b]"
                    : "text-[#6b7280] hover:text-[#fafafa] hover:bg-[#111111]"
                }`}
              >
                {icon}
                {label}
              </button>
            )
          )}
        </nav>

        {/* Usage */}
        <div className="px-4 py-4 border-t border-[#1f1f1f]">
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
                <p className="text-[10px] text-[#6b7280] mb-1.5 uppercase tracking-wide font-medium">Usage</p>
                {rows.map(({ label, used, max, period }) => {
                  const isUnlimited = max === Infinity;
                  const periodLabel = period === "lifetime" ? "lifetime" : period === "day" ? "today" : "mo";
                  return (
                    <div key={label}>
                      <div className="flex justify-between text-[10px] text-[#6b7280] mb-1">
                        <span>{label}</span>
                        <span>{isUnlimited ? "∞" : `${used}/${max} ${periodLabel}`}</span>
                      </div>
                      {!isUnlimited && (
                        <div className="h-1 bg-[#1f1f1f] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-[#f59e0b] rounded-full"
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
              <div className="h-1 bg-[#1f1f1f] rounded-full animate-pulse" />
              <div className="h-1 bg-[#1f1f1f] rounded-full animate-pulse" />
            </div>
          )}
        </div>

        {/* User / Sign out */}
        <div className="px-4 py-3 border-t border-[#1f1f1f]">
          {userProfile && (
            <div className="flex items-center gap-2.5 mb-2.5">
              <div className="w-7 h-7 rounded-full bg-[#f59e0b]/20 flex items-center justify-center flex-shrink-0">
                <span className="text-[#f59e0b] text-xs font-bold uppercase">
                  {userProfile.name?.[0] ?? userProfile.email[0]}
                </span>
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-[#fafafa] truncate">{userProfile.name || userProfile.email}</p>
                <span className="inline-block text-[9px] font-bold uppercase tracking-wide text-[#f59e0b] bg-[#f59e0b]/10 px-1.5 py-0.5 rounded-full">
                  {(PLAN_USAGE[userProfile.plan] ?? PLAN_USAGE.free).label}
                </span>
              </div>
            </div>
          )}
          <button
            onClick={handleSignOut}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-[8px] text-xs font-medium text-[#6b7280] hover:text-[#fafafa] hover:bg-[#111111] transition-colors"
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
                        {["Keyword", "Volume", "KD", "CPC", "Intent", "Trend", ""].map((col) => (
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
                          <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                            <Link
                              href={`/dashboard/nlp?keyword=${encodeURIComponent(kw.keyword)}&location_code=${country === "UK" ? 2826 : country === "US" ? 2840 : 0}`}
                              className="text-xs font-semibold text-[#f59e0b] hover:text-[#d97706] transition-colors whitespace-nowrap"
                            >
                              NLP →
                            </Link>
                          </td>
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
                  {clusters.map((cluster) => {
                    const isSelected = selectedCluster?.name === cluster.name;
                    const isEditing = editingCluster === cluster.name;
                    const kws = getClusterKeywords(cluster);
                    return (
                      <div
                        key={cluster.name}
                        className={`bg-[#111111] border rounded-[10px] p-5 transition-all ${
                          isSelected ? "border-[#f59e0b] shadow-lg shadow-amber-500/10" : "border-[#1f1f1f] hover:border-[#f59e0b]/40"
                        }`}
                      >
                        {/* Header row */}
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
                              <p className="text-[#f59e0b] font-bold text-lg leading-none">{cluster.opportunity}</p>
                              <p className="text-[#6b7280] text-[10px]">score</p>
                            </div>
                            <button
                              onClick={(e) => { e.stopPropagation(); setEditingCluster(isEditing ? null : cluster.name); }}
                              className="text-[#6b7280] hover:text-[#fafafa] p-1 rounded transition-colors"
                              title="Edit keywords"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                            </button>
                          </div>
                        </div>

                        {/* Keyword tags */}
                        <div className="flex flex-wrap gap-1.5 mb-3">
                          {kws.map((kw) => (
                            <span
                              key={kw}
                              className="inline-flex items-center gap-1 bg-[#0a0a0a] border border-[#1f1f1f] rounded-[6px] px-2 py-0.5 text-[11px] text-[#6b7280]"
                            >
                              {kw}
                              {isEditing && (
                                <button
                                  onClick={() => removeKeywordFromCluster(cluster.name, kw)}
                                  className="text-[#6b7280] hover:text-[#ef4444] leading-none ml-0.5"
                                >×</button>
                              )}
                            </span>
                          ))}
                        </div>

                        {/* Edit input */}
                        {isEditing && (
                          <div className="flex gap-1.5 mt-2">
                            <input
                              type="text"
                              value={newKwInputs[cluster.name] ?? ""}
                              onChange={(e) => setNewKwInputs((prev) => ({ ...prev, [cluster.name]: e.target.value }))}
                              onKeyDown={(e) => { if (e.key === "Enter") addKeywordToCluster(cluster.name); }}
                              placeholder="Add keyword…"
                              className="flex-1 bg-[#0a0a0a] border border-[#1f1f1f] rounded-[6px] px-2.5 py-1.5 text-xs text-[#fafafa] placeholder-[#6b7280] focus:outline-none focus:border-[#f59e0b]/50"
                            />
                            <button
                              onClick={() => addKeywordToCluster(cluster.name)}
                              className="bg-[#f59e0b] hover:bg-[#d97706] text-[#0a0a0a] font-bold text-xs px-2.5 py-1.5 rounded-[6px] transition-colors"
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

                {articleLoading && (
                  <div className="mb-5">
                    <div className="flex justify-between items-center mb-1.5">
                      <span className="text-xs text-[#6b7280]">{articleStage || "Generating…"}</span>
                      <span className="text-xs text-[#f59e0b] font-semibold">{articleProgress}%</span>
                    </div>
                    <div className="h-1.5 bg-[#0a0a0a] rounded-full overflow-hidden border border-[#1f1f1f]">
                      <div
                        className="h-full bg-[#f59e0b] rounded-full transition-all duration-500"
                        style={{ width: `${articleProgress}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[10px] text-[#6b7280] mt-1">
                      <span>Researching</span>
                      <span>Writing</span>
                      <span>Reviewing</span>
                    </div>
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
            {nlpBrief && (
              <div className="flex items-center justify-between bg-[#f59e0b]/10 border border-[#f59e0b]/30 rounded-[10px] px-4 py-3 mb-6">
                <div className="flex items-center gap-3">
                  <svg className="w-4 h-4 text-[#f59e0b] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                  <div>
                    <p className="text-sm font-semibold text-[#f59e0b]">Brief imported from NLP Analyser</p>
                    <p className="text-xs text-[#9ca3af]">Keyword pre-filled: <span className="text-[#fafafa]">{nlpBrief.keyword}</span></p>
                  </div>
                </div>
                <button onClick={() => setNlpBrief(null)} className="text-[#6b7280] hover:text-[#fafafa] transition-colors">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            )}
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
                    <ArticleRenderer text={article.article} />
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
                    defaultValue={userProfile?.name ?? ""}
                    readOnly
                    className="w-full bg-[#0a0a0a] border border-[#1f1f1f] rounded-[8px] px-3 py-2.5 text-sm text-[#fafafa] cursor-not-allowed"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">Email</label>
                  <input
                    type="email"
                    defaultValue={userProfile?.email ?? ""}
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
                    {(PLAN_USAGE[userProfile?.plan ?? "free"] ?? PLAN_USAGE.free).label}
                  </span>
                </div>
                {(userProfile?.plan === "free" || userProfile?.plan === "starter") && (
                  <button className="bg-[#f59e0b] hover:bg-[#d97706] text-[#0a0a0a] font-semibold text-sm px-5 py-2.5 rounded-[10px] transition-colors">
                    Upgrade Plan
                  </button>
                )}
              </div>
              {userProfile?.plan === "free" && (
                <div className="bg-[#0a0a0a] border border-[#1f1f1f] rounded-[8px] p-4 text-xs text-[#6b7280]">
                  Upgrade to <span className="text-[#fafafa] font-medium">Starter £19/mo</span> for 500 keyword searches and 30 articles per month.
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
                <div className="bg-[#111111] border border-[#1f1f1f] rounded-[10px] p-6">
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-[#6b7280] mb-5">
                    Usage
                  </h2>
                  <div className="space-y-5">
                    {rows.map(({ label, used, limit }) => {
                      const pct = unlimited ? 0 : Math.min(100, Math.round((used / limit) * 100));
                      const barColor = pct >= 100 ? "#ef4444" : pct >= 75 ? "#f59e0b" : "#22c55e";
                      return (
                        <div key={label}>
                          <div className="flex justify-between items-center mb-1.5">
                            <span className="text-sm font-medium">{label}</span>
                            <span className="text-xs text-[#6b7280]">
                              {unlimited ? `${used} / ∞` : `${used} / ${limit}`}
                            </span>
                          </div>
                          {!unlimited && (
                            <div className="h-1.5 bg-[#0a0a0a] rounded-full overflow-hidden">
                              <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: barColor }} />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-[#6b7280] text-xs mt-5">
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
