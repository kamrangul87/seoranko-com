# Topics 29, 30, 31, 33, 34 — head integrity

Branch: `cursor/head-29-34-922c`
Date: 2026-09-17

Topic 32 (Open Graph / Twitter) intentionally deferred — Twitter Card
portion is NOT RESEARCHED.

## Built

**ONE head inspection** — `inspectDocumentHead` → `HeadInspection`. Uses
parse5 with source locations so `<head>` is the parser's view (H6), never
source position between tags. All five topics classify from that object.

| Topic | Key behaviour |
|---|---|
| 29 | Severity from casualty list: canonical→critical, robots→low (R8). Empty casualties→informational. |
| 30 | Missing/empty/duplicate titles. **No length threshold** (H9). Auto only identical duplicates. |
| 31 | Missing is informational only. Real findings: >1 or empty. No OG first-wins (H30≠H22). |
| 33 | **Exclusion first** (URL variants 8–12, canonical groups). Layout inheritance → one finding. |
| 34 | BCP 47 grammar (`lang=""` valid; `zh-Hant`/`pt-BR` pass). Auto only from authoritative locale. Never `lang="en"`. No Search claim. |

Product decisions: `titleDisplayTruncationHintChars` /
`descriptionDisplayTruncationHintChars` left **null** — a 200-char title
produces nothing.

## Tests assert

- 29: critical / low / informational / conforming / script-ok / post-hydration suppress
- 30: missing+empty scaffold; identical auto; differing review; 200-char nothing; noindex suppress; topic-29 route
- 31: missing informational; identical+empty auto; differing review; case-insensitive duplicate; 600-char nothing
- 33: distinct finding; slash variants→8; canonical group routed; 20 layout pages→one finding; brand-suffix / noindex nothing
- 34: missing review; en-GB/empty/zh-Hant ok; english high; inLanguage disagree low; Book missing high; Article nothing; locale auto-fix

## Constraints checked

1. No length thresholds anywhere
2. Missing meta description ≠ defect
3. HTML description duplicates ≠ OG first-wins
4. Topic 29 severity from casualties (C2 vs R8)
5. Topic 33 exclusion before title changes; layout→one finding
6. BCP 47 grammar; never default `en`; no Search claim
