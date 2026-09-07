import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const root = join(__dirname, '../../..')

describe('Causal Experiment Engine PR1 wiring', () => {
  it('registers a once-daily gsc-sync cron (not sub-daily)', () => {
    const vercel = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'))
    const cron = (vercel.crons || []).find((c: { path: string }) => c.path === '/api/cron/gsc-sync')
    expect(cron).toBeTruthy()
    expect(cron.schedule).toMatch(/^\d+ \d+ \* \* \*$/)
  })

  it('migration enables RLS on all new tables', () => {
    const sql = readFileSync(
      join(root, 'supabase/migrations/20260907120000_causal_experiment_engine_pr1.sql'),
      'utf8',
    )
    for (const table of [
      'gsc_connections',
      'url_metrics_daily',
      'experiments',
      'experiment_urls',
      'baseline_readiness_checks',
    ]) {
      expect(sql).toMatch(new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`))
    }
    expect(sql).toMatch(/refresh_token_encrypted/)
    expect(sql).toMatch(/UNIQUE \(site_id, url, date\)/)
    expect(sql).toMatch(/is_final/)
  })

  it('does not hardcode autodun or UK market defaults in new GSC code', () => {
    const files = ['oauth.ts', 'client.ts', 'sync.ts', 'baseline-readiness.ts']
    for (const f of files) {
      const src = readFileSync(join(__dirname, f), 'utf8')
      expect(src).not.toMatch(/autodun/i)
      expect(src).not.toMatch(/United Kingdom/)
      expect(src).not.toMatch(/locationCode\s*=\s*2826/)
    }
  })

  it('Experiments nav entry exists', () => {
    const nav = readFileSync(join(root, 'src/components/DashboardNav.tsx'), 'utf8')
    expect(nav).toMatch(/\/dashboard\/experiments/)
    expect(nav).toMatch(/Experiments/)
  })
})
