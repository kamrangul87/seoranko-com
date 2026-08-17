// src/lib/structured-article-schema.ts
// SCAFFOLD ONLY — not wired into the default article-v2 generation path.
// Nothing in this file is imported by route.ts or any live pipeline code.
//
// FIX 6: generate articles as structured JSON (via Anthropic tool-use with a
// forced tool_choice) rather than raw HTML the model free-writes, then
// deterministically render HTML + JSON-LD from that structure. This
// sidesteps whole classes of bugs the rest of this pipeline patches after
// the fact (missing figures, missing schema fields, run-on paragraphs,
// unsourced dated claims) by construction, instead of detecting and fixing
// them post-hoc.
//
// TODO(structured-article-writing): A/B plan before promoting this to the
// default path — run both the current free-text pipeline and this
// structured pipeline side by side (behind STRUCTURED_ARTICLE_WRITING_ENABLED)
// across >=20 real articles each. Promote structured generation to default
// only if, across that sample, the three recurring-pattern categories this
// phase's fixes target (schema, dated-policy, scannability) hit 0/0/0 for
// the structured path — i.e. it doesn't just move the same defects
// somewhere new, it actually eliminates the need for the post-hoc fixes.
// Until that trial runs, this file is intentionally unused.

import { z } from 'zod'
import Anthropic from '@anthropic-ai/sdk'
import { MODEL_FOR } from './model-router'
import { getAnthropicClient } from './anthropic'

export const STRUCTURED_ARTICLE_WRITING_ENABLED =
  process.env.STRUCTURED_ARTICLE_WRITING_ENABLED === 'true'

export const ClaimSchema = z.object({
  text: z.string(),
  source: z.string().optional(),
  reviewDate: z.string().optional(),
})

export const SectionSchema = z.object({
  h2: z.string(),
  paragraphs: z.array(z.string()).min(1),
  imageSlot: z.boolean().optional(),
})

export const FaqItemSchema = z.object({
  q: z.string(),
  a: z.string(),
})

export const StructuredArticleSchema = z.object({
  title: z.string(),
  sections: z.array(SectionSchema).min(1),
  faq: z.array(FaqItemSchema).default([]),
  claims: z.array(ClaimSchema).default([]),
})

export type StructuredArticle = z.infer<typeof StructuredArticleSchema>

// JSON Schema handed to Anthropic as a forced tool_choice input_schema —
// kept separate from the Zod schema above (Zod validates the model's
// response after the fact; this constrains the model's output shape during
// generation itself). The two must stay in sync by hand; this scaffold
// predates wiring in a zod-to-json-schema conversion.
export const STRUCTURED_ARTICLE_TOOL_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    sections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          h2: { type: 'string' },
          paragraphs: { type: 'array', items: { type: 'string' } },
          imageSlot: { type: 'boolean' },
        },
        required: ['h2', 'paragraphs'],
      },
    },
    faq: {
      type: 'array',
      items: {
        type: 'object',
        properties: { q: { type: 'string' }, a: { type: 'string' } },
        required: ['q', 'a'],
      },
    },
    claims: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          source: { type: 'string' },
          reviewDate: { type: 'string' },
        },
        required: ['text'],
      },
    },
  },
  required: ['title', 'sections'],
} as const

// Not called anywhere yet — see TODO above. Kept here so the forced
// tool-use call shape is settled once the A/B trial starts, rather than
// designed from scratch at that point. Guarded so it can't silently run in
// production before the trial is actually ready.
export async function generateStructuredArticle(prompt: string): Promise<StructuredArticle> {
  if (!STRUCTURED_ARTICLE_WRITING_ENABLED) {
    throw new Error(
      'generateStructuredArticle called while STRUCTURED_ARTICLE_WRITING_ENABLED is not set — this path is scaffold-only, not ready for production traffic.'
    )
  }
  const anthropic = getAnthropicClient()
  const response = await anthropic.messages.create({
    model: MODEL_FOR.structuredArticleWriting,
    max_tokens: 8000,
    tools: [{
      name: 'emit_structured_article',
      description: 'Emit the article as structured JSON matching the required shape.',
      input_schema: STRUCTURED_ARTICLE_TOOL_INPUT_SCHEMA,
    }],
    tool_choice: { type: 'tool', name: 'emit_structured_article' },
    messages: [{ role: 'user', content: prompt }],
  })

  const toolUse = response.content.find(b => b.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('Model did not return the forced tool_use block')
  }
  return StructuredArticleSchema.parse(toolUse.input)
}

// Deterministic renderer — the same structure always produces the same HTML
// shape, unlike free-text generation where figure placement, paragraph
// length, and schema completeness are separate post-hoc passes trying to
// patch whatever the model happened to write.
export function renderStructuredArticleToHtml(article: StructuredArticle): string {
  const sections = article.sections.map(section => {
    const paras = section.paragraphs.map(p => `<p>${p}</p>`).join('\n')
    return `<h2>${section.h2}</h2>\n${paras}`
  }).join('\n\n')

  const faqHtml = article.faq.length > 0
    ? `<h2>Frequently Asked Questions</h2>\n` +
      article.faq.map(f => `<h3>${f.q}</h3>\n<p>${f.a}</p>`).join('\n')
    : ''

  return [`<h1>${article.title}</h1>`, sections, faqHtml].filter(Boolean).join('\n\n')
}
