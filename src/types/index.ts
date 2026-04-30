export type Country = "UK" | "US" | "Global";
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

export interface ArticleRequest {
  keyword: string;
  cluster?: Cluster;
  wordCount: number;
  tone: Tone;
  audience: string;
  country: Country;
  nlpBrief?: NlpBrief;
}

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
