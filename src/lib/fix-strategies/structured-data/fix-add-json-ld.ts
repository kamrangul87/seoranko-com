/**
 * Insert a <script type="application/ld+json">…</script> block with the given JSON-LD.
 * Idempotent-ish: if a matching @type block that includes the same headline/name exists,
 * returns a noop.
 */

export function addJsonLdScript(
  fileContent: string,
  jsonLd: Record<string, unknown>,
): { html: string; updated: number } {
  const getString = (obj: unknown, key: string): string | null => {
    if (!obj || typeof obj !== 'object') return null
    const v = (obj as Record<string, unknown>)[key]
    return typeof v === 'string' ? v : null
  }
  const getFirstMainEntityName = (obj: unknown): string | null => {
    if (!obj || typeof obj !== 'object') return null
    const me = (obj as Record<string, unknown>)['mainEntity']
    if (!Array.isArray(me)) return null
    const first = me[0]
    if (!first || typeof first !== 'object') return null
    const name = (first as Record<string, unknown>)['name']
    return typeof name === 'string' ? name : null
  }

  const type = (getString(jsonLd, '@type') ?? '').toLowerCase()
  const headline = getString(jsonLd, 'headline')
  const q0 = getFirstMainEntityName(jsonLd)

  // Basic duplicate guard: same @type with same headline/name string already present.
  const needle = headline || q0
  if (needle) {
    const re = new RegExp(
      `<script[^>]*application/ld\\+json[^>]*>[^<]*"@type"\\s*:\\s*"${type.replace(
        /[-/\\^$*+?.()|[\]{}]/g,
        '\\$&',
      )}"[\\s\\S]*${needle.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}[\\s\\S]*?<\\/script>`,
      'i',
    )
    if (re.test(fileContent)) {
      return { html: fileContent, updated: 0 }
    }
  }

  const block =
    `<script type="application/ld+json">` +
    JSON.stringify(jsonLd) +
    `</script>`

  if (/<\/head>/i.test(fileContent)) {
    return {
      html: fileContent.replace(/<\/head>/i, `${block}\n</head>`),
      updated: 1,
    }
  }
  if (/<\/body>/i.test(fileContent)) {
    return {
      html: fileContent.replace(/<\/body>/i, `${block}\n</body>`),
      updated: 1,
    }
  }
  return { html: `${fileContent}\n${block}\n`, updated: 1 }
}

