import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { createHmac } from 'crypto'
import { createElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { verifyGithubWebhookSignature } from '@/lib/github-app/webhook'
import {
  buildSeorankoGithubAppManifest,
  GITHUB_APP_MANIFEST_UNSUPPORTED_EVENTS,
} from '@/lib/github-app/manifest'
import { scrubSentryEvent } from '@/lib/sentry-scrub'
import {
  MANIFEST_STATE_TTL_MS,
  manifestStateErrorMessage,
  mintManifestState,
  verifyManifestState,
  verifyManifestStateDetailed,
} from '@/lib/github-app/state'
import { GithubAppSetupCreateView } from '@/app/admin/github-app-setup/create-view'
import { GITHUB_APP_URLS } from '@/lib/github-app/urls'
import { conversionMetaWithoutSecrets } from '@/lib/github-app/exchange-manifest'

const cookieSet = vi.fn()

vi.mock('next/headers', () => ({
  cookies: () => ({
    set: (...args: unknown[]) => cookieSet(...args),
    get: vi.fn(),
  }),
}))

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string
    children?: ReactNode
    className?: string
  }) => createElement('a', { href, ...rest }, children),
}))

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`)
  },
}))
describe('verifyGithubWebhookSignature', () => {
  it('accepts a valid sha256 signature', () => {
    const secret = 'test-webhook-secret'
    const body = '{"action":"deleted","installation":{"id":1}}'
    const sig =
      'sha256=' + createHmac('sha256', secret).update(body).digest('hex')
    expect(verifyGithubWebhookSignature(body, sig, secret)).toBe(true)
  })

  it('rejects missing or wrong signatures', () => {
    const secret = 'test-webhook-secret'
    const body = '{"action":"deleted"}'
    expect(verifyGithubWebhookSignature(body, null, secret)).toBe(false)
    expect(
      verifyGithubWebhookSignature(body, 'sha256=deadbeef', secret),
    ).toBe(false)
  })
})

describe('buildSeorankoGithubAppManifest', () => {
  it('includes required permissions, events, and URLs', () => {
    const m = buildSeorankoGithubAppManifest()
    expect(m.name).toBe('SEORANKO')
    expect(m.url).toBe('https://www.seoranko.com')
    expect(m.default_permissions).toEqual({
      contents: 'write',
      pull_requests: 'write',
      statuses: 'write',
      metadata: 'read',
    })
    // installation / installation_repositories are auto-delivered and rejected
    // if listed ("Default events unsupported").
    expect(m.default_events).toEqual([])
    for (const ev of GITHUB_APP_MANIFEST_UNSUPPORTED_EVENTS) {
      expect(m.default_events as string[]).not.toContain(ev)
    }
    expect(m.redirect_url).toContain('/api/github/app/manifest/callback')
    expect((m.hook_attributes as { url: string }).url).toContain(
      '/api/webhooks/github',
    )
    expect(m.setup_url).toContain('/api/github/app/setup')
  })
})

describe('scrubSentryEvent', () => {
  it('redacts PEM, tokens, and secret-named fields', () => {
    const event = scrubSentryEvent({
      extra: {
        private_key_pem: '-----BEGIN RSA PRIVATE KEY-----\nABC\n-----END RSA PRIVATE KEY-----',
        accessToken: 'ghs_abcdefghijklmnopqrstuvwxyz0123456789',
        note: 'ok',
      },
      request: {
        headers: { authorization: 'Bearer secret', 'content-type': 'application/json' },
        data: { webhook_secret: 'shh' },
      },
    })
    expect(event.extra?.private_key_pem).toBe('[Filtered]')
    expect(event.extra?.accessToken).toBe('[Filtered]')
    expect(event.extra?.note).toBe('ok')
    expect(event.request?.headers?.authorization).toBe('[Filtered]')
    expect((event.request?.data as { webhook_secret: string }).webhook_secret).toBe(
      '[Filtered]',
    )
  })
})

describe('mintManifestState (no cookie mutation)', () => {
  beforeEach(() => {
    cookieSet.mockClear()
    process.env.SITE_CONNECTION_ENCRYPTION_KEY = 'test-encryption-key-for-state-hmac'
  })
  afterEach(() => {
    delete process.env.SITE_CONNECTION_ENCRYPTION_KEY
  })

  it('returns a verifiable state without calling cookies().set', () => {
    const state = mintManifestState()
    expect(cookieSet).not.toHaveBeenCalled()
    expect(verifyManifestState(state)).toBe(true)
    expect(verifyManifestState('tampered.' + state)).toBe(false)
    expect(verifyManifestState(null)).toBe(false)
  })

  it('uses a 10-minute TTL and rejects expired state with a clear reason', () => {
    expect(MANIFEST_STATE_TTL_MS).toBe(10 * 60 * 1000)
    expect(manifestStateErrorMessage('expired')).toMatch(/over 10 minutes/i)
    expect(manifestStateErrorMessage('expired')).toMatch(/Start again/i)

    const state = mintManifestState()
    const [nonce, , sig] = state.split('.')
    const expired = `${nonce}.${Date.now() - 1000}.${sig}`
    expect(verifyManifestStateDetailed(null)).toEqual({ ok: false, reason: 'missing' })
    expect(verifyManifestStateDetailed('a.b')).toEqual({ ok: false, reason: 'malformed' })
    const keyRaw = process.env.SITE_CONNECTION_ENCRYPTION_KEY!
    const key = createHmac('sha256', 'seoranko-gh-app-state').update(keyRaw).digest()
    const body = `nonce.${Date.now() - 60_000}`
    const expiredSig = createHmac('sha256', key).update(body).digest('base64url')
    expect(verifyManifestStateDetailed(`${body}.${expiredSig}`)).toEqual({
      ok: false,
      reason: 'expired',
    })
    expect(expired.split('.').length).toBe(3)
    expect(sig.length).toBeGreaterThan(0)
  })
})

describe('conversionMetaWithoutSecrets', () => {
  it('keeps owner + field names and never embeds pem/secret values', () => {
    const meta = conversionMetaWithoutSecrets({
      id: 1,
      slug: 'seoranko',
      client_id: 'Iv1',
      client_secret: 'SECRET',
      webhook_secret: 'WH',
      pem: '-----BEGIN PRIVATE KEY-----\nX\n-----END PRIVATE KEY-----',
      owner: { login: 'kamrangul87', type: 'User', id: 1 },
      fieldNames: ['id', 'slug', 'client_id', 'client_secret', 'webhook_secret', 'pem', 'owner'],
      raw: {},
      convertedAt: '2026-09-23T00:00:00.000Z',
    })
    expect(meta.owner_login).toBe('kamrangul87')
    expect(meta.owner_type).toBe('User')
    expect(meta.field_names).toContain('pem')
    expect(JSON.stringify(meta)).not.toContain('BEGIN PRIVATE')
    expect(JSON.stringify(meta)).not.toContain('SECRET')
  })
})

describe('GithubAppSetupCreateView (manual entry primary)', () => {
  it('renders manual form, GitHub form values, diagnose, and demoted manifest', () => {
    const html = renderToStaticMarkup(
      createElement(GithubAppSetupCreateView, {
        error: null,
        preservedAppId: '5045070',
        preservedClientId: 'Iv23li0BECGplh77oqbd',
      }),
    )
    expect(html).toContain('Register SEORANKO GitHub App')
    expect(html).toContain('Verify and store')
    expect(html).toContain(GITHUB_APP_URLS.manualRegister)
    expect(html).toContain(GITHUB_APP_URLS.jwtDiagnose)
    expect(html).toContain('Run JWT diagnose')
    expect(html).toContain('name="app_id"')
    expect(html).toContain('value="5045070"')
    expect(html).toContain('value="Iv23li0BECGplh77oqbd"')
    expect(html).toContain('encType="multipart/form-data"')
    expect(html).toContain(GITHUB_APP_URLS.homepage)
    expect(html).toContain(GITHUB_APP_URLS.oauthCallback)
    expect(html).toContain('Alternative: App Manifest')
    expect(cookieSet).not.toHaveBeenCalled()
  })
})

describe('GithubAppSetupPage owner create path (no cookie.set)', () => {
  beforeEach(() => {
    cookieSet.mockImplementation(() => {
      throw new Error(
        'Cookies can only be modified in a Server Action or Route Handler.',
      )
    })
    process.env.SITE_CONNECTION_ENCRYPTION_KEY = 'test-encryption-key-for-state-hmac'
    process.env.MASTER_EMAIL = 'owner@example.com'
  })
  afterEach(() => {
    cookieSet.mockReset()
    delete process.env.SITE_CONNECTION_ENCRYPTION_KEY
    delete process.env.MASTER_EMAIL
    vi.resetModules()
  })

  it('renders manual register UI for owner when no App exists without throwing', async () => {
    vi.doMock('@/lib/github-app/require-master', () => ({
      requireMasterUser: async () => ({
        ok: true as const,
        user: { id: 'owner-1', email: 'owner@example.com' },
      }),
    }))
    vi.doMock('@/lib/github-app/store', () => ({
      getGithubAppPublicMeta: async () => null,
    }))

    const { default: Page } = await import('@/app/admin/github-app-setup/page')
    const el = await Page({})
    const html = renderToStaticMarkup(el as ReactElement)
    expect(html).toContain('Register SEORANKO GitHub App')
    expect(html).toContain('Verify and store')
    expect(html).toContain('/api/github/app/manual-register')
    expect(html).toContain('Create via GitHub Manifest')
    expect(cookieSet).not.toHaveBeenCalled()
  })
})
