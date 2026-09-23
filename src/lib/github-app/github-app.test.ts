import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { createHmac } from 'crypto'
import { createElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { verifyGithubWebhookSignature } from '@/lib/github-app/webhook'
import { buildSeorankoGithubAppManifest } from '@/lib/github-app/manifest'
import { scrubSentryEvent } from '@/lib/sentry-scrub'
import { mintManifestState, verifyManifestState } from '@/lib/github-app/state'
import { GithubAppSetupCreateView } from '@/app/admin/github-app-setup/create-view'

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
    expect(m.default_events).toEqual([
      'installation',
      'installation_repositories',
    ])
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
})

describe('GithubAppSetupCreateView (owner create path)', () => {
  it('renders Create button and manifest form for the owner', () => {
    const state = 'nonce.exp.sig'
    const manifestJson = JSON.stringify(buildSeorankoGithubAppManifest())
    const html = renderToStaticMarkup(
      createElement(GithubAppSetupCreateView, {
        state,
        manifestJson,
        error: null,
      }),
    )
    expect(html).toContain('Create SEORANKO GitHub App')
    expect(html).toContain('Create GitHub App on GitHub')
    expect(html).toContain('https://github.com/settings/apps/new?state=')
    expect(html).toContain('name="manifest"')
    expect(html).toContain('/api/webhooks/github')
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

  it('renders create UI for owner when no App exists without throwing', async () => {
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
    expect(html).toContain('Create SEORANKO GitHub App')
    expect(html).toContain('Create GitHub App on GitHub')
    expect(cookieSet).not.toHaveBeenCalled()
  })
})
