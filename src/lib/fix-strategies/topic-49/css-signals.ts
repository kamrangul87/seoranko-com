/**
 * Topic 49 — CSS checks before applying width/height attributes.
 *
 * Adding attributes without `height: auto` (or equivalent) can change
 * rendered layout (P4). That path is human-review, never auto-fix.
 */

export type ImgCssSignals = {
  hasHeightAuto: boolean
  hasAspectRatio: boolean
  detail: string
}

/**
 * Inspect inline style + `<style>` blocks in the same HTML document for
 * rules that apply to this img (by id / class / bare `img`).
 *
 * Does not fetch external stylesheets — linked CSS is treated as unknown
 * (not `hasHeightAuto`), so auto-fix will not fire without evidence.
 */
export function inspectImgCss(
  html: string,
  imgAttrs: Record<string, string>,
): ImgCssSignals {
  const inline = imgAttrs.style ?? ''
  const inlineHeightAuto = /height\s*:\s*auto\b/i.test(inline)
  const inlineAspect = /aspect-ratio\s*:/i.test(inline)

  const classes = (imgAttrs.class ?? '').split(/\s+/).filter(Boolean)
  const id = imgAttrs.id?.trim() || null

  let ruleHeightAuto = false
  let ruleAspect = false

  for (const block of extractStyleBlocks(html)) {
    for (const rule of splitRules(block)) {
      if (!selectorMatchesImg(rule.selector, classes, id)) continue
      if (/height\s*:\s*auto\b/i.test(rule.body)) ruleHeightAuto = true
      if (/aspect-ratio\s*:/i.test(rule.body)) ruleAspect = true
    }
  }

  const hasHeightAuto = inlineHeightAuto || ruleHeightAuto
  const hasAspectRatio = inlineAspect || ruleAspect

  return {
    hasHeightAuto,
    hasAspectRatio,
    detail: hasHeightAuto
      ? 'height:auto present (inline or document stylesheet)'
      : 'no height:auto evidence in inline style or <style> blocks',
  }
}

function extractStyleBlocks(html: string): string[] {
  const out: string[] = []
  const re = /<style\b[^>]*>([\s\S]*?)<\/style>/gi
  for (const m of html.matchAll(re)) {
    out.push(m[1] ?? '')
  }
  return out
}

function splitRules(
  css: string,
): Array<{ selector: string; body: string }> {
  const out: Array<{ selector: string; body: string }> = []
  // Strip comments
  const cleaned = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const re = /([^{}]+)\{([^{}]*)\}/g
  for (const m of cleaned.matchAll(re)) {
    out.push({
      selector: (m[1] ?? '').trim(),
      body: (m[2] ?? '').trim(),
    })
  }
  return out
}

function selectorMatchesImg(
  selectorList: string,
  classes: string[],
  id: string | null,
): boolean {
  for (const raw of selectorList.split(',')) {
    const sel = raw.trim()
    if (!sel) continue
    if (/^img\b/i.test(sel) && !/[.#\[]/.test(sel.slice(3))) return true
    if (id && (sel === `#${id}` || sel.endsWith(`#${id}`))) return true
    for (const cls of classes) {
      if (
        sel === `.${cls}` ||
        sel.endsWith(`.${cls}`) ||
        new RegExp(`(^|[\\s>]|img)\\.${cls}(\\s|:|$)`).test(sel)
      ) {
        return true
      }
    }
  }
  return false
}
