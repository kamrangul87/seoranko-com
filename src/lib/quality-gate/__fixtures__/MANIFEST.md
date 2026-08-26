# Quality Gate regression fixtures

20 real articles (20 most recently created rows in `articles` as of 2026-08-26) plus 2 hand-written synthetic fixtures, exported for the deterministic Quality Gate regression harness. Each `.json` file matches the shape described in the harness task (id, title, keyword, brand, market, requestedWordCount/actualWordCount, content, schemaJson, createdAt, knownFailingRules).

## Known-failing rule coverage

| Rule | Found naturally? | Fixture | Evidence |
|---|---|---|---|
| M02 (Article schema `image` missing/empty) | Yes | `f9d4f7f8-fece-4a6a-85b0-2d454c2084e7.json` | Article JSON-LD block has no `image` key at all. Confirmed: `runQualityGate` emits a `schema` issue `schema-Article-image`. |
| M07 (Organization has no `logo` at all) | Yes | `f9d4f7f8-fece-4a6a-85b0-2d454c2084e7.json` | `publisher`/`Organization` block is `{"@type":"Organization","name":"autodun","url":"https://seoranko.com"}` — no `logo` key present (not even a bare-string Clearbit fallback). Confirmed with `expectOrganizationLogo: true` (the harness always passes this): `runQualityGate` emits `schema-Organization-publisher.logo` and `schema-Organization-logo`. |
| C04 (time-anchored claim, no citation, no inline verify hedge) | No — not found in the 20 real articles | `synthetic-c04.json` | Every real "As of `<Month> <Year>`, ... `<percentage>`" claim found in the 20 articles already carries an inline "verify/check ... GOV.UK" hedge phrase near it, which the gate's `claimHasInlineVerification` treats as bound. Built a synthetic fixture with the claim and no hedge/citation. Confirmed: emits a `dated-policy` issue. |
| S05 (dense paragraph, no scannability break) | No — not found in the 20 real articles | `synthetic-s05.json` | Corrected from the original export: `f9d4f7f8...` was initially tagged S05 on the claim of "5–6 sentence paragraphs", but this repo's actual scannability rule (`SCANNABILITY_POLICY` in `src/lib/scannability-policy.ts`) requires **6+ sentences per paragraph AND at least 4 such paragraphs** before it fires — stricter than the skill's literal "no paragraph exceeds 4 sentences", and `f9d4f7f8...` does not cross it (verified: zero `scannability`-category issues on that fixture). Built a synthetic fixture with 4 genuinely 7-sentence paragraphs instead. Confirmed: emits a `scannability` issue. |
| S14 (merge-artifact / corruption pattern) | Yes | `ecb1cf37-ff67-4688-8c25-69883c57a3af.json` | "...industry reporting from the Energy **Network.s** Association." (stray mid-word period) and "...rather than the headline-grabbing **22kW. units**." (stray period after unit) — both real corruption artifacts, confirmed by reading full surrounding context (not domain-name false positives). Confirmed: emits a `merge-artifact` issue. |

Note: `f9d4f7f8-fece-4a6a-85b0-2d454c2084e7.json` carries both M02 and M07 naturally.

## All fixtures

