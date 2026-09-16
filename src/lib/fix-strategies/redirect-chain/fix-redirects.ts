/**
 * Redirect-chain fixers. Never import the verifier.
 * Never auto-repoint to the homepage (topic 7 rejected).
 */

/**
 * Collapse a multi-hop redirect in next.config / vercel.json style source
 * so origin points directly at finalTarget (301/308).
 */
export function collapseRedirectInConfig(
  configSource: string,
  originPath: string,
  finalTarget: string,
  permanent = true,
): { source: string; updated: boolean } {
  const status = permanent ? 301 : 302
  // Replace an existing source→destination entry for originPath
  const escaped = originPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(
    `(\\{\\s*source\\s*:\\s*['"]${escaped}['"]\\s*,\\s*destination\\s*:\\s*['"])([^'"]+)(['"])`,
    'i',
  )
  if (re.test(configSource)) {
    let next = configSource.replace(re, `$1${finalTarget}$3`)
    // Ensure permanent flag when present
    if (/permanent\s*:/.test(next)) {
      next = next.replace(
        new RegExp(
          `(source\\s*:\\s*['"]${escaped}['"][\\s\\S]*?permanent\\s*:\\s*)(true|false)`,
          'i',
        ),
        `$1${permanent}`,
      )
    }
    return { source: next, updated: true }
  }

  const entry = `  { source: '${originPath}', destination: '${finalTarget}', permanent: ${permanent} }, // status ${status}\n`
  if (/redirects\s*\(\s*\)\s*\{/.test(configSource) || /redirects\s*:\s*\[/.test(configSource)) {
    if (/redirects\s*:\s*\[/.test(configSource)) {
      return {
        source: configSource.replace(/redirects\s*:\s*\[/, `redirects: [\n${entry}`),
        updated: true,
      }
    }
  }
  return {
    source: `${configSource.trim()}\n// collapsed redirect: ${originPath} → ${finalTarget}\n`,
    updated: true,
  }
}

/**
 * Change 302/307 → 301/308 in config (topic 6). Human-review only to apply.
 */
export function proposePermanentStatusInConfig(
  configSource: string,
  originPath: string,
): { source: string; updated: boolean } {
  const escaped = originPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(
    `(source\\s*:\\s*['"]${escaped}['"][\\s\\S]*?permanent\\s*:\\s*)false`,
    'i',
  )
  if (re.test(configSource)) {
    return {
      source: configSource.replace(re, '$1true'),
      updated: true,
    }
  }
  return { source: configSource, updated: false }
}

/**
 * Remove a redirect rule for originPath (topic 7 removal branch).
 */
export function removeRedirectFromConfig(
  configSource: string,
  originPath: string,
): { source: string; removed: number } {
  const escaped = originPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  let removed = 0
  const next = configSource.replace(
    new RegExp(
      `\\{[^}]*source\\s*:\\s*['"]${escaped}['"][^}]*\\},?\\s*`,
      'gi',
    ),
    () => {
      removed++
      return ''
    },
  )
  return { source: next, removed }
}
