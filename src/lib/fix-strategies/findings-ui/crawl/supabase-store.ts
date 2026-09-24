/**
 * Supabase-backed FindingsStore. Used when SERVICE_ROLE is configured.
 * Writes bypass RLS; reads are still scoped by siteId/userId in callers.
 */

import { createServiceRoleClient } from '@/lib/supabase/service-role'
import type { SupabaseClient } from '@supabase/supabase-js'
import { CRAWL_URL_CHUNK_SIZE } from './constants'
import type {
  CoverageNote,
  CrawlRunRecord,
  CrawlUrlJob,
  CrawlUrlJobStatus,
  PersistedEvidenceRow,
  PersistedFindingRow,
} from './constants'
import type { FindingsStore } from './store'
import type { DetectorEmit } from './run-detectors'

function mapRun(row: Record<string, unknown>): CrawlRunRecord {
  return {
    id: String(row.id),
    siteId: row.site_id == null ? null : String(row.site_id),
    detectOnly: Boolean(row.detect_only),
    detectOrigin: (row.detect_origin as string | null) ?? null,
    userId: String(row.user_id),
    origin: String(row.origin),
    status: row.status as CrawlRunRecord['status'],
    chunkSize: Number(row.chunk_size ?? CRAWL_URL_CHUNK_SIZE),
    urlsFound: Number(row.urls_found ?? row.urls_discovered ?? 0),
    urlsDiscovered: Number(row.urls_discovered ?? 0),
    urlsCrawled: Number(row.urls_crawled ?? 0),
    urlsFailed: Number(row.urls_failed ?? 0),
    urlsClientOnly: Number(row.urls_client_only ?? 0),
    urlsSkippedOffHost: Number(row.urls_skipped_off_host ?? 0),
    urlCap: row.url_cap == null ? null : Number(row.url_cap),
    pagesRendered: Number(row.pages_rendered ?? 0),
    pagesRenderFailed: Number(row.pages_render_failed ?? 0),
    totalRenderTimeMs: Number(row.total_render_time_ms ?? 0),
    discoverySeeds:
      (row.discovery_seeds as CrawlRunRecord['discoverySeeds']) ?? null,
    coverageNotes: (row.coverage_notes as CoverageNote[]) ?? [],
    isPartial: Boolean(row.is_partial),
    errorDetail: (row.error_detail as string | null) ?? null,
    startedAt: (row.started_at as string | null) ?? null,
    finishedAt: (row.finished_at as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

function mapJob(row: Record<string, unknown>): CrawlUrlJob {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    url: String(row.url),
    status: row.status as CrawlUrlJobStatus,
    httpStatus: (row.http_status as number | null) ?? null,
    finalUrl: (row.final_url as string | null) ?? null,
    streamComplete: (row.stream_complete as boolean | null) ?? null,
    clientOnly: Boolean(row.client_only),
    crawlerCausedBackoff: Boolean(row.crawler_caused_backoff),
    errorDetail: (row.error_detail as string | null) ?? null,
    html: (row.body_html as string | null) ?? null,
    renderMode:
      (row.render_mode as CrawlUrlJob['renderMode']) ?? null,
    rawHtmlHash: (row.raw_html_hash as string | null) ?? null,
    renderedHtmlHash: (row.rendered_html_hash as string | null) ?? null,
    processedAt: (row.processed_at as string | null) ?? null,
  }
}

function mapFinding(row: Record<string, unknown>): PersistedFindingRow {
  return {
    id: String(row.id),
    siteId: row.site_id == null ? null : String(row.site_id),
    detectOrigin: (row.detect_origin as string | null) ?? null,
    userId: String(row.user_id),
    topicId: String(row.topic_id),
    kind: String(row.kind),
    bucket: row.bucket as PersistedFindingRow['bucket'],
    verdict: String(row.verdict),
    severity: (row.severity as string | null) ?? null,
    rollupKey: String(row.rollup_key),
    declarationSite: (row.declaration_site as string | null) ?? null,
    affectedUrlCount: Number(row.affected_url_count ?? 1),
    pageUrl: (row.page_url as string | null) ?? null,
    detail: String(row.detail ?? ''),
    autoFixable: Boolean(row.auto_fixable),
    reportOnly: Boolean(row.report_only),
    surfaceClass: String(row.surface_class ?? 'finding'),
    proposedDiff: (row.proposed_diff as Record<string, unknown> | null) ?? null,
    evidenceValues:
      (row.evidence_values as Record<string, unknown> | null) ?? null,
    sourceRows: (row.source_rows as unknown[]) ?? [],
    firstSeenRunId: (row.first_seen_run_id as string | null) ?? null,
    lastSeenRunId: (row.last_seen_run_id as string | null) ?? null,
    firstSeenAt: String(row.first_seen_at),
    lastSeenAt: String(row.last_seen_at),
    status: (row.status as PersistedFindingRow['status']) ?? 'open',
    resolvedAt: (row.resolved_at as string | null) ?? null,
  }
}

function mapEvidence(row: Record<string, unknown>): PersistedEvidenceRow {
  return {
    id: String(row.id),
    findingId: (row.finding_id as string | null) ?? null,
    runId: String(row.run_id),
    topicId: String(row.topic_id),
    verdict: String(row.verdict),
    detail: String(row.detail ?? ''),
    pageUrl: (row.page_url as string | null) ?? null,
  }
}

export function createSupabaseFindingsStore(
  client?: SupabaseClient,
): FindingsStore {
  const db = () => client ?? createServiceRoleClient()

  return {
    async createRun({ siteId, userId, origin, detectOnly }) {
      const originNorm = origin.replace(/\/$/, '')
      const { data, error } = await db()
        .from('fix_strategies_crawl_runs')
        .insert({
          site_id: siteId,
          user_id: userId,
          origin: originNorm,
          status: 'queued',
          chunk_size: CRAWL_URL_CHUNK_SIZE,
          detect_only: detectOnly === true,
          detect_origin: detectOnly ? originNorm : null,
        })
        .select('*')
        .single()
      if (error || !data) throw new Error(error?.message ?? 'createRun failed')
      return mapRun(data as Record<string, unknown>)
    },

    async getRun(runId) {
      const { data, error } = await db()
        .from('fix_strategies_crawl_runs')
        .select('*')
        .eq('id', runId)
        .maybeSingle()
      if (error) throw new Error(error.message)
      return data ? mapRun(data as Record<string, unknown>) : null
    },

    async listRunsForSite(siteId) {
      const { data, error } = await db()
        .from('fix_strategies_crawl_runs')
        .select('*')
        .eq('site_id', siteId)
        .order('created_at', { ascending: false })
      if (error) throw new Error(error.message)
      return (data ?? []).map((r) => mapRun(r as Record<string, unknown>))
    },

    async listRunsForDetectOrigin(userId, detectOrigin) {
      const originNorm = detectOrigin.replace(/\/$/, '')
      const { data, error } = await db()
        .from('fix_strategies_crawl_runs')
        .select('*')
        .eq('user_id', userId)
        .eq('detect_only', true)
        .eq('detect_origin', originNorm)
        .order('created_at', { ascending: false })
      if (error) throw new Error(error.message)
      return (data ?? []).map((r) => mapRun(r as Record<string, unknown>))
    },

    async updateRun(runId, patch) {
      const row: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if (patch.status != null) row.status = patch.status
      if (patch.chunkSize != null) row.chunk_size = patch.chunkSize
      if (patch.urlsFound != null) row.urls_found = patch.urlsFound
      if (patch.urlsDiscovered != null) row.urls_discovered = patch.urlsDiscovered
      if (patch.urlsCrawled != null) row.urls_crawled = patch.urlsCrawled
      if (patch.urlsFailed != null) row.urls_failed = patch.urlsFailed
      if (patch.urlsClientOnly != null) row.urls_client_only = patch.urlsClientOnly
      if (patch.urlsSkippedOffHost != null)
        row.urls_skipped_off_host = patch.urlsSkippedOffHost
      if (patch.urlCap !== undefined) row.url_cap = patch.urlCap
      if (patch.pagesRendered != null) row.pages_rendered = patch.pagesRendered
      if (patch.pagesRenderFailed != null)
        row.pages_render_failed = patch.pagesRenderFailed
      if (patch.totalRenderTimeMs != null)
        row.total_render_time_ms = patch.totalRenderTimeMs
      if (patch.discoverySeeds !== undefined)
        row.discovery_seeds = patch.discoverySeeds
      if (patch.coverageNotes != null) row.coverage_notes = patch.coverageNotes
      if (patch.isPartial != null) row.is_partial = patch.isPartial
      if (patch.errorDetail !== undefined) row.error_detail = patch.errorDetail
      if (patch.startedAt !== undefined) row.started_at = patch.startedAt
      if (patch.finishedAt !== undefined) row.finished_at = patch.finishedAt

      const { data, error } = await db()
        .from('fix_strategies_crawl_runs')
        .update(row)
        .eq('id', runId)
        .select('*')
        .single()
      if (error || !data) throw new Error(error?.message ?? 'updateRun failed')
      return mapRun(data as Record<string, unknown>)
    },

    async enqueueUrls(runId, urls) {
      if (urls.length === 0) return
      const rows = urls.map((url) => ({
        run_id: runId,
        url,
        status: 'queued',
      }))
      const { error } = await db()
        .from('fix_strategies_crawl_url_jobs')
        .upsert(rows, { onConflict: 'run_id,url', ignoreDuplicates: true })
      if (error) throw new Error(error.message)
    },

    async enqueueUrlsReturningNew(runId, urls) {
      if (urls.length === 0) return 0
      const before = await this.countJobsByStatus(runId)
      const beforeTotal = Object.values(before).reduce((a, b) => a + b, 0)
      await this.enqueueUrls(runId, urls)
      const after = await this.countJobsByStatus(runId)
      const afterTotal = Object.values(after).reduce((a, b) => a + b, 0)
      return Math.max(0, afterTotal - beforeTotal)
    },

    async claimUrlChunk(runId, limit) {
      const { data: queued, error } = await db()
        .from('fix_strategies_crawl_url_jobs')
        .select('*')
        .eq('run_id', runId)
        .eq('status', 'queued')
        .order('created_at', { ascending: true })
        .limit(limit)
      if (error) throw new Error(error.message)
      const jobs = queued ?? []
      if (jobs.length === 0) return []

      const ids = jobs.map((j) => j.id as string)
      const { error: updErr } = await db()
        .from('fix_strategies_crawl_url_jobs')
        .update({ status: 'running' })
        .in('id', ids)
      if (updErr) throw new Error(updErr.message)

      return jobs.map((j) =>
        mapJob({ ...(j as Record<string, unknown>), status: 'running' }),
      )
    },

    async updateUrlJob(jobId, patch) {
      const row: Record<string, unknown> = {}
      if (patch.status != null) row.status = patch.status
      if (patch.httpStatus !== undefined) row.http_status = patch.httpStatus
      if (patch.finalUrl !== undefined) row.final_url = patch.finalUrl
      if (patch.streamComplete !== undefined)
        row.stream_complete = patch.streamComplete
      if (patch.clientOnly != null) row.client_only = patch.clientOnly
      if (patch.crawlerCausedBackoff != null)
        row.crawler_caused_backoff = patch.crawlerCausedBackoff
      if (patch.errorDetail !== undefined) row.error_detail = patch.errorDetail
      if (patch.html !== undefined) row.body_html = patch.html
      if (patch.renderMode !== undefined) row.render_mode = patch.renderMode
      if (patch.rawHtmlHash !== undefined) row.raw_html_hash = patch.rawHtmlHash
      if (patch.renderedHtmlHash !== undefined)
        row.rendered_html_hash = patch.renderedHtmlHash
      if (patch.status === 'crawled' || patch.status === 'failed' || patch.status === 'client_only') {
        row.processed_at = new Date().toISOString()
      }
      const { error } = await db()
        .from('fix_strategies_crawl_url_jobs')
        .update(row)
        .eq('id', jobId)
      if (error) throw new Error(error.message)
    },

    async listJobsForRun(runId) {
      const { data, error } = await db()
        .from('fix_strategies_crawl_url_jobs')
        .select('*')
        .eq('run_id', runId)
      if (error) throw new Error(error.message)
      return (data ?? []).map((j) => mapJob(j as Record<string, unknown>))
    },

    async countJobsByStatus(runId) {
      const counts: Record<CrawlUrlJobStatus, number> = {
        queued: 0,
        running: 0,
        crawled: 0,
        failed: 0,
        client_only: 0,
        skipped: 0,
      }
      const { data, error } = await db()
        .from('fix_strategies_crawl_url_jobs')
        .select('status')
        .eq('run_id', runId)
      if (error) throw new Error(error.message)
      for (const row of data ?? []) {
        const s = row.status as CrawlUrlJobStatus
        if (s in counts) counts[s]++
      }
      return counts
    },

    async upsertFindings({
      siteId,
      detectOrigin,
      userId,
      runId,
      findings,
      internalEvidence,
    }) {
      const now = new Date().toISOString()
      const originNorm = detectOrigin?.replace(/\/$/, '') ?? null
      for (const f of findings) {
        let existingQuery = db()
          .from('fix_strategies_findings')
          .select('id, first_seen_run_id, first_seen_at, status')
          .eq('topic_id', f.topicId)
          .eq('rollup_key', f.rollupKey)
        if (siteId) {
          existingQuery = existingQuery.eq('site_id', siteId)
        } else {
          existingQuery = existingQuery
            .is('site_id', null)
            .eq('user_id', userId)
            .eq('detect_origin', originNorm)
        }
        const { data: existing } = await existingQuery.maybeSingle()

        let findingId: string
        if (existing) {
          findingId = String(existing.id)
          // A finding re-observed after being marked resolved is a
          // regression, not a plain re-detection — flag it, and leave
          // resolved_at as the historical "last considered fixed" date
          // rather than clearing it.
          const nextStatus =
            existing.status === 'resolved' ? 'regressed' : undefined
          const { error } = await db()
            .from('fix_strategies_findings')
            .update({
              kind: f.kind,
              bucket: f.bucket,
              verdict: f.verdict,
              severity: f.severity,
              declaration_site: f.declarationSite,
              affected_url_count: f.affectedUrlCount,
              page_url: f.pageUrl,
              detail: f.detail,
              auto_fixable: f.autoFixable,
              report_only: f.reportOnly,
              surface_class: f.surfaceClass,
              proposed_diff: f.proposedDiff,
              evidence_values: f.evidenceValues,
              source_rows: f.sourceRows,
              detect_origin: originNorm,
              last_seen_run_id: runId,
              last_seen_at: now,
              updated_at: now,
              ...(nextStatus ? { status: nextStatus } : {}),
            })
            .eq('id', findingId)
          if (error) throw new Error(error.message)
        } else {
          const { data: inserted, error } = await db()
            .from('fix_strategies_findings')
            .insert({
              site_id: siteId,
              detect_origin: originNorm,
              user_id: userId,
              topic_id: f.topicId,
              kind: f.kind,
              bucket: f.bucket,
              verdict: f.verdict,
              severity: f.severity,
              rollup_key: f.rollupKey,
              declaration_site: f.declarationSite,
              affected_url_count: f.affectedUrlCount,
              page_url: f.pageUrl,
              detail: f.detail,
              auto_fixable: f.autoFixable,
              report_only: f.reportOnly,
              surface_class: f.surfaceClass,
              proposed_diff: f.proposedDiff,
              evidence_values: f.evidenceValues,
              source_rows: f.sourceRows,
              first_seen_run_id: runId,
              last_seen_run_id: runId,
              first_seen_at: now,
              last_seen_at: now,
            })
            .select('id')
            .single()
          if (error || !inserted) throw new Error(error?.message ?? 'insert finding')
          findingId = String(inserted.id)
        }

        await db()
          .from('fix_strategies_finding_observations')
          .upsert(
            { finding_id: findingId, run_id: runId, observed_at: now },
            { onConflict: 'finding_id,run_id' },
          )
      }

      for (const e of internalEvidence as DetectorEmit[]) {
        let findingId: string | null = null
        let matchQuery = db()
          .from('fix_strategies_findings')
          .select('id')
          .eq('topic_id', e.topicId)
          .limit(1)
        if (siteId) {
          matchQuery = matchQuery.eq('site_id', siteId)
        } else {
          matchQuery = matchQuery
            .is('site_id', null)
            .eq('user_id', userId)
            .eq('detect_origin', originNorm)
        }
        const { data: match } = await matchQuery.maybeSingle()
        if (match) findingId = String(match.id)

        await db().from('fix_strategies_finding_evidence').insert({
          finding_id: findingId,
          run_id: runId,
          topic_id: e.topicId,
          verdict: e.verdict,
          detail: e.detail,
          page_url: e.pageUrl || null,
        })
      }
    },

    async resolveAbsentFindings({ siteId, detectOrigin, userId, runId }) {
      const originNorm = detectOrigin?.replace(/\/$/, '') ?? null
      const now = new Date().toISOString()
      let q = db()
        .from('fix_strategies_findings')
        .update({ status: 'resolved', resolved_at: now, updated_at: now })
        .neq('bucket', 'internal')
        .neq('status', 'resolved')
        .neq('last_seen_run_id', runId)
      q = siteId
        ? q.eq('site_id', siteId)
        : q.is('site_id', null).eq('user_id', userId).eq('detect_origin', originNorm)
      const { data, error } = await q.select('id')
      if (error) throw new Error(error.message)
      return { resolvedCount: (data ?? []).length }
    },

    async appendRunEmits(runId, emits) {
      if (emits.length === 0) return
      const rows = emits.map((e) => ({
        run_id: runId,
        payload: e,
      }))
      const { error } = await db().from('fix_strategies_run_emits').insert(rows)
      if (error) throw new Error(error.message)
    },

    async replaceRunEmitsForTopic(runId, topicId, emits) {
      const { error: delErr } = await db()
        .from('fix_strategies_run_emits')
        .delete()
        .eq('run_id', runId)
        .filter('payload->>topicId', 'eq', topicId)
      if (delErr) throw new Error(delErr.message)
      await this.appendRunEmits(runId, emits)
    },

    async listRunEmits(runId) {
      const { data, error } = await db()
        .from('fix_strategies_run_emits')
        .select('payload')
        .eq('run_id', runId)
        .order('created_at', { ascending: true })
      if (error) throw new Error(error.message)
      return (data ?? []).map((r) => r.payload as DetectorEmit)
    },

    async clearRunEvidence(runId) {
      const { error } = await db()
        .from('fix_strategies_finding_evidence')
        .delete()
        .eq('run_id', runId)
      if (error) throw new Error(error.message)
    },

    async listFindings({
      siteId,
      detectOrigin,
      userId,
      includeInformational,
    }) {
      let q = db()
        .from('fix_strategies_findings')
        .select('*')
        .neq('bucket', 'internal')
        .order('last_seen_at', { ascending: false })
      if (siteId) {
        q = q.eq('site_id', siteId)
      } else if (detectOrigin) {
        q = q
          .is('site_id', null)
          .eq('detect_origin', detectOrigin.replace(/\/$/, ''))
        if (userId) q = q.eq('user_id', userId)
      } else {
        return []
      }
      if (!includeInformational) {
        q = q.eq('bucket', 'actionable')
      } else {
        q = q.in('bucket', ['actionable', 'informational'])
      }
      const { data, error } = await q
      if (error) throw new Error(error.message)
      return (data ?? []).map((r) => mapFinding(r as Record<string, unknown>))
    },

    async getFinding(id) {
      const { data, error } = await db()
        .from('fix_strategies_findings')
        .select('*')
        .eq('id', id)
        .maybeSingle()
      if (error) throw new Error(error.message)
      return data ? mapFinding(data as Record<string, unknown>) : null
    },

    async listEvidenceForFinding(findingId) {
      const { data, error } = await db()
        .from('fix_strategies_finding_evidence')
        .select('*')
        .eq('finding_id', findingId)
        .order('created_at', { ascending: true })
      if (error) throw new Error(error.message)
      return (data ?? []).map((r) => mapEvidence(r as Record<string, unknown>))
    },

    async counts({ siteId, detectOrigin, userId }) {
      let q = db().from('fix_strategies_findings').select('bucket')
      if (siteId) {
        q = q.eq('site_id', siteId)
      } else if (detectOrigin) {
        q = q
          .is('site_id', null)
          .eq('detect_origin', detectOrigin.replace(/\/$/, ''))
        if (userId) q = q.eq('user_id', userId)
      } else {
        return { actionable: 0, informational: 0, internal: 0 }
      }
      const { data, error } = await q
      if (error) throw new Error(error.message)
      let actionable = 0
      let informational = 0
      let internal = 0
      for (const row of data ?? []) {
        if (row.bucket === 'actionable') actionable++
        else if (row.bucket === 'informational') informational++
        else internal++
      }
      if (siteId) {
        const { count: evidenceCount, error: eErr } = await db()
          .from('fix_strategies_finding_evidence')
          .select('id, fix_strategies_crawl_runs!inner(site_id)', {
            count: 'exact',
            head: true,
          })
          .eq('fix_strategies_crawl_runs.site_id', siteId)
        if (!eErr && evidenceCount != null) internal += evidenceCount
      }
      return { actionable, informational, internal }
    },
  }
}

export function supabaseFindingsStoreAvailable(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
      process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
  )
}
