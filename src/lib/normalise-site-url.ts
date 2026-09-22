/** Scheme + host only; refuse local / private network targets. */
import { isSafePublicUrl } from './fetch-page-content'

export function normaliseSiteUrl(input: string): string | null {
  const bare = input.replace(/^https?:\/\//, '').split('/')[0]
  const url = `https://${bare}`
  return isSafePublicUrl(url) ? url : null
}
