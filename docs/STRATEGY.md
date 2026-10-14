# SEORANKO: How to Become the Tool People Choose and Happily Pay For

> Source of truth for positioning stays `docs/POSITIONING.md`. This file is the build and go-to-market plan that sits under it. If the two disagree, POSITIONING.md wins.

## 1. The problem with the market

Ahrefs, Semrush, Screaming Frog, Sitebulb and Moz mostly do the same thing: **they hand you a list of problems.** Then the user has to:
- understand the jargon,
- convince a developer to fix it,
- wait weeks,
- re-run the audit to see if it worked.

Most audit findings never get fixed. **That's the gap.** People don't want another report. They want the problems gone.

## 2. SEORANKO's unique promise

> **"The SEO tool that fixes problems in your code and proves the fix is live."**

Three things nobody else does together:
1. **Fixes in your real code** (pull request, not just advice).
2. **Proves it's live** (re-checks the real deployed page, not repo state).
3. **Honest by design** (no fake scores, no ranking promises, no AI writing or applying changes in your code at runtime).

Everything below strengthens one of those three.

---

## 3. Signature features

### 3.1 Fix Receipt
Every fix gets a permanent receipt page: problem, the exact code diff, PR link, date verified live, and Google's indexing status before and after.
- **Private by default.** The receipt contains the customer's code. Sharing is an explicit per-receipt "Create share link" action, revocable.
- Built as a view on the existing fix outcome ledger, not a new data store.
- Why it wins: users can show their boss or client real proof of work. Agencies forward it to clients.

### 3.2 Indexing Proof from Google (Search Console link)
For each fixed URL, show Google's own URL Inspection verdict before the fix and after it, with dates.
- Reuses the existing GSC sync and URL Inspection work. Only inspect fixed URLs, to stay inside the per-property daily quota.
- Wording rule: "Indexed after the fix", never "indexed because of the fix". Causal claims only come from the experiment engine.
- Why it wins: proves outcome without claiming rankings.

### 3.3 "Fix It For Me" free audit
The no-signup audit (the free Index Diagnosis tool) shows a **fix preview** for 1 to 2 findings: the rendered HTML before and after (e.g. the missing canonical tag added). Without repo access we cannot show a real code diff, so we never call it one.
- Then: **"Connect GitHub and we'll open the real PR."** No time promise until measured.
- Why it wins: the user sees the value before paying. The free audit becomes the sales pitch.

### 3.4 Regression Guard (GitHub check)
SEORANKO runs as a check on every pull request in the customer's repo and flags merges that break canonicals, sitemaps, robots, internal links or image sizes. Warn-only by default; blocking is opt-in.
- Why it wins: prevents problems instead of just finding them. Very hard to cancel.

### 3.5 Indexing Health Timeline
One simple chart: problems found, fixed, verified, and regressions over time. "Your site has had 0 indexing blockers for 47 days."
- Why it wins: a clear number people want to keep green.

### 3.6 Plain-English Weekly Brief (email + Slack)
"2 new problems this week. 1 is already fixed in PR #52, approve here. 1 needs your developer because…"
- One-click approve from the email, using a signed, single-use, short-expiry link that lands on a confirm page (email scanners pre-open links, so a bare GET must never merge anything).
- Why it wins: zero dashboard time needed.

### 3.7 Deploy Watch
After every production deploy (Vercel or Netlify webhook), re-check a **small fixed set**: homepage, robots.txt, sitemap, and the top pages by GSC impressions (cap ~20 URLs). Alert within minutes if something broke indexing (noindex left on, canonical wrong, robots blocked).
- This is a targeted check, not a crawl. A full 2,000-page crawl takes hours and stays scheduled.
- Why it wins: catches an accidental noindex the same day, not next month.

### 3.8 Privacy & Consent Check (promote it once confirmed shipped)
Tracking before consent, missing vendors in the privacy page, missing sections. Human-reviewed legal clauses, never auto-merged.
- Why it wins: no SEO tool does this. A real reason for UK/EU businesses to pay.

---

## 4. Reach more customers

