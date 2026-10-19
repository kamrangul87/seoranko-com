/**
 * Per-IP signup rate limit (in-process). Defense-in-depth alongside Turnstile.
 * Serverless isolates don't share memory — still blocks burst spam per instance.
 */

export const SIGNUP_RATE_LIMIT_PER_HOUR = 5

const hitsByIp = new Map<string, number[]>()

function prune(ip: string, now = Date.now()): number[] {
  const windowStart = now - 60 * 60 * 1000
  const next = (hitsByIp.get(ip) || []).filter((t) => t >= windowStart)
  hitsByIp.set(ip, next)
  return next
}

/** Returns true if this IP may attempt another signup. */
export function tryConsumeSignupSlot(ip: string): boolean {
  const key = ip || '0.0.0.0'
  const now = Date.now()
  const list = prune(key, now)
  if (list.length >= SIGNUP_RATE_LIMIT_PER_HOUR) return false
  list.push(now)
  hitsByIp.set(key, list)
  return true
}

/** Test helper — clear in-memory counters. */
export function resetSignupRateLimitForTests(): void {
  hitsByIp.clear()
}
