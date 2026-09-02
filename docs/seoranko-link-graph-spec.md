# SEORANKO — Link Graph Audit Section

**Implementation spec for Cursor.**
Status: build **after** Index Diagnosis is merged. Do not start in parallel.

---

## 0. Core principle (inherited)

A rule that cannot be evaluated by code is not a rule. Every check below is a
deterministic function over stored crawl data, returns `CRITICAL` / `FAIL` /
`WARN`, and stores its raw evidence. No model is in the detection path at any
point.

The model is used in exactly one place: phrasing the plain-English verdict from
already-computed findings. It never decides whether something is a finding.

---

## 1. Scope

**In scope (v1):**
- Extract every anchor from every crawled page
- Resolve every link target's true state (status, redirect chain, canonical, robots)
- Cross-check the sitemap against the crawled link graph
- Run rules `L01`–`L24`
- Emit a verdict-first report and a downloadable fix list

**Explicitly out of scope (v1):**
- Applying any fix to the user's live site (that is tier 3 / connector work)
- External backlink data, or anything requiring a paid API
- Rendering JavaScript to discover client-side-injected links (see §3.4)
- Anchor-text "optimisation" suggestions beyond replacing generic anchors

**No new paid APIs. No SERP calls. Crawl-only.**

---

## 2. Reuse, do not rebuild

Index Diagnosis already crawls the site and stores per-URL: status, robots.txt
rule, meta/X-Robots-Tag, canonical target, depth, inlink count, dup-cluster ID.

This section is a **second reader over that crawl**, plus one new extraction
step (anchors) and one new resolution step (link targets). Do not stand up a
second crawler. If Index Diagnosis's crawler does not currently persist anchors,
extend it — do not fork it.

---

## 3. Data model

All three tables ship with **RLS enabled and a policy scoped to the owning
user via `audit_id → audits.user_id`**. This is non-negotiable for any new
table.

### 3.1 `link_edges`

One row per anchor found in the HTML.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `audit_id` | uuid fk | |
| `source_url` | text | page the anchor was found on, normalized |
| `href_raw` | text | exactly as written in the HTML |
| `href_resolved` | text | absolute, normalized (§3.3) |
| `anchor_text` | text | trimmed, whitespace-collapsed |
| `anchor_image_alt` | text null | when the anchor wraps an `<img>` with no text |
| `rel` | text null | raw rel attribute |
| `is_nofollow` | bool | derived from `rel` |
| `is_internal` | bool | same registrable domain |
| `dom_region` | enum | `nav` \| `main` \| `footer` \| `sidebar` \| `unknown` |
| `dom_index` | int | order of appearance in document |

`dom_region` is derived by walking ancestors for `<nav>`, `<header>`, `<footer>`,
`<aside>`, `<main>`, `[role=navigation]`, and common class-name patterns. Where
none match, `unknown`. Boilerplate links (nav/footer) are excluded from several
rules below, so getting this roughly right matters more than getting it perfect.

### 3.2 `link_targets`

One row per distinct normalized internal target.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `audit_id` | uuid fk | |
| `url_normalized` | text | |
| `final_status` | int | after following redirects |
| `redirect_hops` | int | 0 if direct |
| `redirect_chain` | jsonb | `[{url, status}]`, capped at 10 |
| `final_url` | text | end of chain |
| `canonical_target` | text null | from the crawl |
| `is_indexable` | bool | from the crawl (robots + meta) |
| `in_sitemap` | bool | |
| `inlink_count` | int | count of `link_edges` where `is_internal` |
| `depth` | int null | from home, from the crawl |

### 3.3 URL normalization (get this right or every rule is noisy)

Applied identically to sitemap URLs, crawled URLs, and hrefs:

1. Resolve relative → absolute against the source page's base URL
2. Lowercase scheme and host; strip default port (`:80`, `:443`)
3. Strip fragment (`#...`) entirely
4. Strip tracking params: `utm_*`, `gclid`, `fbclid`, `mc_cid`, `mc_eid`, `ref`,
   `_ga`. Keep all other query params — they may be real routes.
