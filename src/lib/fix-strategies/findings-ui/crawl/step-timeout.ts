/**
 * Hard wall-clock budget for a single crawl step (fetch / render / probe /
 * detectors). One hung page must never stall the tick.
 */

export class StepTimeoutError extends Error {
  readonly step: string
  readonly budgetMs: number

  constructor(step: string, budgetMs: number) {
    super(`step_timeout:${step}:${budgetMs}ms`)
    this.name = 'StepTimeoutError'
    this.step = step
    this.budgetMs = budgetMs
  }
}

export function isStepTimeoutError(err: unknown): err is StepTimeoutError {
  return err instanceof StepTimeoutError
}

/**
 * Race `work` against a timer. Does not cancel the underlying work (fetch
 * AbortSignal should be used where available); guarantees the await returns.
 */
export async function withStepTimeout<T>(
  step: string,
  budgetMs: number,
  work: () => Promise<T>,
): Promise<T> {
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) {
    return work()
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new StepTimeoutError(step, budgetMs))
        }, budgetMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
