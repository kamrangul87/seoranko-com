/**
 * Detect redirect issues for topics 4–7 from ONE chain walk.
 */

import {
  hasNoindexDirective,
  resolveFixTarget,
  type FixTargetResult,
  type HopRecordingDeps,
} from '@/lib/fix-strategies/shared'
import {
  fetchWithEvidence,
  type FetchDeps,
} from '@/lib/fix-strategies/fetch'
import { walkRedirectChain, type ChainWalkResult } from './walk'
import {
  classifyRedirectChain,
  type ClassifyTopic4Result,
} from './classify-topic-4'
import {
  classifyRedirectLoop,
  isTrailingSlashBounceOnly,
  type ClassifyTopic5Result,
} from './classify-topic-5'
import {
  classifyTemporaryWherePermanent,
  type ClassifyTopic6Result,
  type PermanenceEvidence,
} from './classify-topic-6'
import {
  classifyRedirectTargetNot200,
  type ClassifyTopic7Result,
  type TerminalClassification,
} from './classify-topic-7'

export type RedirectTopicsFinding = {
  originUrl: string
  chain: ChainWalkResult
  topic4: ClassifyTopic4Result
  topic5: ClassifyTopic5Result
  topic6: ClassifyTopic6Result
  topic7: ClassifyTopic7Result
  fixTarget: FixTargetResult
}

export type DetectRedirectTopicsResult = {
  findings: RedirectTopicsFinding[]
}

export type DetectRedirectTopicsPage = {
  url: string
  middlewareIndeterminate?: boolean
  intermediateDoesWork?: boolean
  allHopsStaticInRepo?: boolean
  externalRedirect?: boolean
  /** Topic 6 permanence evidence. */
  permanence?: PermanenceEvidence
  originRouteExists?: boolean
  genuineTemporary?: boolean
  /** Observed 302 across crawls (feeds permanence). */
  observedAcrossCrawls?: boolean
  temporaryToUnavailable?: boolean
  autoRemoveEligible?: boolean
  proposedHomepageRepoint?: boolean
  /** Override terminal classification (fixtures). */
  terminalOverride?: TerminalClassification
  /** Topic 70: appDir for repo-declared noindex on terminal. */
  terminalRouteFile?: string | null
  appDir?: string | null
  statefulDependency?: boolean
}

export type DetectRedirectTopicsOptions = {
  deps: HopRecordingDeps
  /** For topic 68 terminal confirmation. */
  fetchDeps?: FetchDeps
  artefactPath?: string
  isGenerated?: boolean
  generatorPath?: string | null
}

/**
 * Walk each URL once; classify topics 4, 5, 6, 7 from the same ChainWalkResult.
 */
export async function detectRedirectTopics(
  pages: DetectRedirectTopicsPage[],
  options: DetectRedirectTopicsOptions,
): Promise<DetectRedirectTopicsResult> {
  const findings: RedirectTopicsFinding[] = []
  const fixTarget = resolveFixTarget({
    artefactPath: options.artefactPath ?? 'next.config.js',
    isGenerated: options.isGenerated ?? false,
    generatorPath: options.generatorPath ?? null,
  })

  for (const page of pages) {
    const chain = await walkRedirectChain(page.url, options.deps)

    const finalConfirmed200 =
      chain.stoppedReason === 'non-3xx' && chain.finalStatus === 200

    const terminal =
      page.terminalOverride ??
      (await classifyTerminal(chain, page, options))

    const permanence: PermanenceEvidence = page.permanence ?? {
      originAbsentFromRepo: page.originRouteExists === false,
      observedAcrossCrawls: page.observedAcrossCrawls === true,
      staticConfigDeclaration: page.allHopsStaticInRepo === true,
    }

    const topic4 = classifyRedirectChain({
      chain,
      middlewareIndeterminate: page.middlewareIndeterminate,
      intermediateDoesWork: page.intermediateDoesWork,
      allHopsStaticInRepo: page.allHopsStaticInRepo,
      finalConfirmed200,
      externalRedirect: page.externalRedirect,
    })

    // Trailing-slash bounce must not be raised as a loop (topic 5 guard 1)
    let topic5 = classifyRedirectLoop({
      chain,
      middlewareIndeterminate: page.middlewareIndeterminate,
      statefulDependency: page.statefulDependency,
    })
    if (
      topic5.verdict === 'finding-loop' &&
      isTrailingSlashBounceOnly(chain)
    ) {
      topic5 = {
        verdict: 'route-topic-8-trailing-slash-bounce',
        detail:
          'Trailing-slash bounce (/page ↔ /page/) — topic 8, not a loop (normalisation must not collapse slash)',
        cycle: null,
      }
    }

    const topic6 = classifyTemporaryWherePermanent({
      chain,
      evidence: permanence,
      originRouteExists: page.originRouteExists,
      genuineTemporary: page.genuineTemporary,
      middlewareIndeterminate: page.middlewareIndeterminate,
    })

    const topic7 = classifyRedirectTargetNot200({
      chain,
      terminal,
      middlewareIndeterminate: page.middlewareIndeterminate,
      temporaryToUnavailable: page.temporaryToUnavailable,
      autoRemoveEligible: page.autoRemoveEligible,
      proposedHomepageRepoint: page.proposedHomepageRepoint,
    })

    findings.push({
      originUrl: page.url,
      chain,
      topic4,
      topic5,
      topic6,
      topic7,
      fixTarget,
    })
  }

  return { findings }
}

