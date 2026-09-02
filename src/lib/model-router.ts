export const MODELS = {
  SONNET: 'claude-sonnet-4-6',
  HAIKU: 'claude-haiku-4-5-20251001',
} as const

export const MODEL_FOR = {
  // ALWAYS SONNET — quality-critical, user-visible output
  articleWriting: MODELS.SONNET,
  articleImprovement: MODELS.SONNET,
  competitorAnalysis: MODELS.SONNET,
  humanizationRewrite: MODELS.SONNET,
  factVerification: MODELS.SONNET,
  auditFixGeneration: MODELS.SONNET,
  eeAtScoring: MODELS.SONNET,
  citationTesting: MODELS.SONNET,
  scoreImprovement: MODELS.SONNET,
  nlpExtraction: MODELS.SONNET,
  // Scaffold only — see src/lib/structured-article-schema.ts. Not called
  // anywhere yet; behind STRUCTURED_ARTICLE_WRITING_ENABLED.
  structuredArticleWriting: MODELS.SONNET,
  contentBrief: MODELS.SONNET,
  // HAIKU ONLY — fast classification, simple extraction, separate rate-limit bucket
  keywordClassification: MODELS.HAIKU,
  imagePromptGeneration: MODELS.HAIKU,
  bannedWordDetection: MODELS.HAIKU,
  platformDetection: MODELS.HAIKU,
  keywordExtraction: MODELS.HAIKU,
  keywordCluster: MODELS.HAIKU,
  mergeArtifactRepair: MODELS.HAIKU,
  cannibalizationJudge: MODELS.HAIKU,
  topicalMapCluster: MODELS.HAIKU,
  timeAnchoredClaimRepair: MODELS.HAIKU,
  /** Phrases link-graph verdict from already-computed findings only (never invents findings). */
  linkGraphVerdict: MODELS.HAIKU,
} as const
