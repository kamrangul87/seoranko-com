/**
 * Findings + crawl-run persistence.
 * In-memory store for tests / live verification without Supabase;
 * Supabase adapter when SERVICE_ROLE is configured.
 */

import { randomUUID } from 'node:crypto'
import type {
  CoverageNote,
  CrawlRunRecord,
  CrawlRunStatus,
  CrawlUrlJob,
  CrawlUrlJobStatus,
  PersistedEvidenceRow,
  PersistedFindingRow,
} from './constants'
import { CRAWL_URL_CHUNK_SIZE } from './constants'
import type { RolledPersistCandidate, DetectorEmit } from './run-detectors'
import {
  createSupabaseFindingsStore,
  supabaseFindingsStoreAvailable,
} from './supabase-store'

export type FindingsStore = {
  createRun(input: {
    siteId: string
    userId: string
    origin: string
  }): Promise<CrawlRunRecord>
  getRun(runId: string): Promise<CrawlRunRecord | null>
  listRunsForSite(siteId: string): Promise<CrawlRunRecord[]>
  updateRun(
    runId: string,
    patch: Partial<CrawlRunRecord>,
  ): Promise<CrawlRunRecord>
  enqueueUrls(runId: string, urls: string[]): Promise<void>
  /** How many newly enqueued (not already present). */
  enqueueUrlsReturningNew(
    runId: string,
    urls: string[],
  ): Promise<number>
  claimUrlChunk(
    runId: string,
    limit: number,
  ): Promise<CrawlUrlJob[]>
  updateUrlJob(
    jobId: string,
    patch: Partial<CrawlUrlJob>,
  ): Promise<void>
  listJobsForRun(runId: string): Promise<CrawlUrlJob[]>
  countJobsByStatus(
    runId: string,
  ): Promise<Record<CrawlUrlJobStatus, number>>
  upsertFindings(input: {
    siteId: string
    userId: string
    runId: string
    findings: RolledPersistCandidate[]
    internalEvidence: DetectorEmit[]
  }): Promise<void>
  /** Stage page-level detector emits for a run (re-rolled on each tick). */
  appendRunEmits(runId: string, emits: DetectorEmit[]): Promise<void>
  /** Drop emits for a topic then append replacements (full-run recompute). */
  replaceRunEmitsForTopic(
    runId: string,
    topicId: string,
    emits: DetectorEmit[],
  ): Promise<void>
  listRunEmits(runId: string): Promise<DetectorEmit[]>
  clearRunEvidence(runId: string): Promise<void>
  listFindings(input: {
    siteId: string
    includeInformational: boolean
  }): Promise<PersistedFindingRow[]>
  getFinding(id: string): Promise<PersistedFindingRow | null>
  listEvidenceForFinding(findingId: string): Promise<PersistedEvidenceRow[]>
  counts(siteId: string): Promise<{
    actionable: number
    informational: number
    internal: number
  }>
}

type MemState = {
  runs: Map<string, CrawlRunRecord>
  jobs: Map<string, CrawlUrlJob>
  findings: Map<string, PersistedFindingRow>
  observations: Set<string>
  evidence: PersistedEvidenceRow[]
  runEmits: Map<string, DetectorEmit[]>
}

const g = globalThis as unknown as { __fsFindingsStore?: MemState }

/** Process-wide default store. Prefer Supabase when SERVICE_ROLE is set. */
let activeStore: FindingsStore | null = null
let preferMemory = false

function state(): MemState {
  if (!g.__fsFindingsStore) {
    g.__fsFindingsStore = {
      runs: new Map(),
      jobs: new Map(),
      findings: new Map(),
      observations: new Set(),
      evidence: [],
      runEmits: new Map(),
    }
  }
  return g.__fsFindingsStore
}

export function resetMemoryFindingsStore(): void {
  g.__fsFindingsStore = {
    runs: new Map(),
    jobs: new Map(),
    findings: new Map(),
    observations: new Set(),
    evidence: [],
    runEmits: new Map(),
  }
  activeStore = null
}

function findingKey(siteId: string, topicId: string, rollupKey: string): string {
  return `${siteId}::${topicId}::${rollupKey}`
}

