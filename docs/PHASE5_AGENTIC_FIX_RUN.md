# SEORANKO — Phase 5 Agentic Fix Run (status receipt)

**Directive received:** 10 September 2026 (`SEORANKO-directive-agentic-fix-run.md`)  
**Implementation status:** **NOT STARTED — BLOCKED**

Do not implement sub-phases 5A–5H until Phase **2A** and **2B** of the beta-readiness
gate are closed with production evidence. This file records that the directive was
read, answers the freeze / RLS questions it raises, and shapes how Phase 2 work
must land so Phase 5 can attach cleanly later.

---

## Gate status (why Phase 5 stays blocked)

| Gate | Required evidence | Current class |
|---|---|---|
| **2A** First live GSC URL inspection | `gsc_url_inspections` count ≥ 1 from a real Sync / inspection path that also calls `reserve_gsc_inspection_quota` | **not started (data)** — migrate CI + matrix still report **0** inspection rows; quota usage also **0** (RPC never exercised by live sync) |
| **2B** Fix Agent honesty + 2 additional verified GitHub kinds | ≥2 verified strategies beyond `remove-dead-link` / `remove-dead-anchors`, with live after-state | **partial** — honesty/contracts on `main`; **only 1** verified attempt in prod (`remove-dead-anchors`, 9 Sept) |

Sources: `docs/VERIFICATION_MATRIX.md`, migrate CI probes (`beta-platform-usage-probe`, `fix-agent-verified-kinds-probe`, `gsc-first-inspection-probe`), directive §0 production read (10 Sept).

**Phase 5 code must not start** until both rows flip with stored IDs / timestamps.

---

## Answers required by the directive (§0)

### 1. Who authorised `public_scans` / the public Index Diagnosis tool mid-freeze?

| Field | Fact |
|---|---|
| Authoriser | Product owner (Cursor task owner), via uploaded prompt `cursor-prompt-index-diagnosis-public.md` |
| Instruction | Ship one public no-signup Index Diagnosis funnel; **push directly to `main`**; include `public_scans` with RLS |
| Executor | Cloud agent on this repo, 10 Sept 2026 morning |
| Commits (examples) | `fdb7c12` (feature + migration), follow-ups `5370073`, `9840ea5`, `c787cf2` |
| Migration applied | `20260910080000_public_scans.sql` via migrate CI on that push (e.g. run `34450860001`) |

**Why it happened during the freeze:** the agent treated the explicit “ship this funnel now / DoD before anything else” task as an override of the earlier beta-reliability-only scope. That was a **process miss** relative to the freeze intent. The surface is now on **explicit hold** (directive §3): no further public-tool features until told.

### 2. `public_scans` RLS with zero policies — justification + fix

**Design intent (service-role-only):**

- Browser clients never read or write `public_scans`.
- `POST /api/public/index-diagnosis` and `/unlock` use the **service role** key.
- `REVOKE ALL … FROM anon, authenticated` plus RLS enabled ⇒ deny-all for browser roles even if someone pointed the anon client at the table.
- Live funnel scans on `www.seoranko.com` return non-null `scanId` and unlock works — proof the service-role path functions.

**Why zero policies was insufficient vs house rule:** new tables must ship with RLS **and at least one policy**. Empty policy sets satisfy “RLS on” but look like an incomplete security review.

**Remediation:** additive migration `20260910100000_public_scans_deny_policies.sql` adds explicit **deny-all** policies for `anon` and `authenticated`. Service role continues to bypass RLS (Supabase default). No public SELECT/INSERT policy is added — that would widen the free surface and violate the freeze.

---

## Phase 5 shape (read-ahead only — not scheduled)

Rough hours (engineering only; excludes waiting on deploy APIs / credentials):

| Sub-phase | Rough hours | Depends on | Notes for Phase 2 shaping |
|---|---|---|---|
| **5A** Deploy watcher | 10–16 h | Host deploy API + commit SHA on every write | Phase 2B live verifies must record **commit SHA** and eventually a deploy ID — do not verify only “HTML looks fixed” without linkage |
| **5B** Live verifier (separate path) | 8–14 h | 5A | Keep writer ≠ verifier (already a standing rule); security headers assert **served** headers |
| **5C** Convergence + `not_mechanically_fixable` | 6–10 h | Classification | Stop re-handing-off the five autodun findings; classify CWV/thin as unfixable |
| **5D** Site model | 12–20 h | GitHub connector | Mechanical repo derivation only — no model file-purpose inference |
| **5E** Fix Run object / batch / budget | 14–22 h | 5A–5C | One commit → one deploy → one verify sweep; report usage before shipping |
| **5F** Strategy registry + autonomy ladder | 10–16 h | Rollback proven | Cap at L2 until revert works; `remove-dead-anchors` ≤ L2 from evidence |
| **5G** Fixture farm in merge-gated CI | 10–16 h | 2D harness | Extends Phase 2D — fixtures already CI-gated |
| **5H** Strategy gap records | 6–10 h | 5B | Offline strategy authoring only |

**Serial estimate:** ~76–124 h eng if taken end-to-end after 2A/2B. Not started.

### Standing constraints baked into any future Phase 5 PR/commit

1. No LLM authors or applies customer-repo changes at runtime.
2. Live response verification only; never bless from repo/config file state alone.
3. Verifier ≠ executor code path.
4. Direct-to-`main`; additive migrations; stop before destructive DDL.
5. New tables: RLS **and** ≥1 policy.
6. No new public tool surface while freeze holds.
7. Per sub-phase evidence reports only — no single “all done”.

---

## Immediate next work (not Phase 5)

1. **Close 2A** — valid GSC token + Sync / inspection path until `gsc_url_inspections` ≥ 1 **and** `gsc_inspection_quota_usage` shows a real reserve/outcome (proves the hardened RPC ran).
2. **Close 2B** — two additional GitHub strategies reach `verified` with live after-state (beyond dead-link).
3. Keep public Index Diagnosis **frozen** (conversion copy already shipped; no further funnel work).

When 2A and 2B are evidenced in `VERIFICATION_MATRIX.md`, re-open this file and start **5A** only.
