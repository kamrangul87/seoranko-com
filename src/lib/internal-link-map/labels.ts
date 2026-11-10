/** Short map labels: title, else last path segment. Never the full URL. */

export const LABEL_MAX_CHARS = 24
export const LABEL_CHAR_W = 6.4
export const LABEL_PILL_PAD_X = 7
export const LABEL_PILL_H = 18

export function shortNodeLabel(input: {
  path: string
  title?: string | null
}): string {
  const title = input.title?.replace(/\s+/g, ' ').trim()
  if (title) return truncateLabel(title)
  const path = (input.path || '').split('?')[0]!.replace(/\/+$/, '')
  if (!path || path === '/') return 'home'
  const parts = path.split('/').filter(Boolean)
  const last = (parts[parts.length - 1] || '').replace(/\.html?$/i, '')
  if (!last) return 'home'
  return truncateLabel(last)
}

export function truncateLabel(raw: string): string {
  const s = raw.trim()
  if (s.length <= LABEL_MAX_CHARS) return s
  return `${s.slice(0, LABEL_MAX_CHARS - 1)}…`
}

export function estimateLabelWidth(label: string): number {
  return Math.ceil(label.length * LABEL_CHAR_W) + LABEL_PILL_PAD_X * 2
}
