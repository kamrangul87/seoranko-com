# SEORANKO auth email (Supabase → Resend)

## The bug this fixes

Email confirmation is **ON** in Supabase Auth, and no SMTP provider was ever
configured for it. Confirmation emails were never sent. `signUp()` still
creates the `auth.users` row (so it *looks* like signup worked), but the
account can never log in until it's confirmed — and with no email, it never
is. Six real signups in production hit exactly this and never got past the
signup screen; see `src/app/signup/page.tsx`'s `confirmationSent` branch for
the fix on the app side (it now tells the user to check their email instead
of silently redirecting to a dashboard they can't reach).

Turning confirmation off instead was considered and rejected: this product
crawls a site on request, and unconfirmed signup would let anyone queue
crawls against an email address they don't own.

## Supabase Dashboard → Authentication → Emails → SMTP Settings

Resend is already wired in this app via `RESEND_API_KEY` — reuse that same
Resend account via its SMTP relay rather than adding a new provider. (The
old weekly `send-digests` cron that also used Resend was retired; see
`docs/RETIRED_WEEKLY_EMAIL_DIGEST.md`.)

| Field | Value |
|---|---|
| Enable Custom SMTP | On |
| Sender email | `noreply@seoranko.com` (any address on the verified `seoranko.com` domain works — Resend verifies at the domain level, not per-address) |
| Sender name | `SEORANKO` |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` (literal string, not your API key) |
| Password | your `RESEND_API_KEY` value (`re_…`) |

**I could not confirm `seoranko.com` is a verified sending domain in Resend
myself** — no Resend API access from this session, and the Vercel MCP
connection 403s on this project's env vars, so I can't check `RESEND_API_KEY`
either. Check Resend → Domains yourself before relying on this.

## Also check while you're in the dashboard

**Authentication → URL Configuration → Site URL.** The confirmation email's
link is built from this setting whenever the signup call doesn't override it.
`signup/page.tsx` now passes `emailRedirectTo: window.location.origin +
'/dashboard'` explicitly, so the link should be correct regardless of this
setting — but if Site URL is still `http://localhost:3000`, add
`https://seoranko.com/dashboard` (or `https://seoranko.com/**`) to **Redirect
URLs** too, or Supabase will reject the explicit `emailRedirectTo` as
unlisted and fall back to Site URL anyway.

## What changed in code (this PR)

- `handle_new_user()` trigger (migration `20260928120000`) now reads the
  picked plan from signup metadata instead of hardcoding `'free'` — it's the
  only thing that populates `user_profiles` when there's no session yet
  (confirmation-required signups never reach the old client-side
  `upsert()`, which needed an active session to pass RLS).
- `signup/page.tsx`: explicit `emailRedirectTo`; shows "Check your email"
  instead of redirecting to `/dashboard` when `signUp()` returns no session.
