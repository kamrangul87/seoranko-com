import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getLlmProvider, MODELS, MODEL_FOR } from './model-router'

describe('OpenRouter model routing (quality-preserving)', () => {
  const env = { ...process.env }

  beforeEach(() => {
    process.env = { ...env }
    delete process.env.LLM_PROVIDER
    delete process.env.OPENROUTER_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.OPENROUTER_ARTICLE_MODEL
    delete process.env.OPENROUTER_FAST_MODEL
  })

  afterEach(() => {
    process.env = { ...env }
  })

  it('defaults to anthropic provider', () => {
    expect(getLlmProvider()).toBe('anthropic')
    expect(MODELS.SONNET).toBe('claude-sonnet-4-6')
    expect(MODEL_FOR.articleWriting).toBe('claude-sonnet-4-6')
  })

  it('uses OpenRouter Claude Sonnet for article writing when enabled', () => {
    process.env.LLM_PROVIDER = 'openrouter'
    process.env.OPENROUTER_API_KEY = 'test-key'
    expect(getLlmProvider()).toBe('openrouter')
    expect(MODEL_FOR.articleWriting).toBe('anthropic/claude-sonnet-4.6')
    expect(MODEL_FOR.humanizationRewrite).toBe('anthropic/claude-sonnet-4.6')
    expect(MODEL_FOR.mergeArtifactRepair).toBe('anthropic/claude-haiku-4.5')
  })

  it('never silently downgrades article writing off Sonnet without override', () => {
    process.env.LLM_PROVIDER = 'openrouter'
    process.env.OPENROUTER_API_KEY = 'test-key'
    expect(MODEL_FOR.articleWriting).toMatch(/claude-sonnet/i)
  })

  it('allows explicit OpenRouter article model override', () => {
    process.env.LLM_PROVIDER = 'openrouter'
    process.env.OPENROUTER_API_KEY = 'test-key'
    process.env.OPENROUTER_ARTICLE_MODEL = 'anthropic/claude-sonnet-4'
    expect(MODEL_FOR.articleWriting).toBe('anthropic/claude-sonnet-4')
  })
})
