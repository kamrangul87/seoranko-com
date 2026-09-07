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
    const files = [
      'oauth.ts',
      'client.ts',
      'sync.ts',
      'baseline-readiness.ts',
      'known-urls.ts',
      'property-domain.ts',
      'register-properties.ts',
    ]
    for (const f of files) {
      const src = readFileSync(join(__dirname, f), 'utf8')
      expect(src).not.toMatch(/autodun/i)
      expect(src).not.toMatch(/United Kingdom/)
      expect(src).not.toMatch(/locationCode\s*=\s*2826/)
    }
  })

  it('ships gsc_accounts migration and account-mode OAuth onboarding', () => {
    const sql = readFileSync(
      join(root, 'supabase/migrations/20260907140000_gsc_accounts_onboarding.sql'),
      'utf8',
    )
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS gsc_accounts/)
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/)
    expect(sql).toMatch(/refresh_token_encrypted/)

    const oauth = readFileSync(join(__dirname, 'oauth.ts'), 'utf8')
    expect(oauth).toMatch(/mode: GscOAuthMode/)
    expect(oauth).toMatch(/'account'/)

    const experiments = readFileSync(
      join(root, 'src/app/dashboard/experiments/page.tsx'),
      'utf8',
    )
    expect(experiments).toMatch(/pick_properties/)
    expect(experiments).toMatch(/\/api\/gsc\/register/)
    expect(experiments).toMatch(/Choose properties to track/)
  })

  it('scopes url_metrics_daily upserts to crawl/sitemap known URLs', () => {
    const sync = readFileSync(join(__dirname, 'sync.ts'), 'utf8')
    expect(sync).toMatch(/filterRowsToKnownUrls/)
    expect(sync).toMatch(/loadKnownUrlsForSite/)
    expect(sync).toMatch(/no_crawl_url_set/)
    expect(sync).toMatch(/buildDedupedUrlMetricsUpserts/)
  })

  it('requires SITE_CONNECTION_ENCRYPTION_KEY with no service-role crypto fallback', () => {
    const crypto = readFileSync(join(root, 'src/lib/site-connection-crypto.ts'), 'utf8')
    expect(crypto).toMatch(/SITE_CONNECTION_ENCRYPTION_KEY is required/)
    expect(crypto).toMatch(/Never falls back to SUPABASE_SERVICE_ROLE_KEY/)
    // getKey must not OR in the service-role key
    expect(crypto).not.toMatch(
      /SITE_CONNECTION_ENCRYPTION_KEY\s*\|\|\s*process\.env\.SUPABASE_SERVICE_ROLE_KEY/,
    )
  })

  it('Experiments nav entry exists', () => {
    const nav = readFileSync(join(root, 'src/components/DashboardNav.tsx'), 'utf8')
    expect(nav).toMatch(/\/dashboard\/experiments/)
    expect(nav).toMatch(/Experiments/)
  })
})
