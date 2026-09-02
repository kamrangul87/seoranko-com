/** Generic anchor phrases — config file, not inline in rules. Spec §5.3 */

export const GENERIC_ANCHORS_EN = [
  'click here',
  'here',
  'read more',
  'more',
  'learn more',
  'this page',
  'link',
  'this',
  'continue',
  'find out more',
  'see more',
  'details',
  'download',
] as const

/** Minimal localized extras keyed by BCP-47 language prefix. */
export const GENERIC_ANCHORS_BY_LANG: Record<string, string[]> = {
  en: [...GENERIC_ANCHORS_EN],
  fr: ['cliquez ici', 'en savoir plus', 'lire la suite', 'ici', 'plus'],
  de: ['hier klicken', 'mehr erfahren', 'weiterlesen', 'hier', 'mehr'],
  es: ['haz clic aquí', 'leer más', 'aquí', 'más', 'más información'],
}

export function genericAnchorSet(lang?: string): Set<string> {
  const prefix = (lang || 'en').toLowerCase().slice(0, 2)
  const list = GENERIC_ANCHORS_BY_LANG[prefix] || GENERIC_ANCHORS_BY_LANG.en!
  return new Set(list.map((s) => s.toLowerCase()))
}

export function isGenericAnchor(text: string, lang?: string): boolean {
  const t = text.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!t) return false
  return genericAnchorSet(lang).has(t)
}

export function isBareUrlAnchor(text: string): boolean {
  const t = text.trim()
  return /^https?:\/\//i.test(t) || /^www\./i.test(t)
}
