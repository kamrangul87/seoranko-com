/**
 * Offline verification of the four Quality & Editing upgrade claims.
 * Run: npx tsx scripts/verify-quality-editing-upgrade.ts
 */
import fs from 'fs'
import {
  scrubInsertionCorruption,
  hasInsertionCorruption,
  applyGuardedRegexReplace,
  isSafeTextPatch,
} from '../src/lib/sentence-integrity'
import { applyDeterministicMergeFixes, detectMergeArtifacts } from '../src/lib/merge-artifact-repair'
import { countArticleWords } from '../src/lib/word-count'

const results: Array<{ name: string; ok: boolean; detail: string }> = []

function check(name: string, ok: boolean, detail: string) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}: ${detail}`)
}

const sampleA = `<p>That is something newer electric vehicles require.ehicles need a dedicated circuit for safe charging.</p>`
const sampleB = `<p>Drivers may receive grants of up to £350 (verify at GOV.UK).350. The EVHS scheme covers eligible wallboxes.</p>`

check(
  'detect require.ehicles corruption',
  hasInsertionCorruption(sampleA) && detectMergeArtifacts(sampleA).some(a => /require\.ehicles/.test(a.matchedText)),
  'merge detector flags truncated-word splice',
)

const scrubbedB = scrubInsertionCorruption(sampleB)
check(
  'scrub .350. after verify paren',
  scrubbedB.fixes > 0 && !scrubbedB.html.includes(').350.') && scrubbedB.html.includes('(verify at GOV.UK).'),
  scrubbedB.html.slice(0, 120),
)

const hedge = applyGuardedRegexReplace(
  `<p>You can get grants of up to £350 toward installation.</p>`,
  /\bup to (£\d+)\b(?!\s*\(verify at GOV\.UK\))/gi,
  (m) => `${m} (verify at GOV.UK)`,
  'grant',
)
check(
  'guarded grant hedge stays clean',
  hedge.appliedCount === 1 && !hasInsertionCorruption(hedge.html),
  hedge.html,
)

const badPatch = isSafeTextPatch(
  'Costs averaging around £3,200, with some reaching £5,000 or more.',
  'Costs averaging around £3,200, with some reaching higher amounts. £5,000 or more.',
)
check('reject sentence-splitting hedge patch', !badPatch, 'integrity guard blocks dangling fragment')

const det = applyDeterministicMergeFixes(sampleB)
check(
  'deterministic merge scrub on sample B',
  !det.content.includes(').350.'),
  `fixesMade=${det.fixesMade}`,
)

const writer = fs.readFileSync('src/components/ArticleWriter.tsx', 'utf8')
check('ArticleWriter has Edit mode', writer.includes('startEditing') && writer.includes('draftHtml'), 'Edit / Save / Save & re-check')
check('ArticleWriter wires Fix All', writer.includes('runFixAll') && writer.includes('onFixAll'), 'QualityGatePanel onFixAll')
check('Fix All API route present', fs.existsSync('src/app/api/article-fix-all/route.ts'), 'article-fix-all')
check('Quality recheck API present', fs.existsSync('src/app/api/article-quality-recheck/route.ts'), 'article-quality-recheck')

const route = fs.readFileSync('src/app/api/export-article/route.ts', 'utf8')
check(
  'export-article embeds arrayBuffer into zip',
  route.includes('arrayBuffer()') && route.includes('imagesFolder?.file') && route.includes('images/${filename}'),
  'downloads real bytes and rewrites src to images/',
)
check(
  'word count helper still works on scrubbed HTML',
  countArticleWords(scrubInsertionCorruption(`<p>Hello world about EV chargers.</p><script>x y z</script>`).html) === 5,
  'scripts stripped',
)

const failed = results.filter(r => !r.ok)
console.log('\n── Summary ──')
console.log(`${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) {
  console.error('FAILED:', failed.map(f => f.name).join(', '))
  process.exit(1)
}
