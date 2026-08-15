// Usage: npx tsx scripts/test-serp-gap-cluster.ts
import { mergeClusterKeywords } from '../src/lib/serp-gap-analyzer'

const merged = mergeClusterKeywords(
  'ev charger',
  ['charger for ev'],
  ['ev charger', 'ev charger near me', 'installing ev charger', 'charger for ev']
)

if (!merged.includes('ev charger near me')) {
  console.error('FAIL: selected keyword dropped:', merged)
  process.exit(1)
}
if (!merged.includes('installing ev charger')) {
  console.error('FAIL: selected keyword dropped:', merged)
  process.exit(1)
}
if (merged.includes('ev charger')) {
  console.error('FAIL: primary should not be in secondary:', merged)
  process.exit(1)
}
console.log('PASS: mergeClusterKeywords preserves all selected secondary terms')
console.log('Merged:', merged.join(', '))
