/**
 * Record a Fix Agent failure into the ledger, update the circuit breaker,
 * and open a draft fixture PR for new signatures.
 */

import { createServiceRoleClient } from '@/lib/supabase/service-role'
import {
  buildFailureEvidence,
  type FixFailureEvidence,
} from './evidence'
import {
  evaluateAndMaybePause,
} from './circuit-breaker'
import { openFixtureCasePr } from './fixture-draft'
import {
  buildFailureSignature,
  signatureHash,
  type FixFailureStage,
} from './signature'

export type RecordFixFailureInput = {
  siteId?: string | null
  runId?: string | null
  findingId?: string | null
  topic: string
  verdict: string
  stage: FixFailureStage
  reason: string
  url?: string | null
  httpStatus?: number | null
  filePath?: string | null
  htmlSnippet?: string | null
  e2eStep?: string | null
  /** Master user for GitHub App fixture PR (optional). */
  userId?: string | null
}

export type RecordFixFailureResult = {
  id: string | null
  signature: string
  signatureHash: string
  isNewSignature: boolean
  paused: boolean
  fixturePrUrl: string | null
}

async function isNewSignature(hash: string): Promise<boolean> {
  try {
    const sb = createServiceRoleClient()
    const { count, error } = await sb
      .from('fix_failures')
      .select('id', { count: 'exact', head: true })
      .eq('signature_hash', hash)
    if (error) return true
    return (count ?? 0) === 0
  } catch {
    return true
  }
}

export async function recordFixFailure(
  input: RecordFixFailureInput,
): Promise<RecordFixFailureResult> {
  const signature = buildFailureSignature({
    topic: input.topic,
    verdict: input.verdict,
    stage: input.stage,
    reason: input.reason,
  })
  const hash = signatureHash(signature)
  const evidence = buildFailureEvidence({
    reason: input.reason,
    url: input.url,
    httpStatus: input.httpStatus,
    filePath: input.filePath,
    htmlSnippet: input.htmlSnippet,
    e2eStep: input.e2eStep,
  })

  let id: string | null = null
  let isNew = false
  try {
    isNew = await isNewSignature(hash)
    const sb = createServiceRoleClient()
    const { data, error } = await sb
      .from('fix_failures')
      .insert({
        site_id: input.siteId ?? null,
        run_id: input.runId ?? null,
        finding_id: input.findingId ?? null,
        topic: input.topic,
        verdict: input.verdict,
        stage: input.stage,
        signature,
        signature_hash: hash,
        evidence,
      })
      .select('id')
      .single()
    if (error) {
      console.info('[fix-failure] insert', error.message)
    } else {
      id = data?.id ? String(data.id) : null
    }
  } catch (e) {
    console.info(
      '[fix-failure] record',
      e instanceof Error ? e.message : e,
    )
  }

  const pause = await evaluateAndMaybePause({
    topic: input.topic,
    verdict: input.verdict,
    stage: input.stage,
    siteId: input.siteId ?? null,
  })

  let fixturePrUrl: string | null = null
  if (isNew && id) {
    const pr = await openFixtureCasePr({
      signature,
      signatureHash: hash,
      topic: input.topic,
      verdict: input.verdict,
      stage: input.stage,
      evidence,
      userId: input.userId,
    })
    if (pr.ok) fixturePrUrl = pr.prUrl
    else
      console.info('[fix-failure] fixture PR skipped', pr.error)
  }

  return {
    id,
    signature,
    signatureHash: hash,
    isNewSignature: isNew,
    paused: pause.paused,
    fixturePrUrl,
  }
}

/** Fire-and-forget wrapper so tick paths never block on ledger I/O errors. */
export function recordFixFailureSafe(input: RecordFixFailureInput): void {
  void recordFixFailure(input).catch((e) => {
    console.info(
      '[fix-failure] safe',
      e instanceof Error ? e.message : e,
    )
  })
}

export type { FixFailureEvidence }
