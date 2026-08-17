import Anthropic from '@anthropic-ai/sdk'
import { MODELS, getLlmProvider, isOpenRouter, logLlmProviderOnce } from './model-router'

let _client: Anthropic | null = null
let _loggedProvider = false

/**
 * Shared Anthropic-compatible client.
 * When LLM_PROVIDER=openrouter (or OpenRouter-only keys), calls go to
 * OpenRouter's Anthropic Messages endpoint with the same Claude models —
 * article writing quality stays on Sonnet.
 */
export function getAnthropicClient(options?: { maxRetries?: number }): Anthropic {
  if (_client) return _client

  if (!_loggedProvider) {
    logLlmProviderOnce()
    _loggedProvider = true
  }

  const maxRetries = options?.maxRetries ?? 5

  if (isOpenRouter()) {
    const apiKey = process.env.OPENROUTER_API_KEY
    if (!apiKey) {
      throw new Error(
        'LLM_PROVIDER=openrouter but OPENROUTER_API_KEY is not set. ' +
          'Get a key at https://openrouter.ai/keys',
      )
    }
    // Anthropic SDK appends /v1/messages → https://openrouter.ai/api/v1/messages
    _client = new Anthropic({
      apiKey,
      baseURL: 'https://openrouter.ai/api',
      maxRetries,
      defaultHeaders: {
        'HTTP-Referer': process.env.OPENROUTER_SITE_URL || 'https://seoranko.com',
        'X-Title': process.env.OPENROUTER_APP_NAME || 'SEORANKO',
      },
    })
    return _client
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. For OpenRouter set OPENROUTER_API_KEY and LLM_PROVIDER=openrouter.',
    )
  }
  _client = new Anthropic({ apiKey, maxRetries })
  return _client
}

/** Reset cached client (tests / provider switch). */
export function resetLlmClient(): void {
  _client = null
  _loggedProvider = false
}

export async function callClaude(
  systemPrompt: string,
  userMessage: string,
  maxTokens = 4096,
  model: string = MODELS.SONNET,
): Promise<string> {
  const client = getAnthropicClient()
  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    // Prompt caching is Anthropic-direct; OpenRouter may ignore it safely
    system: [{ type: 'text' as const, text: systemPrompt, cache_control: { type: 'ephemeral' as const } }],
    messages: [{ role: 'user', content: userMessage }],
  })
  const block = response.content[0]
  if (block.type !== 'text') throw new Error('Unexpected response type from Claude')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cacheHit = ((response.usage as any).cache_read_input_tokens ?? 0) > 0
  console.log(
    `[model-router] provider=${getLlmProvider()} task=callClaude model=${model} inputTokens=${response.usage.input_tokens} cacheHit=${cacheHit}`,
  )
  return block.text
}

export async function streamClaude(
  systemPrompt: string,
  userMessage: string,
  onChunk: (delta: string, accumulated: string) => void,
  maxTokens = 8000,
  model: string = MODELS.SONNET,
): Promise<string> {
  const client = getAnthropicClient()
  const stream = client.messages.stream({
    model,
    max_tokens: maxTokens,
    system: [{ type: 'text' as const, text: systemPrompt, cache_control: { type: 'ephemeral' as const } }],
    messages: [{ role: 'user', content: userMessage }],
  })

  let accumulated = ''
  for await (const event of stream) {
    if (
      event.type === 'content_block_delta' &&
      event.delta.type === 'text_delta'
    ) {
      accumulated += event.delta.text
      onChunk(event.delta.text, accumulated)
    }
  }

  const finalMsg = await stream.finalMessage()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cacheHit = ((finalMsg.usage as any).cache_read_input_tokens ?? 0) > 0
  console.log(
    `[model-router] provider=${getLlmProvider()} task=streamClaude model=${model} inputTokens=${finalMsg.usage.input_tokens} cacheHit=${cacheHit}`,
  )

  return accumulated
}

export function parseJsonResponse<T>(text: string): T {
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || text.match(/(\[[\s\S]*\]|\{[\s\S]*\})/)
  const raw = jsonMatch ? jsonMatch[1] : text.trim()
  return JSON.parse(raw) as T
}
