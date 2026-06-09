import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const maxDuration = 60;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      keyword = '',
      wordCount = 2000,
      tone = 'professional',
      market = 'United Kingdom',
      secondaryKeywords = [],
      entities = [],
      topicalGaps = [],
    } = body;

    const secondaryList = (secondaryKeywords as string[]).slice(0, 15).join(', ');
    const entitiesList = (entities as string[]).slice(0, 10).join(', ');
    const gapsList = (topicalGaps as string[]).slice(0, 10).join(', ');

    const stream = await anthropic.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 6000,
      messages: [{
        role: 'user',
        content: `Write a comprehensive ${wordCount}-word SEO article for the ${market} market.

PRIMARY KEYWORD: ${keyword}
SECONDARY KEYWORDS (use naturally): ${secondaryList}
ENTITIES TO MENTION: ${entitiesList}
TOPICS TO COVER: ${gapsList}
TONE: ${tone}

RULES:
- Write in British English
- Start with a compelling H1 title
- Use H2 and H3 subheadings throughout
- Include a FAQ section at the end with 5 questions
- Only state facts you are confident are accurate
- Natural keyword usage — no stuffing
- Format as clean HTML (headings and paragraphs only — no CSS or JS)
- Add meta description as HTML comment on line 1: <!-- META: description here -->

Write the complete article now:`
      }],
    });

    const readable = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        try {
          for await (const chunk of stream) {
            if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
              controller.enqueue(encoder.encode(chunk.delta.text));
            }
          }
          controller.close();
        } catch (err) {
          controller.error(err);
        }
      },
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Transfer-Encoding': 'chunked',
        'X-Content-Type-Options': 'nosniff',
      },
    });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error('[article-v2]', error);
    return new Response(JSON.stringify({ error: error?.message || 'Failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