| Feature | Why |
|---|---|
| WordPress plugin that applies fixes | Largest share of websites by far (after first paying customers) |
| Shopify app (redirects, canonicals, sitemaps, image sizes) | Big paying e-commerce market |
| Netlify and Cloudflare Pages support for live verification | Not every GitHub site is on Vercel |
| GitLab and Bitbucket support | Agencies and companies not on GitHub |
| "Send to my developer" link | Non-technical owners invite their dev with one link |

---

## 5. Agency plan features

- Many client sites in one dashboard.
- White-label Fix Receipts and PDF reports with the agency's logo.
- Client view-only login.
- Monthly auto-report: "This month we fixed 23 issues across 8 sites, all verified live."
- Bulk approve fixes across sites.

---

## 6. Trust features

- **"What we will never do" page:** never merge without your approval (unless you switch on auto-merge, which only covers auto-fixable single-file fixes), no model writing or applying edits to your code at runtime, no ranking promises.
- **Read-only first:** start detect-only, upgrade permissions only when they want fixes.
- **One-click undo:** a revert PR for any fix.
- **Public live stats:** only real, verified numbers. Hide the counter until it is meaningful (100+ verified fixes).
- **Public changelog and status page.**
- **Security page:** permissions requested, data stored, data retention.

---

## 7. Make buying easy

1. **Homepage:** a 60-second video of the full loop (find, PR, verify live).
2. **Free audit → paid:** the report ends with "Fix these 7 automatically" and a price.
3. **Free trial of the Fix Agent:** up to 3 fixes on one site free, no card.
4. **Pay per outcome option:** pay only for fixes verified live. Test, don't launch with it.
5. **Monthly/annual toggle** with annual discount.
6. **Money-back promise:** if we find an auto-fixable problem and don't fix and verify it in your first month, full refund.
7. **Comparison page:** "SEORANKO vs Ahrefs / Screaming Frog / Semrush": they report, we fix and prove. Factual, no disparaging claims. Check competitors' current auto-fix features (e.g. Ahrefs Patches, Search Atlas OTTO, Alli AI) before publishing. Factual differences only: we fix in source code via PR and verify live.
8. **Case studies:** autodun.com first, with Fix Receipts and Search Console before/after. Disclose it is the founder's own site; replace with a customer site as soon as one exists.

---

## 8. Marketing hooks

- Tagline: **"Stop reading SEO reports. Start shipping fixes."**
- "Your audit has 140 issues. How many have actually been fixed?"
- Free tools that bring traffic: canonical checker, sitemap validator, robots.txt tester, noindex checker, cookie consent checker. Each ends with "Fix this automatically."
- Launch on Product Hunt, Indie Hackers, Hacker News ("Show HN") and the Next.js / Vercel communities.
- Partner with web agencies and freelance developers (referral commission).

---

## 9. Build order

**Now (before launch)**
1. Merge PR #200, finish the 7-day test streak, run one real paid Stripe checkout end to end.
2. Registered office address on /privacy and /terms, remove DRAFT markers, show crawl duration in the UI.
3. Free audit shows a fix preview and a "Fix it for me" button.
4. Fix Receipt pages (private by default).
5. Fix Agent free trial (3 fixes).

**Next 1 to 2 months**
6. Search Console before/after on Fix Receipts.
7. Deploy Watch (targeted re-check).
8. Weekly brief with signed one-click approve.
9. Comparison pages and free mini-tools.

**After first paying customers**
10. Regression Guard GitHub check.
11. Agency plan (white-label, multi-site).
12. WordPress plugin, then Shopify app.
13. Pay-per-verified-fix pricing test.

---

## 10. One-line summary

Every other tool tells you what's wrong. **SEORANKO fixes it, proves it's live, and stops it breaking again.** Build every feature to make that sentence more true, and make it easy to see in under a minute.

---

## 11. Verdict

**Build next:** free audit with fix preview, Fix Receipts, Search Console proof, Deploy Watch.

**Later:** weekly brief, Regression Guard, agency plan, WordPress plugin, Shopify app, pay-per-verified-fix pricing.

**Skip:** keyword research, rank tracking, backlinks, AI-written content or meta tags, an overall "SEO score".
