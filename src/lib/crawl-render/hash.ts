import { createHash } from 'crypto'

export function hashHtml(html: string): string {
  return createHash('sha256').update(html, 'utf8').digest('hex')
}
