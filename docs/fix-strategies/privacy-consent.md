# privacy-consent

Status: READY — human-review only (never auto-merge)
Topic: 72 of the issue register
Tier: A
Research title: privacy-consent (topic 72).
Research date: 2026-10-12

---

## what's actually wrong

Third-party vendors (analytics, ads, forms, embeds, hosting) load on the site
while the privacy notice is missing, incomplete, or silent about those
recipients — and/or consent-requiring vendors appear in initial HTML with no
consent signal.

## primary source

- ICO, What privacy information should we provide? —
  https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/the-right-to-be-informed/what-privacy-information-should-we-provide/
- Vendor install docs cited per signature in
  `src/lib/compliance/vendor-signatures.ts` (GA4/gtag, GTM, Meta Pixel, Hotjar,
  Clarity, Formspree, Stripe, Maps, YouTube, reCAPTCHA, Vercel, Netlify,
  Cloudflare).

## threshold

| Signal | Rule |
|---|---|
| Privacy page | Footer link text/href matching privacy\|data-protection, else path heuristic |
| Vendor named | Display name or `nameAliases` substring on privacy HTML |
| Consent | Known CMP signature **or** analytics load gated (not bare in initial HTML) |
| Sections | controller identity, contact, lawful basis, recipients, international transfers, retention, rights (incl. withdraw consent + supervisory complaint) |
| Jurisdiction | Required site setting — **never** defaulted to UK or any market |

Static HTML only. When undeterminable: `pre_consent_load: unknown` — never assume compliant.

## detect

1. Extract script src / form action / iframe src / Set-Cookie (+ HTML cookie
   patterns) per crawled page; match `VENDOR_SIGNATURES`.
2. Roll up consent signal across pages (`consent-signal.ts`).
3. Find privacy page; emit findings:
   - (a) no privacy page
   - (b) detected vendor not named
   - (c) requires_consent vendor + no consent signal
   - (d) one finding per missing required section
   - (e) policy names vendor not detected (informational)
   - jurisdiction unset → `human-review-jurisdiction-not-set`

## false-positive guards

| # | Guard | Action |
|---|---|---|
| 1 | First-party analytics (self-hosted, same-origin script) | not matched — signatures are third-party hosts only |
| 2 | Server-side tagging / GTM server container (no client script) | not detected → may emit informational (e) if named in policy; never invent a client hit |
| 3 | Vendor named by brand alias (e.g. “Google Analytics”, “GA4”, “gtag”) | counts as named via `nameAliases` |
| 4 | Hosting cookies (`__cf*`, `__vercel`) without marketing scripts | hosting category; `requiresConsent=false` — no consent-missing from hosting alone |
| 5 | CMP present but vendor also bare in HTML | CMP signature satisfies consent signal (c); `pre_consent_load` may still be `yes`; vendor-unnamed (b) is independent |
| 6 | No market default | jurisdiction unset → finding, not ICO/UK fallback |

### Explicitly rejected

- **LLM-written privacy pages or clause rewriting.**
- **Assuming compliant when `pre_consent_load` is unknown.**
- **UK supervisory authority when jurisdiction unset.**
- **Auto-merge of privacy page PRs** — surface_class human-review only.

## fix

**Human-review only.** Deterministic assembler
(`src/lib/compliance/assembler.ts`) builds HTML/MDX from the versioned clause
library + owner form fields. Refuses if any required field is empty.
Dashboard UI shows “template — not legal advice”; published page must not.

Never auto-merge regardless of `auto_merge_enabled`.

## postcondition

On recrawl: every detected vendor is named on the live privacy page **and**
findings (a)–(d) are closed (`privacyConsentPostconditionMet`).

## idempotent?

Detect: yes. Assemble: yes (fixed clauses + same inputs).

## risk / blast radius

Publishing an incomplete notice is a legal/compliance risk — hence refuse on
missing fields and human-review surface class.

## rollback

Revert privacy page commit / remove assembled file.

## verdict

All actionable verdicts: `human-review-*` → surface_class `human-review`.
Informational: `informational-vendor-named-not-detected`.
