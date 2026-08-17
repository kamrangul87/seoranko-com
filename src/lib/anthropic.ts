import Anthropic from "@anthropic-ai/sdk";
import { MODELS } from './model-router';

let _client: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
  if (!_client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY environment variable is not set");
    _client = new Anthropic({ apiKey });
  }
  return _client;
}

export async function callClaude(
  systemPrompt: string,
  userMessage: string,
  maxTokens = 4096,
  model: string = MODELS.SONNET
): Promise<string> {
  const client = getAnthropicClient();
  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system: [{ type: 'text' as const, text: systemPrompt, cache_control: { type: 'ephemeral' as const } }],
    messages: [{ role: "user", content: userMessage }],
  });
  const block = response.content[0];
  if (block.type !== "text") throw new Error("Unexpected response type from Claude");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cacheHit = ((response.usage as any).cache_read_input_tokens ?? 0) > 0;
  console.log(`[model-router] task=callClaude model=${model} inputTokens=${response.usage.input_tokens} cacheHit=${cacheHit}`);
  return block.text;
}

export async function streamClaude(
  systemPrompt: string,
  userMessage: string,
  onChunk: (delta: string, accumulated: string) => void,
  maxTokens = 8000,
  model: string = MODELS.SONNET
): Promise<string> {
  const client = getAnthropicClient();
  const stream = client.messages.stream({
    model,
    max_tokens: maxTokens,
    system: [{ type: 'text' as const, text: systemPrompt, cache_control: { type: 'ephemeral' as const } }],
    messages: [{ role: "user", content: userMessage }],
  });

  let accumulated = "";
  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      accumulated += event.delta.text;
      onChunk(event.delta.text, accumulated);
    }
  }

  const finalMsg = await stream.finalMessage();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cacheHit = ((finalMsg.usage as any).cache_read_input_tokens ?? 0) > 0;
  console.log(`[model-router] task=streamClaude model=${model} inputTokens=${finalMsg.usage.input_tokens} cacheHit=${cacheHit}`);

  return accumulated;
}

export function parseJsonResponse<T>(text: string): T {
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || text.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
  const raw = jsonMatch ? jsonMatch[1] : text.trim();
  return JSON.parse(raw) as T;
}