export function createMemoryFindingsStore(): FindingsStore {
  return {
    async createRun({ siteId, userId, origin }) {
      const now = new Date().toISOString()
      const run: CrawlRunRecord = {
        id: randomUUID(),
        siteId,
        userId,
        origin,
        status: 'queued',
        chunkSize: CRAWL_URL_CHUNK_SIZE,
        urlsFound: 0,
        urlsDiscovered: 0,
        urlsCrawled: 0,
        urlsFailed: 0,
        urlsClientOnly: 0,
        urlsSkippedOffHost: 0,
        urlCap: null,
        discoverySeeds: null,
        coverageNotes: [],
        isPartial: false,
        errorDetail: null,
        startedAt: null,
        finishedAt: null,
        createdAt: now,
        updatedAt: now,
      }
      state().runs.set(run.id, run)
      return run
    },

    async getRun(runId) {
      return state().runs.get(runId) ?? null
    },

    async listRunsForSite(siteId) {
      return Array.from(state().runs.values())
        .filter((r) => r.siteId === siteId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    },

    async updateRun(runId, patch) {
      const cur = state().runs.get(runId)
      if (!cur) throw new Error(`run not found: ${runId}`)
      const next = {
        ...cur,
        ...patch,
        updatedAt: new Date().toISOString(),
      }
      state().runs.set(runId, next)
      return next
    },

    async enqueueUrls(runId, urls) {
      for (const url of urls) {
        const id = randomUUID()
        const job: CrawlUrlJob = {
          id,
          runId,
          url,
          status: 'queued',
          httpStatus: null,
          finalUrl: null,
          streamComplete: null,
          clientOnly: false,
          crawlerCausedBackoff: false,
          errorDetail: null,
          html: null,
        }
        // De-dupe by run+url
        const exists = Array.from(state().jobs.values()).some(
          (j) => j.runId === runId && j.url === url,
        )
        if (!exists) state().jobs.set(id, job)
      }
    },

    async enqueueUrlsReturningNew(runId, urls) {
      let added = 0
      for (const url of urls) {
        const exists = Array.from(state().jobs.values()).some(
          (j) => j.runId === runId && j.url === url,
        )
        if (exists) continue
        const id = randomUUID()
        state().jobs.set(id, {
          id,
          runId,
          url,
          status: 'queued',
          httpStatus: null,
          finalUrl: null,
          streamComplete: null,
          clientOnly: false,
          crawlerCausedBackoff: false,
          errorDetail: null,
          html: null,
        })
        added++
      }
      return added
    },

    async claimUrlChunk(runId, limit) {
      const queued = Array.from(state().jobs.values())
        .filter((j) => j.runId === runId && j.status === 'queued')
        .slice(0, limit)
      for (const j of queued) {
        j.status = 'running'
        state().jobs.set(j.id, j)
      }
      return queued
    },

    async updateUrlJob(jobId, patch) {
      const cur = state().jobs.get(jobId)
      if (!cur) return
      state().jobs.set(jobId, { ...cur, ...patch })
    },

    async listJobsForRun(runId) {
      return Array.from(state().jobs.values()).filter((j) => j.runId === runId)
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
      for (const j of state().jobs.values()) {
        if (j.runId === runId) counts[j.status]++
      }
      return counts
    },

    async upsertFindings({ siteId, userId, runId, findings, internalEvidence }) {
      const now = new Date().toISOString()
      for (const f of findings) {
        const key = findingKey(siteId, f.topicId, f.rollupKey)
        const existing = state().findings.get(key)
        if (existing) {
          const updated: PersistedFindingRow = {
            ...existing,
            kind: f.kind,
            bucket: f.bucket,
            verdict: f.verdict,
            detail: f.detail,
            severity: f.severity,
            affectedUrlCount: f.affectedUrlCount,
            pageUrl: f.pageUrl,
            declarationSite: f.declarationSite,
            autoFixable: f.autoFixable,
            reportOnly: f.reportOnly,
            surfaceClass: f.surfaceClass,
            proposedDiff: f.proposedDiff,
            evidenceValues: f.evidenceValues,
            sourceRows: f.sourceRows,
            lastSeenRunId: runId,
            lastSeenAt: now,
          }
          state().findings.set(key, updated)
          state().observations.add(`${updated.id}::${runId}`)
        } else {
          const row: PersistedFindingRow = {
            id: randomUUID(),
            siteId,
            userId,
            topicId: f.topicId,
            kind: f.kind,
            bucket: f.bucket,
            verdict: f.verdict,
            severity: f.severity,
            rollupKey: f.rollupKey,
            declarationSite: f.declarationSite,
            affectedUrlCount: f.affectedUrlCount,
            pageUrl: f.pageUrl,
            detail: f.detail,
            autoFixable: f.autoFixable,
            reportOnly: f.reportOnly,
            surfaceClass: f.surfaceClass,
            proposedDiff: f.proposedDiff,
            evidenceValues: f.evidenceValues,
            sourceRows: f.sourceRows,
            firstSeenRunId: runId,
            lastSeenRunId: runId,
            firstSeenAt: now,
            lastSeenAt: now,
          }
          state().findings.set(key, row)
          state().observations.add(`${row.id}::${runId}`)
        }
      }

      for (const e of internalEvidence) {
        let findingId: string | null = null
        for (const f of state().findings.values()) {
          if (
            f.siteId === siteId &&
            f.topicId === e.topicId &&
            (e.pageUrl === '' || f.pageUrl === e.pageUrl)
          ) {
            findingId = f.id
            break
          }
        }
        state().evidence.push({
          id: randomUUID(),
          findingId,
          runId,
          topicId: e.topicId,
          verdict: e.verdict,
          detail: e.detail,
          pageUrl: e.pageUrl || null,
        })
      }
    },

    async appendRunEmits(runId, emits) {
      const cur = state().runEmits.get(runId) ?? []
      state().runEmits.set(runId, cur.concat(emits))
    },

    async replaceRunEmitsForTopic(runId, topicId, emits) {
      const cur = state().runEmits.get(runId) ?? []
      state().runEmits.set(
        runId,
        cur.filter((e) => e.topicId !== topicId).concat(emits),
      )
    },

    async listRunEmits(runId) {
      return state().runEmits.get(runId) ?? []
    },

    async clearRunEvidence(runId) {
      state().evidence = state().evidence.filter((e) => e.runId !== runId)
    },

    async listFindings({ siteId, includeInformational }) {
      return Array.from(state().findings.values())
        .filter((f) => f.siteId === siteId)
        .filter((f) => {
          if (f.bucket === 'internal') return false
          if (f.bucket === 'informational') return includeInformational
          return f.bucket === 'actionable'
        })
        .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
    },

    async getFinding(id) {
      for (const f of state().findings.values()) {
        if (f.id === id) return f
      }
      return null
    },

    async listEvidenceForFinding(findingId) {
      return state().evidence.filter((e) => e.findingId === findingId)
    },

    async counts(siteId) {
      let actionable = 0
      let informational = 0
      let internal = 0
      for (const f of state().findings.values()) {
        if (f.siteId !== siteId) continue
        if (f.bucket === 'actionable') actionable++
        else if (f.bucket === 'informational') informational++
        else internal++
      }
      // Internal evidence rows also count toward internal total
      const evidenceInternal = state().evidence.filter((e) => {
        const run = state().runs.get(e.runId)
        return run?.siteId === siteId
      }).length
      internal += evidenceInternal
      return { actionable, informational, internal }
    },
  }
}

/** Prefer Supabase when SERVICE_ROLE is set (unless tests force memory). */
export function getFindingsStore(): FindingsStore {
  if (activeStore) return activeStore
  if (!preferMemory && supabaseFindingsStoreAvailable()) {
    activeStore = createSupabaseFindingsStore()
    return activeStore
  }
  activeStore = createMemoryFindingsStore()
  return activeStore
}

export function setFindingsStore(store: FindingsStore): void {
  activeStore = store
  preferMemory = true
}

/** Force in-memory store (tests / live verification without Supabase). */
export function useMemoryFindingsStore(): FindingsStore {
  preferMemory = true
  activeStore = createMemoryFindingsStore()
  return activeStore
}

export type { CoverageNote, CrawlRunStatus }
