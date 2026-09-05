# Fix Agent + Site Connector

## Permission model
- **Audit** any public URL → report only
- **Fix Agent** only when the audited host matches a `connected_sites` row **and** an active `site_connections` credential (WordPress / Shopify / GitHub / Webflow / Universal Tag)

## Connect flow
Settings → Your Sites → **Connect site** / **Change connection**.
`ConnectSiteModal` always shows a platform picker: **GitHub**, WordPress, Shopify,
Webflow, and Universal Tag (script fallback). Existing connections can be switched
(e.g. Universal Tag → GitHub) — credentials are re-verified via the platform adapter
before upserting `site_connections`.

Stored as AES-256-GCM (`credentials_ciphertext` / `enc:v1:…`). Set
`SITE_CONNECTION_ENCRYPTION_KEY` (or rely on service-role key derivation).

**GitHub tip:** use the repository that builds the live domain (not this SEORANKO
app repo). For example, a Vercel-hosted marketing site usually has its own repo
with `index.html` / `public/**/*.html` sources the Fix Agent can edit.

## Classification
| Auto-fixable | Human / brief |
|---|---|
| Meta title/description, H1, JSON-LD, lang, alt (filename + review flag), HTML structure | Thin content, internal linking, factual claims (price/stock/policy) |
| Security headers + llms.txt — **only** on WordPress / Shopify / Webflow / GitHub | Same items on **Universal Tag** → `requires-server` (tag cannot set HTTP headers or write static files) |

Connection type is passed into `classifyAuditIssues({ connectionType })`. The audit UI and Fix Agent confirm dialog list only what that connector can actually apply.

## Runtime
`POST /api/copilot/fix-agent` with `{ url, siteId, issues, confirm: true }`  
→ classify → apply (≤3 strategies) → re-fetch / re-score → log `fix_agent_attempts` (before/after) → revert via `POST /api/copilot/fix-agent/revert`

## Billing
Audit-only free vs Fix Agent premium is **flagged only** in `docs/BILLING_PIVOT_NOTES.md` — not enforced in this pass.

## Link Graph fixes

Link Graph findings with a computed `suggestedTarget` (L04/L05 redirect-hop, L06 non-canonical, plus L17–L19 URL-normalization rules) map to Fix Agent kind `rewrite-link-href`.

- **Auto-fix (GitHub / server CMS):** locate source-page `<a href>` and rewrite to the suggested destination; re-fetch the source page to verify.
- **Bulk:** “Fix all redirect-hop links” applies every L04/L05 rewrite in one Fix Agent run with a before/after summary (still revertible).
- **Manual fix:** paste source HTML — only the flagged href(s) are rewritten (`link_href` paste kind).
- **L01 4xx:** uses existing `remove-dead-link` (strip the dead anchor; never invent a destination page).
