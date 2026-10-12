/**
 * Daily Fix Agent failure digest email (Resend → MASTER_EMAIL).
 */

import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { consecutivePassingE2eDays, listRecentE2eRuns } from '@/lib/fix-agent-e2e'
import { listPausedFixTypes } from './circuit-breaker'

export type FailureDigestPayload = {
  newSignatures: Array<{
    signature: string
    signatureHash: string
    topic: string
    verdict: string
    stage: string
    count: number
  }>
  paused: Array<{
    topic: string
    verdict: string
    pausedReason: string | null
    pausedAt: string | null
  }>
  latestE2e: {
    status: string
    finishedAt: string | null
    firstFailingStep: string | null
    failReason: string | null
  } | null
  consecutivePassDays: number
  weeklySummary: boolean
}

export async function buildFailureDigestPayload(opts?: {
  now?: Date
  forceWeekly?: boolean
}): Promise<FailureDigestPayload> {
  const now = opts?.now ?? new Date()
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
  const sb = createServiceRoleClient()

  const { data: rows } = await sb
    .from('fix_failures')
    .select('signature, signature_hash, topic, verdict, stage')
    .gte('created_at', since)
    .limit(500)

  const bySig = new Map<
    string,
    FailureDigestPayload['newSignatures'][number]
  >()
  for (const r of rows ?? []) {
    const hash = String(r.signature_hash)
    const cur = bySig.get(hash)
    if (cur) cur.count += 1
    else {
      bySig.set(hash, {
        signature: String(r.signature),
        signatureHash: hash,
        topic: String(r.topic),
        verdict: String(r.verdict),
        stage: String(r.stage),
        count: 1,
      })
    }
  }

  // "New" = first-ever occurrence of hash is within the window
  const newSignatures: FailureDigestPayload['newSignatures'] = []
  for (const entry of bySig.values()) {
    const { count } = await sb
      .from('fix_failures')
      .select('id', { count: 'exact', head: true })
      .eq('signature_hash', entry.signatureHash)
      .lt('created_at', since)
    if ((count ?? 0) === 0) newSignatures.push(entry)
  }

  const paused = (await listPausedFixTypes()).map((p) => ({
    topic: p.topic,
    verdict: p.verdict,
    pausedReason: p.pausedReason,
    pausedAt: p.pausedAt,
  }))

  const recent = await listRecentE2eRuns(1)
  const latest = recent[0] ?? null
  const consecutivePassDays = await consecutivePassingE2eDays()

  const isMonday = now.getUTCDay() === 1
  const weeklySummary = opts?.forceWeekly === true || isMonday

  return {
    newSignatures: newSignatures.sort((a, b) => b.count - a.count),
    paused,
    latestE2e: latest
      ? {
          status: latest.status,
          finishedAt: latest.finished_at,
          firstFailingStep: latest.first_failing_step,
          failReason: latest.fail_reason,
        }
      : null,
    consecutivePassDays,
    weeklySummary,
  }
}

/** Skip email when nothing new and e2e passing, except weekly summary. */
export function shouldSendFailureDigest(p: FailureDigestPayload): boolean {
  const e2eOk = p.latestE2e?.status === 'passed'
  if (p.newSignatures.length > 0) return true
  if (p.paused.length > 0 && !e2eOk) return true
  if (!e2eOk) return true
  if (p.weeklySummary) return true
  return false
}

export function formatFailureDigestText(p: FailureDigestPayload): string {
  const lines: string[] = [
    'SEORANKO Fix Agent — failure digest',
    '',
    `Consecutive e2e pass days: ${p.consecutivePassDays}`,
    p.latestE2e
      ? `Latest e2e: ${p.latestE2e.status}${
          p.latestE2e.firstFailingStep
            ? ` @ ${p.latestE2e.firstFailingStep}`
            : ''
        }${p.latestE2e.failReason ? ` — ${p.latestE2e.failReason}` : ''}`
      : 'Latest e2e: (none)',
    '',
    `New signatures (24h): ${p.newSignatures.length}`,
  ]
  for (const s of p.newSignatures.slice(0, 20)) {
    lines.push(
      `  - [${s.count}×] ${s.topic}/${s.verdict} @ ${s.stage} (${s.signatureHash})`,
    )
  }
  lines.push('', `Paused fix types: ${p.paused.length}`)
  for (const t of p.paused.slice(0, 20)) {
    lines.push(
      `  - ${t.topic}/${t.verdict}${t.pausedReason ? ` — ${t.pausedReason}` : ''}`,
    )
  }
  if (p.weeklySummary) lines.push('', '(Weekly summary)')
  lines.push('', 'Open /admin/fix-failures')
  return lines.join('\n')
}

export async function sendFailureDigestEmail(
  text: string,
): Promise<{ emailOk: boolean }> {
  const master = process.env.MASTER_EMAIL?.trim()
  const apiKey = process.env.RESEND_API_KEY?.trim()
  if (!apiKey || !master) {
    console.info('[fix-failure-digest] skip email — missing RESEND/MASTER')
    return { emailOk: false }
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'SEORANKO Fix Agent <noreply@seoranko.com>',
        to: [master],
        subject: '[SEORANKO] Fix Agent failure digest',
        text,
      }),
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      console.info('[fix-failure-digest] resend failed', res.status, t.slice(0, 200))
    }
    return { emailOk: res.ok }
  } catch (e) {
    console.info(
      '[fix-failure-digest] resend error',
      e instanceof Error ? e.message : e,
    )
    return { emailOk: false }
  }
}
