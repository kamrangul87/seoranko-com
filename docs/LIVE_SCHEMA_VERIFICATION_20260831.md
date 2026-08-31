# Live schema verification (2026-08-31)

Hosted project: `ddfboapzwclecbdjoqex` (https://ddfboapzwclecbdjoqex.supabase.co).

Supabase MCP and CLI DB access were unavailable in this agent environment
(no `SUPABASE_ACCESS_TOKEN` / DB password; MCP `needsAuth`). Verification used
the public anon key from the deployed Next.js login bundle + PostgREST.

## 1. `20260831120000_ai_visibility_citation_check.sql`

Live tables exist; every column in the migration file responds to
`GET /rest/v1/<table>?select=<col>` (HTTP 200). Confirmed columns:

| Table | Columns matched |
|-------|-----------------|
| `ai_visibility_prompts` | id, user_id, site_id, prompt, source, is_active, created_at |
| `ai_visibility_runs` | id, user_id, site_id, started_at, finished_at, status, prompt_count, citation_rate, mention_rate, cost_usd, cost_breakdown, error_message, trigger |
| `ai_visibility_results` | id, run_id, prompt_id, prompt_text, engine, mentioned, cited, cited_urls, competitor_domains, response_snippet, diagnostic, cost_usd, checked_at |

Unauthenticated insert → `42501` (RLS policies from the same migration are live).

**Verdict:** migration file matches live. No edits required.

## 2. `20260831130000_enable_rls_eleven_tables.sql`

Live RLS already enforced (unauthenticated INSERT → `42501`) on all 11 tables:

| Table | Live notes | Migration behaviour |
|-------|------------|---------------------|
| `site_audit_results` | has `user_id` | owner FOR ALL (`auth.uid() = user_id`) |
| `seo_sites` | has `user_id`; PK is `site_id` (no `id`) | owner FOR ALL |
| `image_generation_logs` | no `user_id` | ENABLE RLS only (no client policies) |
| `audit_history` | no `user_id` | authenticated SELECT only |
| `ai_citation_tests` | no `user_id` | authenticated SELECT only |
| `score_history` | no `user_id` | authenticated SELECT only |
| `scheduled_citation_tests` | cols: id, domain, topic, run_at, completed, source, created_at | authenticated SELECT only |
| `entity_cache` | cols: id, brand_key, wikipedia, reddit, linkedin, checked_at | authenticated SELECT only |
| `serp_intent_cache` | cols: id, keyword, location_code, intent, serp_features | authenticated SELECT only |
| `ranko_winnability_cache` | matches app upsert shape | authenticated SELECT only |
| `treatments` | id, name, mechanism, reversible | authenticated SELECT only |

Exact live policy **names** could not be listed without `service_role` / `pg_policies`.
The migration encodes the applied *behaviour* with idempotent `DROP POLICY IF EXISTS`
+ `CREATE POLICY` using this repo’s naming style.

### Re-linking migration history on hosted

If the SQL was applied in the dashboard and is not in `supabase_migrations.schema_migrations`, mark it applied without re-running:

```bash
supabase link --project-ref ddfboapzwclecbdjoqex
supabase migration repair --status applied 20260831130000
```
