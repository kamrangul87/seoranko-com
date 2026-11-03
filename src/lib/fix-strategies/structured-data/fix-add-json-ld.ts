/**
 * Insert a <script type="application/ld+json">…</script> block with the given JSON-LD.
 * Idempotent-ish: if a matching @type block that includes the same headline/name exists,
 * returns a noop.
 */

export function addJsonLdScript(
  fileContent: string,
  jsonLd: Record<string, unknown>,
): { html: string; updated: number } {
  const type = String((jsonLd as any)['@type'] || '').toLowerCase()
  const headline: string | null = typeof (jsonLd as any).headline === 'string' ? ((jsonLd as any).headline as string) : null
  const q0: string | null =
    Array.isArray((jsonLd as any).mainEntity) &&
    (jsonLd as any).mainEntity[0] &&
    typeof (jsonLd as any).mainEntity[0].name === 'string'
      ? ((jsonLd as any).mainEntity[0].name as string)
      : null

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

