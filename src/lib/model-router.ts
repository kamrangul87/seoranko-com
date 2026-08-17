/**
 * Central model + provider routing.
 *
 * Quality rule: article-writing and other user-visible prose ALWAYS stay on
 * Claude Sonnet-class models. OpenRouter is a billing/transport option — it
 * does not downgrade the writing model unless you explicitly override
 * OPENROUTER_ARTICLE_MODEL (not recommended).
 *
 * Set LLM_PROVIDER=openrouter + OPENROUTER_API_KEY to route through OpenRouter.
 * Default remains direct Anthropic (ANTHROPIC_API_KEY).
 */

export type LlmProvider = 'anthropic' | 'openrouter'

export function getLlmProvider(): LlmProvider {
  const explicit = (process.env.LLM_PROVIDER || '').toLowerCase().trim()
  if (explicit === 'openrouter') return 'openrouter'
  if (explicit === 'anthropic') return 'anthropic'
  // Auto: prefer OpenRouter when its key is set and Anthropic is not
  if (process.env.OPENROUTER_API_KEY && !process.env.ANTHROPIC_API_KEY) return 'openrouter'
  if (process.env.OPENROUTER_API_KEY && process.env.LLM_PROVIDER === 'auto') return 'openrouter'
  return 'anthropic'
}

export function isOpenRouter(): boolean {
  return getLlmProvider() === 'openrouter'
}

const ANTHROPIC_SONNET = 'claude-sonnet-4-6'
const ANTHROPIC_HAIKU = 'claude-haiku-4-5-20251001'
const OPENROUTER_SONNET_DEFAULT = 'anthropic/claude-sonnet-4.6'
const OPENROUTER_HAIKU_DEFAULT = 'anthropic/claude-haiku-4.5'

function openRouterSonnet(): string {
  return process.env.OPENROUTER_ARTICLE_MODEL || OPENROUTER_SONNET_DEFAULT
}

function openRouterHaiku(): string {
  return process.env.OPENROUTER_FAST_MODEL || OPENROUTER_HAIKU_DEFAULT
}

export const MODELS = {
  get SONNET() {
    return isOpenRouter() ? openRouterSonnet() : ANTHROPIC_SONNET
  },
  get HAIKU() {
    return isOpenRouter() ? openRouterHaiku() : ANTHROPIC_HAIKU
  },
}

export const MODEL_FOR = {
  // ALWAYS SONNET — quality-critical, user-visible output
  get articleWriting() { return MODELS.SONNET },
  get articleImprovement() { return MODELS.SONNET },
  get competitorAnalysis() { return MODELS.SONNET },
  get humanizationRewrite() { return MODELS.SONNET },
  get factVerification() { return MODELS.SONNET },
  get auditFixGeneration() { return MODELS.SONNET },
  get eeAtScoring() { return MODELS.SONNET },
  get citationTesting() { return MODELS.SONNET },
  get scoreImprovement() { return MODELS.SONNET },
  get nlpExtraction() { return MODELS.SONNET },
  get structuredArticleWriting() { return MODELS.SONNET },
  // HAIKU — fast classification / extraction / repair
  get keywordClassification() { return MODELS.HAIKU },
  get imagePromptGeneration() { return MODELS.HAIKU },
  get bannedWordDetection() { return MODELS.HAIKU },
  get platformDetection() { return MODELS.HAIKU },
  get keywordExtraction() { return MODELS.HAIKU },
  get keywordCluster() { return MODELS.HAIKU },
  get mergeArtifactRepair() { return MODELS.HAIKU },
}

export function logLlmProviderOnce(): void {
  const provider = getLlmProvider()
  console.log(
    `[model-router] provider=${provider} articleModel=${MODELS.SONNET} fastModel=${MODELS.HAIKU}`,
  )
}