5. Sort remaining query params alphabetically
6. Percent-decode unreserved characters only
7. **Trailing slash:** detect the site's convention once per audit, by taking
   the majority form among self-referencing canonicals. Normalize to that.
   Store the detected convention on the audit row and show it in the report,
   because it drives `L13`.

Normalization is a single shared function. Do not reimplement it per call site
— divergent normalizers are how a link graph produces phantom findings.

### 3.4 JavaScript-rendered links

v1 parses served HTML only. If a page's served HTML contains fewer than 3
internal anchors but the page returns 200 with substantial body content, flag
the audit-level warning `L00_JS_SUSPECTED` and state plainly in the report that
link coverage on that site may be incomplete. Do not silently report "0 internal
links" as a finding on an SPA — that is a false accusation and it will be the
first thing a churned user cites.

### 3.5 `link_findings`

| Column | Type |
|---|---|
| `id` | uuid pk |
| `audit_id` | uuid fk |
| `rule_id` | text (`L01`…) |
| `severity` | enum `CRITICAL` \| `FAIL` \| `WARN` |
| `source_url` | text null |
| `target_url` | text null |
| `evidence` | jsonb |
| `suggested_target` | text null |
| `created_at` | timestamptz |

`evidence` must contain enough to reconstruct the verdict without re-crawling:
the raw href, the anchor text, the redirect chain, the status codes, the
canonical seen. Same standard as Index Diagnosis verdicts.

---

## 4. Pipeline stages

```
S1  load crawl output (URLs + HTML) from Index Diagnosis
S2  extract anchors            → link_edges
S3  build distinct target set  → link_targets (unresolved)
S4  resolve targets            → status, redirect chain, final URL
S5  join crawl data onto targets (canonical, indexable, depth, in_sitemap)
S6  compute inlink counts
S7  run rules L01–L24          → link_findings
S8  score + rank findings by impact
S9  render verdict-first report + fix list
```

**S4 constraints:**
- `HEAD` first, fall back to `GET` on 405/501
- Follow at most 10 hops, record every hop
- Concurrency capped, per-host rate limit shared with the main crawler
- Cache by normalized URL within an audit — never resolve the same target twice
- Timeout 10s; on timeout record `final_status = null` and rule `L25`
- Respect the same robots.txt / user-agent posture as the main crawl

---

## 5. Rules

`CRITICAL` = leads the report. `FAIL` = counts against the section score.
`WARN` = surfaced, does not score. **Never auto-anything on a `WARN`.**

### 5.1 Broken and redirected links

| ID | Rule | Threshold | Level |
|---|---|---|---|
| `L01` | Internal link resolves to 4xx | `final_status in 400..499` | CRITICAL |
| `L02` | Internal link resolves to 5xx | `final_status in 500..599` | CRITICAL |
| `L03` | Internal link redirect loop | loop detected in chain | CRITICAL |
| `L04` | Internal link chain > 1 hop | `redirect_hops > 1` | CRITICAL |
| `L05` | Internal link is a single redirect | `redirect_hops == 1` | FAIL |
| `L25` | Internal target did not respond | `final_status is null` | WARN |

`L05` suggestion = `final_url`. `L04` suggestion = `final_url`.

### 5.2 Canonical and indexability conflicts

| ID | Rule | Threshold | Level |
|---|---|---|---|
| `L06` | Link points to a URL whose canonical is a different URL | `canonical_target != url_normalized` | FAIL |
| `L07` | Internal link to a `noindex` page from `main` region | `is_indexable == false` and `dom_region == main` | FAIL |
| `L08` | Internal link to a `noindex` page from boilerplate | same, region nav/footer | WARN |
| `L09` | Internal link to a robots.txt-disallowed URL | boolean | FAIL |
| `L10` | Internal link carries `rel=nofollow` | boolean | WARN |

