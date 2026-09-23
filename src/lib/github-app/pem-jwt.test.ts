import { describe, expect, it } from 'vitest'
import { generateKeyPairSync } from 'crypto'
import {
  inspectAndNormalizeGithubAppPem,
  pemInspectPublicMeta,
  repairPemWrapping,
} from '@/lib/github-app/pem'
import { createGithubAppJwtDetailed } from '@/lib/github-app/auth'

function genPem(type: 'pkcs1' | 'pkcs8'): string {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: {
      type: type === 'pkcs1' ? 'pkcs1' : 'pkcs8',
      format: 'pem',
    },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  })
  return privateKey
}

describe('PEM normalize + JWT claims', () => {
  it('accepts PKCS#1 and converts to PKCS#8 for signing', () => {
    const pem = genPem('pkcs1')
    expect(pem).toContain('BEGIN RSA PRIVATE KEY')
    const inspect = inspectAndNormalizeGithubAppPem(pem)
    expect(inspect.format).toBe('pkcs1')
    expect(inspect.signerAccepts).toBe(true)
    expect(inspect.convertedToPkcs8).toBe(true)
    expect(inspect.normalizedPem).toContain('BEGIN PRIVATE KEY')
    expect(JSON.stringify(pemInspectPublicMeta(inspect))).not.toContain('BEGIN')
  })

  it('repairs collapsed newlines so the signer accepts the key', () => {
    const pem = genPem('pkcs1')
    const collapsed = pem.replace(/\n/g, ' ').trim()
    expect(inspectAndNormalizeGithubAppPem(collapsed).newlineStyle).toBe(
      'collapsed_or_missing',
    )
    const repaired = repairPemWrapping(collapsed)
    expect(repaired.repairedCollapsedNewlines).toBe(true)
    const inspect = inspectAndNormalizeGithubAppPem(collapsed)
    expect(inspect.signerAccepts).toBe(true)
    expect(inspect.repairedCollapsedNewlines).toBe(true)
  })

  it('builds JWT with iat=now-60, exp-iat=600, iss=appId, alg=RS256', () => {
    const pem = genPem('pkcs1')
    const now = 1_700_000_000
    const built = createGithubAppJwtDetailed(5045070, pem, now)
    expect(built.claims).toEqual({
      alg: 'RS256',
      typ: 'JWT',
      iat: now - 60,
      exp: now + 9 * 60,
      iss: '5045070',
      lifetimeSeconds: 600,
      iatSkewSeconds: 60,
    })
    expect(built.pem.converted_to_pkcs8).toBe(true)
    const [h, p] = built.jwt.split('.')
    const header = JSON.parse(Buffer.from(h, 'base64url').toString())
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString())
    expect(header).toEqual({ alg: 'RS256', typ: 'JWT' })
    expect(payload).toEqual({ iat: now - 60, exp: now + 540, iss: '5045070' })
  })
})
