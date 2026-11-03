import { inspectDocumentHead } from '@/lib/fix-strategies/shared'

export type TitleMetaSuggestion = {
  url: string
  currentTitle: string | null
  currentDescription: string | null
  suggestedTitle: string | null
  suggestedDescription: string | null
  targetedQueries: string[]
}

function stripTags(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function topQueries(queries: string[], limit = 3): string[] {
  const unique: string[] = []
  for (const q of queries) {
    const t = q.trim()
    if (!t) continue
    if (!unique.includes(t)) unique.push(t)
    if (unique.length >= limit) break
  }
  return unique
}

function within(chars: number, s: string): string {
  if (s.length <= chars) return s
  // Trim on last space before limit
  const cut = s.slice(0, chars + 1)
  const idx = cut.lastIndexOf(' ')
  return (idx > 0 ? cut.slice(0, idx) : cut.slice(0, chars)).trim()
}

function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/i)
      .filter(Boolean),
  )
}

/** Build safe title/description suggestions using only words already on the page. */
export function suggestTitleAndDescription(input: {
  url: string
  html: string
  queries: string[]
  titleMaxChars?: number
  descriptionMaxChars?: number
}): TitleMetaSuggestion {
  const titleMax = input.titleMaxChars ?? 60
  const descMax = input.descriptionMaxChars ?? 160
  const head = inspectDocumentHead(input.html)
  const currentTitle =
    head.titlesInHead[0]?.text?.trim() ||
    input.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ||
    null
  const currentDescription = head.descriptionsInHead[0]?.content?.trim() || null

  // Visible text tokens to guard against inventing facts
  const bodyText = stripTags(input.html || '')
  const bodyTokens = tokens(`${currentTitle || ''} ${bodyText}`)

  // Filter query phrases to those whose words appear in body tokens.
  const top = topQueries(input.queries, 3)
  const allowedQueries = top.filter((q) => {
    const qTokens = tokens(q)
    // Allow when majority of query tokens are present on page
    const present = Array.from(qTokens).filter((t) => bodyTokens.has(t))
    return present.length >= Math.max(1, Math.ceil(qTokens.size * 0.6))
  })

  let suggestedTitle: string | null = null
  if (currentTitle) {
    // Compose a title by appending one allowed query segment not already present
    const already = currentTitle.toLowerCase()
    const add = allowedQueries.find((q) => !already.includes(q.toLowerCase()))
    suggestedTitle = within(titleMax, add ? `${currentTitle} — ${add}` : currentTitle)
    if (suggestedTitle === currentTitle) {
      // If unchanged, keep null to avoid no-op suggestions
      suggestedTitle = null
    }
  }

  let suggestedDescription: string | null = null
  const baseDesc =
    currentDescription ||
    within(descMax, bodyText.slice(0, Math.min(240, bodyText.length)))
  if (baseDesc) {
    const lower = baseDesc.toLowerCase()
    const adds: string[] = []
    for (const q of allowedQueries) {
      if (!lower.includes(q.toLowerCase())) {
        adds.push(q)
      }
      if (adds.length >= 2) break
    }
    const combined =
      adds.length > 0 ? within(descMax, `${baseDesc} — ${adds.join(' · ')}`) : baseDesc
    suggestedDescription = combined !== currentDescription ? combined : null
  }

  return {
    url: input.url,
    currentTitle,
    currentDescription,
    suggestedTitle,
    suggestedDescription,
    targetedQueries: allowedQueries,
  }
}

