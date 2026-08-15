// ─── Shared capability types ───────────────────────────────────────────────────

/** Confidence level for any score or recommendation across all tools. */
export type ConfidenceLevel = 'high' | 'medium' | 'low';

/** Render a confidence badge as a plain string for UI use. */
export function confidenceDots(level: ConfidenceLevel): string {
  if (level === 'high')   return '●●●';
  if (level === 'medium') return '●●○';
  return '●○○';
}

/** Confidence label and colour tokens for each level. */
export const CONFIDENCE_META: Record<ConfidenceLevel, { label: string; color: string; bg: string; border: string }> = {
  high:   { label: 'HIGH',         color: '#15803D', bg: '#F0FDF4', border: '#BBF7D0' },
  medium: { label: 'MEDIUM',       color: '#D97706', bg: '#FFFBEB', border: '#FDE68A' },
  low:    { label: 'EXPERIMENTAL', color: '#9B9B9B', bg: '#F5F4F1', border: '#E8E8E4' },
};

export interface CitationResult {
  topic: string;
  mentioned: boolean;
  cited: boolean;
  competitorsCited: string[];
  responseSnippet: string;
}

export interface CitationOpportunity {
  keyword: string;
  hasStrongCompetition: boolean;
  dominantCompetitors: string[];
  opportunityScore: number; // 0–100; higher = easier to win AI citations
}

export interface EntityPresence {
  wikipedia: boolean;
  reddit: boolean;
  linkedin: boolean;
  score: number; // 0 | 33 | 66 | 100
  recommendations: string[];
}

export interface ScoreDrift {
  current: number;
  previous: number | null;
  change: number;
  thirtyDaysAgo: number | null;
  trend: 'improving' | 'declining' | 'stable' | 'new';
}

// ─── Country / locale types ───────────────────────────────────────────────────

export type Country = string

export type SearchIntent = "informational" | "commercial" | "transactional" | "navigational";
export type Tone = "professional" | "conversational" | "authoritative" | "friendly";

export interface KeywordResult {
  keyword: string;
  volume: number;
  kd: number;
  cpc: number;
  intent: SearchIntent;
  trend: number[];
}

export interface KeywordsRequest {
  keyword: string;
  country: Country;
}

export interface KeywordsResponse {
  keywords: KeywordResult[];
  error?: string;
}

export interface Cluster {
  name: string;
  intent: SearchIntent;
  keywords: string[];
  opportunity: number;
  color: string;
}

export interface ClusterRequest {
  keywords: KeywordResult[];
}

export interface ClusterResponse {
  clusters: Cluster[];
  error?: string;
}

// ─── Pipeline types ───────────────────────────────────────────────────────────

export interface DiscoveryOpportunity {
  problem: string;
  entities: string[];
  gapScore: number;
  volume: number;
  competition: string;
  intent: string;
  whyGapExists: string;
  region: string;
}

export interface NlpAnalysis {
  keyword: string;
  shortKeyword?: string;
  recommendedH1: string;
  intent: { type: string; confidence: number; explanation: string };
  entities: string[];
  missingEntities: string[];
  subtopics: string[];
  topicalGaps: string[];
  lsiTerms: { term: string; frequency: string; status: string }[];
  brief: {
    recommendedH1: string;
    primaryKeyword?: string;
    structure: { tag: string; text: string }[];
    wordCount: number;
    tone: string;
    targetAudience: string;
  };
  overallScore: number;
  location_code: number;
  targetMarket: string;
}

export interface PipelineData {
  discoveryData?: DiscoveryOpportunity;
  nlpData?: NlpAnalysis;
  selectedKeywords?: string[];
  targetMarket?: string;
}

// ─── Article types ────────────────────────────────────────────────────────────

export interface NlpBrief {
  recommendedH1: string;
  structure: { tag: string; text: string }[];
  wordCount: number;
  tone: string;
  entities: string[];
  lsiTerms: { term: string; frequency: string; status: string }[];
  topicalGaps: string[];
  intent: string;
  serpFeatures: { name: string; available: boolean; tip: string }[];
}

export interface ArticleRequest {
  keyword: string;
  cluster?: Cluster;
  wordCount: number;
  tone: Tone;
  audience: string;
  country: Country;
  nlpBrief?: NlpBrief;
  pipelineData?: PipelineData;
}

export interface ResearchBrief {
  intent: string;
  questions: string[];
  semanticKeywords: string[];
  contentGaps: string[];
}

export interface ArticleOutput {
  seoTitle: string;
  metaDescription: string;
  article: string;
  wordCount: number;
  eeaScore: number;
  readabilityScore: number;
  keywordDensity: string | number;
  keywordDensityScore?: number;
  improvements: string[];
  searchScore?: number;
  aiScore?: number;
  llmsTxtEntry?: string;
  humanScore?: number;
  passesDetection?: boolean;
  bannedWordsRemoved?: string[];
  factSourcingScore?: number;
  factPatchedCount?: number;
  rankScore?: number;
  factDensity?: {
    score: number;
    grade: string;
    factsPerHundredWords: number;
    suggestions: string[];
  };
  faqs?: Array<{ question: string; answer: string }>;
  answerFirst?: boolean;
  hasSchema?: boolean;
  schemaScriptTag?: string;
  qualityGate?: {
    passed: boolean
    score: number
    criticalCount: number
    warningCount: number
    autoFixedCount: number
    issues: Array<{
      id: string
      severity: 'critical' | 'warning' | 'info'
      category: string
      title: string
      description: string
      location?: string
      autoFixable: boolean
      autoFixDescription?: string
    }>
    blockers: string[]
    readyToPublish: boolean
  }
  linkAudit?: {
    placed: string[]
    skipped: string[]
    totalPlaced: number
    note?: string
  }
  articleId?: string
  saveError?: string
}

export interface ArticleResponse {
  research: ResearchBrief;
  article: ArticleOutput;
  error?: string;
}

export interface ImagePrompt {
  id: string;
  placement: string;
  altText: string;
  alt?: string;
  prompt: string;
  caption: string;
  url: string;
  width?: number;
  height?: number;
}

export type ImageTier = 'free' | 'premium';

export interface ImagesRequest {
  article: string;
  keyword: string;
  tier?: ImageTier;
  count?: number;
}

export interface ImagesResponse {
  images: ImagePrompt[];
  hero?: ImagePrompt;
  content?: ImagePrompt[];
  mobile?: ImagePrompt;
  injectedHtml?: string;
  imageMeta?: string;
  tier?: ImageTier;
  stored?: boolean;
  error?: string;
}
