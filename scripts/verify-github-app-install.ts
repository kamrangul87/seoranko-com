/**
 * One-shot: repair installation account_login, mint repo-scoped token,
 * prove autodun-ai access and seoranko-com denial.
 */
import { createClient } from '@supabase/supabase-js'
import { createSign, createPrivateKey } from 'crypto'
import { decryptCredentialsJson } from '../src/lib/site-connection-crypto'

function b64url(input: Buffer | string) {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input
  return buf.toString('base64url')
}

function createJwt(appId: number, pem: string) {
  const key = createPrivateKey(pem)
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = b64url(
    JSON.stringify({ iat: now - 60, exp: now + 9 * 60, iss: String(appId) }),
  )
  const data = `${header}.${payload}`
  const signer = createSign('RSA-SHA256')
  signer.update(data)
  return `${data}.${b64url(signer.sign(key))}`
}

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
  const { data: row, error } = await sb.from('github_app_config').select('*').single()
  if (error || !row) throw new Error(error?.message || 'no app config')
  const secrets = decryptCredentialsJson(row.credentials_ciphertext) as {
    private_key_pem: string
    client_secret: string
    webhook_secret: string
  }
  const jwt = createJwt(Number(row.app_id), secrets.private_key_pem)

  const listRes = await fetch('https://api.github.com/app/installations', {
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'seoranko-verify',
    },
  })
  const listText = await listRes.text()
  console.log('list_installations', listRes.status)
  const list = JSON.parse(listText) as
    | Array<Record<string, unknown>>
    | { installations?: Array<Record<string, unknown>> }
  const installs = Array.isArray(list) ? list : list.installations || []
  const inst = installs[0] as
    | {
        id: number
        account?: { login?: string; type?: string; id?: number }
        repository_selection?: string
      }
    | undefined
  if (!inst) throw new Error('NO_INSTALL')

  const accountLogin = inst.account?.login || ''
  const installationId = inst.id
  console.log(
    JSON.stringify(
      {
        installationId,
        accountLogin,
        accountType: inst.account?.type,
        accountId: inst.account?.id,
        repoSelection: inst.repository_selection,
      },
      null,
      2,
    ),
  )

  const { data: updated, error: upErr } = await sb
    .from('github_installations')
    .upsert(
      {
        installation_id: installationId,
        account_login: accountLogin,
        account_type: inst.account?.type || 'User',
        account_id: inst.account?.id ?? null,
        repository_selection: inst.repository_selection ?? null,
        suspended_at: null,
        uninstalled_at: null,
        raw: inst,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'installation_id' },
    )
    .select()
    .single()
  console.log('db_repair', upErr?.message || 'ok', updated?.account_login)

  const mintRes = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'seoranko-verify',
      },
      body: JSON.stringify({ repositories: ['autodun-ai'] }),
    },
  )
  const mintText = await mintRes.text()
  if (!mintRes.ok) {
    console.log('mint_fail', mintRes.status, mintText.slice(0, 400))
    process.exit(1)
  }
  const minted = JSON.parse(mintText) as {
    token: string
    expires_at: string
    repositories?: Array<{ full_name?: string; name?: string }>
  }
  const token = minted.token
  const repos = (minted.repositories || []).map((r) => r.full_name || r.name)
  console.log(
    'mint_ok',
    JSON.stringify({
      expires_at: minted.expires_at,
      repositories: repos,
      tokenPrefix: token.slice(0, 4) + '…',
    }),
  )

  const okRes = await fetch('https://api.github.com/repos/kamrangul87/autodun-ai', {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'seoranko-verify',
    },
  })
  console.log('access_autodun-ai', okRes.status)

  const denyRes = await fetch('https://api.github.com/repos/kamrangul87/seoranko-com', {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'seoranko-verify',
    },
  })
  const denyBody = await denyRes.text()
  console.log('access_seoranko-com', denyRes.status, denyBody.slice(0, 200))

  const reposRes = await fetch('https://api.github.com/installation/repositories', {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'seoranko-verify',
    },
  })
  const reposJson = (await reposRes.json()) as {
    total_count?: number
    repositories?: Array<{ full_name?: string }>
  }
  console.log(
    'installation_repositories',
    reposRes.status,
    JSON.stringify({
      total_count: reposJson.total_count,
      names: (reposJson.repositories || []).map((r) => r.full_name),
    }),
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
