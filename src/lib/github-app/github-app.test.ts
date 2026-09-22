import { describe, expect, it } from 'vitest'
import { createHmac } from 'crypto'
import { verifyGithubWebhookSignature } from '@/lib/github-app/webhook'
import { buildSeorankoGithubAppManifest } from '@/lib/github-app/manifest'
import { scrubSentryEvent } from '@/lib/sentry-scrub'

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
