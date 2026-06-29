export type Country =
  | "Global" | "UK" | "US" | "AU" | "CA" | "DE" | "FR"
  | "IN" | "AE" | "SA" | "SG" | "ZA" | "PK";

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
  improvements: string[];
  searchScore?: number;
  aiScore?: number;
  llmsTxtEntry?: string;
  humanScore?: number;
  passesDetection?: boolean;
  bannedWordsRemoved?: string[];
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
  prompt: string;
  caption: string;
  url: string;
}

export interface ImagesRequest {
  article: string;
  keyword: string;
}

export interface ImagesResponse {
  images: ImagePrompt[];
  error?: string;
}
