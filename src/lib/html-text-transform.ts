/**
 * HTML text-node transforms + image URL integrity guards.
 *
 * Auto-fixes that rewrite prose must never touch attribute values (src/href/
 * content/…), <script> JSON-LD, or <style> blocks — those hold Supabase Storage
 * URLs and schema that a naive whole-HTML regex will corrupt (e.g. treating
 * "ddfboapzwclecbdjoqex.supabase" as a merge artifact and dropping "supabase").
 */

const VOID_OR_RAW_CLOSE = /^\/?(script|style|noscript)$/i

/**
 * Apply `transform` only to visible/textable character data between tags.
 * Raw text inside <script> / <style> / <noscript> is left untouched.
 * Tag markup (including every attribute value) is never passed to `transform`.
 */
export function transformHtmlTextNodes(
  html: string,
  transform: (text: string) => string,
): string {
  if (!html) return html

  let out = ''
  let i = 0
  let rawDepth = 0 // >0 while inside script/style/noscript

  while (i < html.length) {
    const lt = html.indexOf('<', i)
    if (lt === -1) {
      const rest = html.slice(i)
      out += rawDepth > 0 ? rest : transform(rest)
      break
    }

    if (lt > i) {
      const text = html.slice(i, lt)
      out += rawDepth > 0 ? text : transform(text)
    }

    const gt = html.indexOf('>', lt + 1)
    if (gt === -1) {
      // Malformed tag — pass through remainder untouched
      out += html.slice(lt)
      break
    }

    const tag = html.slice(lt, gt + 1)
    out += tag

    const nameMatch = tag.match(/^<\/?\s*([a-zA-Z][\w:-]*)/)
    const name = nameMatch?.[1] ?? ''
    if (VOID_OR_RAW_CLOSE.test(name)) {
      if (tag.startsWith('</')) {
        rawDepth = Math.max(0, rawDepth - 1)
      } else if (!tag.endsWith('/>')) {
        rawDepth += 1
      }
    }

    i = gt + 1
  }

  return out
}

/** Collect every img/src (and matching meta/schema URL strings) we must preserve. */
export function collectImageUrls(html: string): string[] {
  const urls: string[] = []
  const seen = new Set<string>()
  const push = (u: string) => {
    const t = u.trim()
    if (!t || seen.has(t)) return
    seen.add(t)
    urls.push(t)
  }

  for (const m of Array.from(html.matchAll(/\bsrc=["']([^"']+)["']/gi))) push(m[1])
  for (const m of Array.from(html.matchAll(/\bcontent=["'](https?:\/\/[^"']+)["']/gi))) {
    const lookbehind = html.slice(Math.max(0, (m.index ?? 0) - 80), m.index ?? 0)
    if (/image|og:image|twitter:image/i.test(lookbehind) || /\.(png|jpe?g|webp|gif)(\?|$)/i.test(m[1])) {
      push(m[1])
    }
  }
  // JSON-LD "image": "https://..."
  for (const m of Array.from(html.matchAll(/"image"\s*:\s*"(https?:\/\/[^"]+)"/gi))) push(m[1])
  for (const m of Array.from(html.matchAll(/"url"\s*:\s*"(https?:\/\/[^"]+\.(?:png|jpe?g|webp|gif)[^"]*)"/gi))) push(m[1])

  return urls
}

export function isSupabaseStorageUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return (
      u.protocol === 'https:' &&
      /\.supabase\.co$/i.test(u.hostname) &&
      u.pathname.includes('/storage/')
    )
  } catch {
    return false
  }
}

/**
 * Hard post-condition: every image URL present before an auto-fix pass must
 * still appear verbatim afterward. Throws if any were altered or dropped.
 */
export function assertImageUrlsPreserved(beforeHtml: string, afterHtml: string): void {
  const before = collectImageUrls(beforeHtml)
  if (before.length === 0) return

  for (const url of before) {
    if (!afterHtml.includes(url)) {
      // Helpful hint when supabase subdomain was stripped
      const stripped = url.replace(/\.supabase\.co/gi, '.co')
      const hint = afterHtml.includes(stripped)
        ? ` (found corrupted form without ".supabase": ${stripped.slice(0, 80)}…)`
        : ''
      throw new Error(
        `Image URL was altered or removed by an auto-fix pass.${hint} Expected intact: ${url}`,
      )
    }
  }

  // If inputs were valid Supabase Storage URLs, require they still match the pattern
  for (const url of before) {
    if (isSupabaseStorageUrl(url) && !isSupabaseStorageUrl(url)) {
      // unreachable — url unchanged; kept for clarity of contract
    }
    if (isSupabaseStorageUrl(url)) {
      const still = collectImageUrls(afterHtml).filter(u => u === url)
      if (still.length === 0 || !still.every(isSupabaseStorageUrl)) {
        throw new Error(`Supabase Storage image URL no longer valid after auto-fix: ${url}`)
      }
    }
  }
}
