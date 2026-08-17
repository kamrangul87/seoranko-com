/** Shared URL slug helper — never leave leading/trailing hyphens. */

export function toSlug(text: string, maxLen = 80): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLen)
    .replace(/-+$/g, '')
}

/** Path form with leading slash, empty → "/". */
export function toSlugPath(text: string, maxLen = 80): string {
  const slug = toSlug(text, maxLen)
  return slug ? `/${slug}` : '/'
}