| File | Article ID | Title | Word count | knownFailingRules |
|---|---|---|---|---|
| `03048d7b-db9d-4861-b5e7-c156ca0a3389.json` | 03048d7b-db9d-4861-b5e7-c156ca0a3389 | EV Charger Hidden Costs: What UK Homes Must Check First | 1839 | — |
| `06ee6720-b643-4f70-a7d6-531171a45130.json` | 06ee6720-b643-4f70-a7d6-531171a45130 | EV Charger Costs: Why Installation Timing Could Cost You £3,000 | 1595 | — |
| `4473dede-4097-4082-8ca2-6922e0dd16af.json` | 4473dede-4097-4082-8ca2-6922e0dd16af | EV Charger Station Access: Why Your Postcode's Grid Is the Real Problem | 2335 | — |
| `4cbeb257-827d-4b0e-bb96-899adbc7ba54.json` | 4cbeb257-827d-4b0e-bb96-899adbc7ba54 | EV Charger Guide: How UK Off-Peak Tariffs Make Certain Charger Types More Profitable Than Others | 1206 | — |
| `50a33031-ff83-4ac8-abe9-9544499aba6e.json` | 50a33031-ff83-4ac8-abe9-9544499aba6e | The Complete EV Charger Installation Guide: Hidden Costs UK Homeowners Don't Know About | 1829 | — |
| `512d0f25-c90b-483d-9edf-c5fc167204cc.json` | 512d0f25-c90b-483d-9edf-c5fc167204cc | EV Charger Types Comparison: Why Level 2 Beats DC Fast Charging on UK Half-Hourly Pricing | 1346 | — |
| `5757ab14-f105-45eb-ba92-f84078d2bac9.json` | 5757ab14-f105-45eb-ba92-f84078d2bac9 | EV Charger Obsolescence: Why UK Homeowners Face Hidden Compatibility Costs Within 5 Years | 1399 | — |
| `6455c564-cbff-439d-bf0e-63355c37187b.json` | 6455c564-cbff-439d-bf0e-63355c37187b | EV Charger Home Costs: The Truth About Electricity Rates in 2026 | 1790 | — |
| `6c8aab45-52ca-43ec-aee5-f7f5a438ac1e.json` | 6c8aab45-52ca-43ec-aee5-f7f5a438ac1e | EV Charger Hidden Costs: What Smart Tariffs Don't Tell You | 1589 | — |
| `75fbe7a4-3a7a-46fb-b084-4d1195a12ade.json` | 75fbe7a4-3a7a-46fb-b084-4d1195a12ade | EV Charger Home Installation: The Hidden Cost Trap in 2026 | 1556 | — |
| `9562b31f-c153-43ce-869b-47d8cb8ce1df.json` | 9562b31f-c153-43ce-869b-47d8cb8ce1df | EV Charger Costs in 2026: Why Your Postcode Matters More Than You Think | 1575 | — |
| `9733cf84-33d8-4142-a3fd-4089b931b11a.json` | 9733cf84-33d8-4142-a3fd-4089b931b11a | The Complete Guide to Understanding Cryptocurrency (keyword field says "ev charger" — real DB row, off-topic content) | 1028 | — |
| `ae937e80-d35c-471a-8e5e-db4c9d93847a.json` | ae937e80-d35c-471a-8e5e-db4c9d93847a | EV Charger Installation: The Hidden Costs in 2026 | 1747 | — |
| `ba103270-73da-4174-82ff-fe28ac360f05.json` | ba103270-73da-4174-82ff-fe28ac360f05 | EV Charger Guide: How Smart Charging Algorithms Are Secretly Affecting Your Real Costs in the UK | 1331 | — |
| `d5bb4030-722c-45e8-9314-84c9fd984488.json` | d5bb4030-722c-45e8-9314-84c9fd984488 | EV Charger Types Comparison: Why Level 2 Installation Costs Triple in UK Homes | 1314 | — |
| `da83d673-fd5d-4114-b2ec-56ad9a357f57.json` | da83d673-fd5d-4114-b2ec-56ad9a357f57 | EV Charger Connector Standards Explained: Type 2, CCS, and CHAdeMO in the UK Market | 2068 | — |
| `ecb1cf37-ff67-4688-8c25-69883c57a3af.json` | ecb1cf37-ff67-4688-8c25-69883c57a3af | EV Charger Installation in 2026: The Grid Capacity Truth | 1503 | S14 |
| `f0f8d2cc-ad2e-422f-b1ed-02b3bf989fdb.json` | f0f8d2cc-ad2e-422f-b1ed-02b3bf989fdb | EV Charger Buying Guide 2026: The Obsolescence Risk Nobody Mentions | 1763 | — |
| `f9d4f7f8-fece-4a6a-85b0-2d454c2084e7.json` | f9d4f7f8-fece-4a6a-85b0-2d454c2084e7 | EV Charger Hidden Costs: What Nobody Tells You in 2026 | 1603 | M02, M07 |
| `ff441ba4-be5a-4c79-8bab-8ddfe7769bf2.json` | ff441ba4-be5a-4c79-8bab-8ddfe7769bf2 | EV Charger Speed vs Cost: What Installers Don't Tell You | 1602 | — |
| `synthetic-c04.json` | synthetic-c04-0000-0000-0000-000000000001 (hand-written) | EV Charger Grants: What UK Homeowners Should Know | 420 | C04 |
| `synthetic-s05.json` | synthetic-s05-0000-0000-0000-000000000001 (hand-written) | EV Charger Installation Guide for UK Homeowners | 308 | S05 |

## Notes on data quality observed while exporting

- Only the 2 most recently created articles (`ba103270...` and `da83d673...`) have a non-null `articles.schema_json` DB column value; the other 18 real rows have `schema_json = NULL` in the DB even though their `content` HTML does embed working `<script type="application/ld+json">` blocks. Per the task spec, each fixture's `schemaJson` field stores the DB column's value exactly as stored (so it is `null` for those 18) — the actual schema used for M02/M07 verification was extracted from the embedded JSON-LD in `content`, which is also what the real Quality Gate (`validateSchema`) parses at runtime.
- `articles.time_anchored_claims` is an empty array (`[]`) for all 20 rows — none of the real articles have a populated claim-evidence record on that column, consistent with C04 not being found via that path either.
