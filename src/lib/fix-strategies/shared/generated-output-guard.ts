export type FixTargetAction = 'fix-generator' | 'fix-artefact' | 'human-review'

export type FixTargetResult = {
  action: FixTargetAction
  targetPath: string | null
  reason: string
}

export type ResolveFixTargetOptions = {
  artefactPath: string
  generatorPath: string | null
  isGenerated: boolean
}

/**
 * Decide whether a fix should edit the generator, the artefact, or go to
 * human review. Never propose editing generated output when a generator is
 * known — that change would be overwritten on the next build.
 */
export function resolveFixTarget(
  opts: ResolveFixTargetOptions,
): FixTargetResult {
  if (opts.isGenerated && opts.generatorPath) {
    return {
      action: 'fix-generator',
      targetPath: opts.generatorPath,
      reason:
        'Artefact is generated; fix the generator so the next build emits the correction.',
    }
  }

  if (opts.isGenerated && !opts.generatorPath) {
    return {
      action: 'human-review',
      targetPath: null,
      reason:
        'Artefact is generated but no generator path is known; do not edit the output.',
    }
  }

  return {
    action: 'fix-artefact',
    targetPath: opts.artefactPath,
    reason: 'Artefact is hand-maintained; edit it directly.',
  }
}