`L06` suggestion = the canonical target. This is the highest-volume real finding
on most sites and it is invisible to users, so it is worth surfacing loudly.

`L10` is a WARN, not a FAIL — internal nofollow is usually a mistake but is
occasionally deliberate (login, cart, faceted nav). Say that in the finding copy.

### 5.3 Anchor text quality

| ID | Rule | Threshold | Level |
|---|---|---|---|
| `L11` | Empty anchor: no text and no image alt | boolean | FAIL |
| `L12` | Generic anchor text | matches generic list | WARN |
| `L13` | Anchor text is a bare URL | regex | WARN |
| `L14` | Same anchor text → ≥2 different internal targets | distinct targets ≥ 2 | WARN |
| `L15` | Target has no dominant anchor | most common anchor < 30% of its inlinks, and inlinks ≥ 5 | WARN |
| `L16` | Exact-match anchor over-repetition | same anchor → same target > 20 times outside boilerplate | WARN |

Generic anchor list (case-insensitive, trimmed): `click here`, `here`, `read
more`, `more`, `learn more`, `this page`, `link`, `this`, `continue`,
`find out more`, `see more`, `details`, `download`, plus the same list localized
for the site's detected `lang`. Store the list in a config file, not inline.

**Exclude `dom_region in (nav, footer)` from L14, L15, L16.** Navigation
legitimately reuses anchors sitewide; flagging it produces hundreds of junk
findings and destroys trust in the section.

### 5.4 URL hygiene

| ID | Rule | Threshold | Level |
|---|---|---|---|
| `L17` | `http://` link on an `https://` site | boolean | FAIL |
| `L18` | Trailing-slash form differs from detected site convention | boolean | WARN |
| `L19` | Host case or `www`/non-`www` differs from canonical host | boolean | FAIL |
| `L20` | Placeholder href used as a real link | `#`, `javascript:void(0)`, empty | WARN |

### 5.5 Structure

| ID | Rule | Threshold | Level |
|---|---|---|---|
| `L21` | Orphan page: in sitemap or crawled, zero internal inlinks | `inlink_count == 0` and not home | CRITICAL |
| `L22` | Page reachable only below depth 5 | `depth > 5` | FAIL |
| `L23` | Indexable page with zero in-content internal links | count where `dom_region == main` is 0 | WARN |
| `L24` | Excessive internal links on one page | `> 150` internal edges | WARN |

### 5.6 Sitemap cross-check

| ID | Rule | Threshold | Level |
|---|---|---|---|
| `L26` | Sitemap URL returns non-200 | boolean | CRITICAL |
| `L27` | Sitemap URL redirects | `redirect_hops > 0` | FAIL |
| `L28` | Sitemap URL is `noindex` or robots-disallowed | boolean | CRITICAL |
| `L29` | Sitemap URL is not self-canonical | boolean | FAIL |
| `L30` | Crawled indexable page missing from sitemap | boolean | WARN |

`L26`–`L29` are contradictions the site is sending Google directly — a sitemap
is a statement that a URL should be indexed. These rank above most anchor-text
findings in the report.

### 5.7 External links

| ID | Rule | Threshold | Level |
|---|---|---|---|
| `L31` | External link 4xx/5xx | boolean | WARN |
| `L32` | External link redirect chain > 2 hops | boolean | WARN |

External checks are WARN only in v1 and are rate-limited hard. Do not let a
third-party host's rate limiting stall an audit — cap total external checks per
audit at 500, sampled by frequency, and say in the UI that it is a sample.

---

## 6. Scoring and output

### 6.1 Impact ranking

Findings are ranked for the report by:

```
impact = severity_weight × affected_url_count × inlink_weight
```

where `severity_weight` is CRITICAL 10 / FAIL 4 / WARN 1, and `inlink_weight`
scales by how many pages link to the affected target (a broken link in the
footer hits every page; one in a 2019 blog post does not).