/**
 * Hand terminal response to existing detectors — do not reimplement.
 * - topic 68: fetchWithEvidence for 4xx confirmation
 * - topic 3: 5xx persistence vs transient (stableAcrossRefetch lite)
 * - topic 2a / 70: hasNoindexDirective + optional repo declaration override
 */
async function classifyTerminal(
  chain: ChainWalkResult,
  page: DetectRedirectTopicsPage,
  options: DetectRedirectTopicsOptions,
): Promise<TerminalClassification> {
  const out: TerminalClassification = {}

  if (chain.stoppedReason !== 'non-3xx' || chain.redirectHopCount === 0) {
    return out
  }

  const status = chain.finalStatus
  const ct = chain.finalHeaders.get('content-type')

  if (status === 200) {
    const noindex = hasNoindexDirective(
      chain.finalHeaders,
      chain.finalBody,
      ct,
    )
    if (!noindex) return out

    // Repo declaration: fixtures pass via terminalOverride; live path uses
    // checkRepoDeclaredNoindex when route file known.
    if (page.terminalRouteFile && page.appDir) {
      const { checkRepoDeclaredNoindex } = await import(
        '@/lib/fix-strategies/shared'
      )
      const declared = checkRepoDeclaredNoindex(
        page.terminalRouteFile,
        page.appDir,
      )
      if (declared === 'true') {
        out.repoDeclaredNoindex = true
      } else {
        out.injectedNoindexSoft404 = true
      }
    } else {
      // Without repo context, treat live noindex as injected (2a) — fixtures
      // should override when testing declared case.
      out.injectedNoindexSoft404 = true
    }
    return out
  }

  if (status >= 500) {
    const fetchDeps = options.fetchDeps
    if (!fetchDeps) {
      // Without re-fetch deps, treat as transient (safer — don't raise topic 7)
      out.transient5xx = true
      return out
    }
    const evidence = await fetchWithEvidence(chain.finalUrl, fetchDeps)
    if (!evidence.stable) {
      out.transient5xx = true
      return out
    }
    const httpAttempts = evidence.attempts.filter((a) => a.kind === 'http')
    const all5xx = httpAttempts.every(
      (a) => a.kind === 'http' && a.status >= 500,
    )
    if (all5xx && httpAttempts.length >= 2) {
      // stableAcrossRefetch — route to topic 3 (not windowed persistent)
      out.persistent5xx = true
    } else {
      out.transient5xx = true
    }
    return out
  }

  if (status >= 400 && status < 500) {
    const fetchDeps = options.fetchDeps
    if (!fetchDeps) {
      // Single observation without topic 68 — do not confirm
      return out
    }
    const evidence = await fetchWithEvidence(chain.finalUrl, fetchDeps)
    if (
      evidence.stable &&
      evidence.outcome.kind === 'http' &&
      evidence.outcome.status >= 400 &&
      evidence.outcome.status < 500
    ) {
      out.confirmed4xx = true
    }
    return out
  }

  return out
}
