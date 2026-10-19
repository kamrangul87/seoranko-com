# Cloudflare Turnstile + Supabase Auth CAPTCHA

Stops the Sep 2026 signup-spam flood (random 15+ letter display names +
victim-victim / SMS-gateway emails).

## Keys you must add

| Where | Which key | Env / field |
| --- | --- | --- |
| **Supabase → Authentication → Attack Protection** | Cloudflare Turnstile **Secret Key** | CAPTCHA provider = Cloudflare Turnstile; paste Secret Key |
| **Vercel** (Production + Preview) | Cloudflare Turnstile **Site Key** | `NEXT_PUBLIC_TURNSTILE_SITE_KEY` |

Do **not** put the Turnstile secret in Vercel. Supabase Auth verifies
`captchaToken` with the secret you paste in Attack Protection.

## App wiring

- Signup + login render `@marsidev/react-turnstile` when the site key is set.
- Signup goes through `POST /api/auth/signup` which:
  - rejects random bot display names (`looksLikeRandomBotDisplayName`)
  - rate-limits per IP (5 / hour / isolate)
  - calls `supabase.auth.signUp({ …, options: { captchaToken } })`
- Login calls `signInWithPassword({ …, options: { captchaToken } })`.

## Bot cleanup (list only until you say delete)

```bash
node scripts/list-bot-auth-users.mjs
# after human replies "delete":
node scripts/list-bot-auth-users.mjs --delete
```

Never deletes the owner account (`kamrangul87@gmail.com`) or anyone with a
site / subscription / Stripe customer.
