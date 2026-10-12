import { createServiceRoleClient } from '@/lib/supabase/service-role'

export type FailureSignatureSummary = {
  signature: string
  signatureHash: string
  topic: string
  verdict: string
  stage: string
  count: number
  lastSeenAt: string
}

export async function listFailureSignatures(limit = 100): Promise<
  FailureSignatureSummary[]
> {
  try {
    const sb = createServiceRoleClient()
    const { data, error } = await sb
      .from('fix_failures')
      .select('signature, signature_hash, topic, verdict, stage, created_at')
      .order('created_at', { ascending: false })
      .limit(2000)
    if (error) throw new Error(error.message)

    const map = new Map<string, FailureSignatureSummary>()
    for (const r of data ?? []) {
      const hash = String(r.signature_hash)
      const cur = map.get(hash)
      const created = String(r.created_at)
      if (!cur) {
        map.set(hash, {
          signature: String(r.signature),
          signatureHash: hash,
          topic: String(r.topic),
          verdict: String(r.verdict),
          stage: String(r.stage),
          count: 1,
          lastSeenAt: created,
        })
      } else {
        cur.count += 1
        if (created > cur.lastSeenAt) cur.lastSeenAt = created
      }
    }
    return Array.from(map.values())
      .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
      .slice(0, limit)
  } catch {
    return []
  }
}
