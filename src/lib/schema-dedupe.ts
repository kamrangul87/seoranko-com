// Strip model-generated JSON-LD so we inject exactly one authoritative set.

const SCHEMA_SCRIPT_RE = /<script[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi

function scriptTypes(scriptHtml: string): string[] {
  const jsonMatch = scriptHtml.match(/<script[^>]*>([\s\S]*?)<\/script>/i)
  if (!jsonMatch) return []
  try {
    const parsed = JSON.parse(jsonMatch[1].trim())
    const items = Array.isArray(parsed) ? parsed : [parsed]
    const types: string[] = []
    for (const item of items) {
      const t = item?.['@type']
      if (!t) continue
      if (Array.isArray(t)) types.push(...t.map(String))
      else types.push(String(t))
    }
    return types
  } catch {
    return []
  }
}

const REPLACEABLE_TYPES = new Set([
  'Article',
  'BlogPosting',
  'NewsArticle',
  'FAQPage',
  'HowTo',
  'BreadcrumbList',
  'Organization',
  'WebPage',
])

/**
 * Remove JSON-LD blocks the model invented for Article/FAQ/etc.
 * Keeps unrelated schemas. Prevents duplicate Article when we append ours.
 */
export function stripReplaceableJsonLd(html: string): string {
  return html.replace(SCHEMA_SCRIPT_RE, (script) => {
    const types = scriptTypes(script)
    if (types.length === 0) return '' // broken JSON-LD — drop
    if (types.some(t => REPLACEABLE_TYPES.has(t))) return ''
    return script
  })
}

export function countSchemaType(html: string, type: string): number {
  let count = 0
  const re = new RegExp(SCHEMA_SCRIPT_RE.source, 'gi')
  let match: RegExpExecArray | null
  while ((match = re.exec(html)) !== null) {
    if (scriptTypes(match[0]).includes(type)) count++
  }
  return count
}
