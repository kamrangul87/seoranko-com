/**
 * Run an AI Visibility citation check for a connected site.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { getAiVisibilityPromptCap, AI_VISIBILITY_PHASE_NOTE } from './config'
import { checkOpenAICitation, checkPerplexityCitation } from './citation-engines'
import { buildCitationDiagnostic } from './diagnostic-linkage'
import { normaliseDomain } from '../connected-sites'

export interface VisibilityPromptRow {
  id: string
  prompt: string
}

export interface RunCitationCheckResult {
  ok: boolean
  message: string
  runId?: string
  citationRate?: number
  mentionRate?: number
  costUsd?: number
  costBreakdown?: Record<string, number>
  phaseNote: string
  results?: Array<{
    prompt: string
    engine: string
    mentioned: boolean
    cited: boolean
    diagnosticFinding?: string
    costUsd: number
    error?: string
  }>
}

export function suggestPromptsForSite(opts: { brand: string; domain: string; market?: string }): string[] {
  const brand = opts.brand || opts.domain
  const market = opts.market && opts.market !== 'Global' ? opts.market : ''
  const niche = brand
  const base = [
    `best ${niche}`,
    `${niche} reviews`,
    `how to choose ${niche}`,
    `${niche} vs alternatives`,
    `is ${niche} worth it`,
  ]
  if (market) {
    base.push(`best ${niche} ${market}`, `${niche} installer ${market}`, `${niche} guide ${market}`)
  } else {
    base.push(`${niche} guide`, `top ${niche} companies`, `${niche} near me`)
  }
  return Array.from(new Set(base.map((p) => p.trim()).filter((p) => p.length >= 8))).slice(0, getAiVisibilityPromptCap())
}

export async function ensureDefaultPrompts(
  supabase: any,
  userId: string,
  siteId: string,
  brand: string,
  domain: string,
  market?: string,
): Promise<VisibilityPromptRow[]> {
  const { data: existing } = await supabase
    .from('ai_visibility_prompts')
    .select('id, prompt')
    .eq('site_id', siteId)
    .eq('user_id', userId)
    .eq('is_active', true)

  if (existing?.length) return existing

  const suggestions = suggestPromptsForSite({ brand, domain, market })
  const rows = suggestions.map((prompt) => ({
    user_id: userId,
    site_id: siteId,
    prompt,
    source: 'suggested',
    is_active: true,
  }))
  const { data, error } = await supabase.from('ai_visibility_prompts').insert(rows).select('id, prompt')
  if (error) {
    console.error('[ai-visibility] ensureDefaultPrompts', error.message)
    return []
  }
  return data || []
}

export async function runCitationCheck(opts: {
  supabase: any
  userId: string
  siteId: string
  trigger?: 'manual' | 'first_connect' | 'weekly_cron'
  promptIds?: string[]
}): Promise<RunCitationCheckResult> {
  const phaseNote = AI_VISIBILITY_PHASE_NOTE
  const cap = getAiVisibilityPromptCap()

  const { data: site } = await opts.supabase
    .from('connected_sites')
    .select('id, domain, brand')
    .eq('id', opts.siteId)
    .eq('user_id', opts.userId)
    .maybeSingle()

  if (!site) {
    return { ok: false, message: 'Site not found.', phaseNote }
  }

  let prompts: VisibilityPromptRow[] = []
  if (opts.promptIds?.length) {
    const { data } = await opts.supabase
      .from('ai_visibility_prompts')
      .select('id, prompt')
      .eq('user_id', opts.userId)
      .eq('site_id', opts.siteId)
      .in('id', opts.promptIds)
      .eq('is_active', true)
    prompts = data || []
  } else {
    prompts = await ensureDefaultPrompts(
      opts.supabase,
      opts.userId,
      opts.siteId,
      site.brand,
      site.domain,
    )
  }

  prompts = prompts.slice(0, cap)
  if (prompts.length === 0) {
    return { ok: false, message: 'No prompts configured for this site.', phaseNote }
  }

  const { data: runRow, error: runErr } = await opts.supabase
    .from('ai_visibility_runs')
    .insert({
      user_id: opts.userId,
      site_id: opts.siteId,
      status: 'running',
      prompt_count: prompts.length,
      trigger: opts.trigger || 'manual',
    })
    .select('id')
    .maybeSingle()

  if (runErr || !runRow) {
    return { ok: false, message: runErr?.message || 'Could not create run.', phaseNote }
  }

  const runId = runRow.id as string
  const domain = normaliseDomain(site.domain)
  const siteUrl = `https://${domain}`
  const brand = site.brand || domain

  let totalCost = 0
  const costBreakdown: Record<string, number> = { openai: 0, perplexity: 0 }
  let citedPairs = 0
  let mentionPairs = 0
  let pairCount = 0
  const flatResults: RunCitationCheckResult['results'] = []

  for (const p of prompts) {
    const [openai, perplexity] = await Promise.all([
      checkOpenAICitation({ prompt: p.prompt, brand, domain }),
      checkPerplexityCitation({ prompt: p.prompt, brand, domain }),
    ])

    for (const eng of [openai, perplexity]) {
      pairCount++
      totalCost += eng.costUsd
      costBreakdown[eng.engine] = (costBreakdown[eng.engine] || 0) + eng.costUsd
      if (eng.cited) citedPairs++
      if (eng.mentioned || eng.cited) mentionPairs++

      const diagnostic = await buildCitationDiagnostic({
        prompt: p.prompt,
        userDomain: domain,
        userSiteUrl: siteUrl,
        mentioned: eng.mentioned,
        cited: eng.cited,
        competitorDomains: eng.competitorDomains,
        competitorCitedUrls: eng.competitorUrls || [],
      })

      await opts.supabase.from('ai_visibility_results').insert({
        run_id: runId,
        prompt_id: p.id,
        prompt_text: p.prompt,
        engine: eng.engine,
        mentioned: eng.mentioned,
        cited: eng.cited,
        cited_urls: eng.citedUrls,
        competitor_domains: eng.competitorDomains,
        response_snippet: eng.responseSnippet,
        diagnostic,
        cost_usd: eng.costUsd,
        checked_at: new Date().toISOString(),
      })

      flatResults!.push({
        prompt: p.prompt,
        engine: eng.engine,
        mentioned: eng.mentioned,
        cited: eng.cited,
        diagnosticFinding: diagnostic?.finding,
        costUsd: eng.costUsd,
        error: eng.error,
      })
    }
  }

  const citationRate = pairCount ? Math.round((citedPairs / pairCount) * 1000) / 10 : 0
  const mentionRate = pairCount ? Math.round((mentionPairs / pairCount) * 1000) / 10 : 0

  await opts.supabase
    .from('ai_visibility_runs')
    .update({
      status: 'completed',
      finished_at: new Date().toISOString(),
      citation_rate: citationRate,
      mention_rate: mentionRate,
      cost_usd: totalCost,
      cost_breakdown: costBreakdown,
    })
    .eq('id', runId)

  return {
    ok: true,
    message: `Checked ${prompts.length} prompts across OpenAI + Perplexity.`,
    runId,
    citationRate,
    mentionRate,
    costUsd: totalCost,
    costBreakdown,
    phaseNote,
    results: flatResults,
  }
}