### 6.2 Report structure (verdict-first, same as Index Diagnosis)

1. **One-line verdict.** e.g. "412 internal links point at URLs that redirect,
   and 9 pages have no internal links at all."
2. **Top 3 highest-impact causes**, each with: what it is, how many URLs, why it
   matters, what to change.
3. **Then** the detailed tables, one per rule group, collapsible.
4. Evidence viewable per row.

The model writes only step 1 and the prose in step 2, from the computed
findings. It receives the finding counts and evidence; it does not receive the
raw HTML and cannot introduce a finding that is not in `link_findings`. Assert
this in a test.

### 6.3 Fix list export

CSV and JSON. One row per actionable edge:

| `source_url` | `current_href` | `suggested_href` | `rule_id` | `reason` | `dom_region` |

Only rules with a computable `suggested_target` appear: `L04`, `L05`, `L06`,
`L17`, `L18`, `L19`, `L27`, `L29`. Anchor-text and structural findings appear in
the report but not the fix list, because there is no mechanical correct answer.

This export is the v1 deliverable. It is also the exact input tier 3 will
consume later, so shape it now as if a connector will read it.

---

## 7. API surface

```
POST /api/audit/:auditId/links/run       → enqueue S2–S8
GET  /api/audit/:auditId/links           → summary + top findings
GET  /api/audit/:auditId/links/findings  → paginated, filter by rule_id/severity
GET  /api/audit/:auditId/links/export    → csv | json
```

All routes run under the user's session. RLS does the scoping. No service-role
key in any of these handlers.

---

## 8. Acceptance tests (write these first)

Build a fixture site under test with known defects. The suite must assert:

1. A page linked only via a 302 produces exactly one `L05`, with
   `suggested_href` equal to the final URL.
2. A 3-hop chain produces `L04`, not three separate `L05`s.
3. A → B → A produces `L03` once and does not hang.
4. A link to `/page?utm_source=x` and a link to `/page` produce **one**
   `link_targets` row.
5. A site using trailing slashes throughout produces zero `L18`.
6. A nav link repeated on 200 pages produces zero `L14`/`L15`/`L16`.
7. A page in the sitemap with no inbound anchors produces `L21` once.
8. An SPA fixture with 0 served-HTML anchors raises `L00_JS_SUSPECTED` and
   suppresses `L21` and `L23` for that site.
9. A user cannot read another user's `link_findings` (RLS test, real second user).
10. The report renderer, given a findings array, never outputs a claim whose
    rule_id is absent from that array.

Test 10 is the one that will actually save you. Every past recurring issue in
this codebase came from output drifting from computed state.

---

## 9. Copy constraints — read before writing any UI string

Do **not** describe this feature as making a site "compliant with Google's
link policy". No such policy governs internal linking. Google's link spam
policy is about manipulative *outbound* and inbound links; internal structure is
covered by crawlability and site-structure *guidance*, not a rule with a
penalty attached.

Accurate framings to use instead:
- "Finds links that waste crawl budget or send Google contradictory signals"
- "Broken, redirected and non-canonical internal links"
- "Pages Google can't reach through your own links"

Inaccurate, do not ship:
- "Google policy compliant link building"
- "Fixes link penalties"
- Any implied ranking guarantee

The same restraint rule applies as elsewhere: if a finding cannot be evidenced
from stored crawl data, it is not shown.

---

## 10. Sequencing

1. Extend crawler to persist anchors (`link_edges`) — small change
2. `link_targets` + resolver (S3–S6) — the bulk of the work
3. Rules `L01`–`L10`, `L21`, `L26`–`L29` — the high-value half, ship-able alone
4. Report + fix list export
5. Rules `L11`–`L20`, `L22`–`L24`, `L30`–`L32` — the polish half

Ship after step 4 if time is short. Steps 1–4 cover every finding a user would
call a real problem.
