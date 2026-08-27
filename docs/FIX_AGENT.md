# Fix Agent + Site Connector

## Permission model
- **Audit** any public URL → report only
- **Fix Agent** only when the audited host matches a `connected_sites` row **and** an active `site_connections` credential (WordPress / Shopify / GitHub / Webflow / Universal Tag)

## Connect flow
Settings → Your Sites → Connect (existing `ConnectSiteModal`). Credentials are verified via the platform adapter, then stored as AES-256-GCM (`credentials_ciphertext` / `enc:v1:…`). Set `SITE_CONNECTION_ENCRYPTION_KEY` (or rely on service-role key derivation).

## Classification
| Auto-fixable | Human / brief |
|---|---|
| Meta title/description, H1, JSON-LD, lang, alt (filename + review flag), llms.txt, HTML structure, security headers (hand-off if host config unsupported) | Thin content, internal linking, factual claims (price/stock/policy) |

## Runtime
`POST /api/copilot/fix-agent` with `{ url, siteId, issues, confirm: true }`  
→ classify → apply (≤3 strategies) → re-fetch / re-score → log `fix_agent_attempts` (before/after) → revert via `POST /api/copilot/fix-agent/revert`

## Billing
Audit-only free vs Fix Agent premium is **flagged only** in `docs/BILLING_PIVOT_NOTES.md` — not enforced in this pass.
