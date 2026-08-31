'use client'
import { useEffect, useMemo, useState } from 'react'

function IconCopy({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}
function IconCheck({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

type DetectedPlatform = 'wordpress' | 'shopify' | 'webflow' | 'unknown'
export type ConnectPlatform = 'wordpress' | 'shopify' | 'webflow' | 'github' | 'universal-tag'

interface Field { key: string; label: string; placeholder: string; secret?: boolean; optional?: boolean }

const PLATFORM_ORDER: ConnectPlatform[] = ['github', 'wordpress', 'shopify', 'webflow', 'universal-tag']

const PLATFORM_META: Record<ConnectPlatform, { label: string; short: string; blurb: string }> = {
  github: {
    label: 'GitHub',
    short: 'GitHub',
    blurb: 'Best for Vercel/Netlify/static sites. Fix Agent can commit schema, meta, and llms.txt.',
  },
  wordpress: {
    label: 'WordPress',
    short: 'WordPress',
    blurb: 'Application Passwords — no plugin required (Editor or Administrator).',
  },
  shopify: {
    label: 'Shopify',
    short: 'Shopify',
    blurb: 'Custom app Admin API token with read_content + write_content.',
  },
  webflow: {
    label: 'Webflow',
    short: 'Webflow',
    blurb: 'Data API v2 site token with CMS read/write.',
  },
  'universal-tag': {
    label: 'Universal Tag',
    short: 'Script tag',
    blurb: 'Fallback only — injects schema in the browser. Cannot set HTTP headers or write static files.',
  },
}

const PLATFORM_FIELDS: Record<Exclude<ConnectPlatform, 'universal-tag'>, { help: React.ReactNode; fields: Field[]; footnote?: string }> = {
  wordpress: {
    help: (
      <>
        In WP Admin: <strong>Users → Profile → Application Passwords</strong> → create one named &ldquo;SEORANKO&rdquo;.
        The account needs <strong>Editor</strong> or <strong>Administrator</strong> permissions.
      </>
    ),
    fields: [
      { key: 'username', label: 'WordPress username', placeholder: 'admin' },
      { key: 'appPassword', label: 'Application Password', placeholder: 'xxxx xxxx xxxx xxxx xxxx xxxx', secret: true },
    ],
  },
  shopify: {
    help: (
      <>
        Create a Custom App in <strong>Shopify Admin → Settings → Apps → Develop apps</strong>,
        install it, and copy the Admin API access token with
        <strong> read_content</strong> and <strong>write_content</strong>.
      </>
    ),
    fields: [
      { key: 'shopDomain', label: 'Store domain', placeholder: 'your-store.myshopify.com' },
      { key: 'accessToken', label: 'Admin API access token', placeholder: 'shpat_…', secret: true },
    ],
  },
  github: {
    help: (
      <>
        Create a fine-grained token at{' '}
        <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">
          github.com/settings/tokens
        </a>{' '}
        scoped to the repository that builds this live site, with{' '}
        <strong>Contents: Read and write</strong> (and Pull requests: Read and write for review-required fixes).
      </>
    ),
    fields: [
      { key: 'owner', label: 'GitHub owner / org', placeholder: 'your-github-org' },
      { key: 'repo', label: 'Repository name', placeholder: 'your-site-repo' },
      { key: 'branch', label: 'Branch', placeholder: 'main', optional: true },
      { key: 'accessToken', label: 'Access token', placeholder: 'github_pat_…', secret: true },
    ],
    footnote: 'Safe fixes (schema, llms.txt) commit directly. Visible content changes open a Pull Request for review.',
  },
  webflow: {
    help: (
      <>
        Generate a token in <strong>Webflow → Site Settings → Apps &amp; Integrations → API Access</strong>.
        It needs CMS read/write and site publish permissions.
      </>
    ),
    fields: [
      { key: 'siteId', label: 'Webflow Site ID', placeholder: '64f…' },
      { key: 'apiToken', label: 'API token', placeholder: 'Bearer token', secret: true },
    ],
  },
}

function detectedToConnect(p: DetectedPlatform): ConnectPlatform | null {
  if (p === 'wordpress' || p === 'shopify' || p === 'webflow') return p
  return null
}

export function ConnectSiteModal({
  siteId,
  domain,
  universalTagToken,
  currentCmsType,
  onClose,
  onConnected,
}: {
  siteId: string
  domain: string
  universalTagToken?: string | null
  /** Existing connection — modal opens ready to switch platforms. */
  currentCmsType?: string | null
  onClose: () => void
  onConnected: () => void
}) {
  const [detecting, setDetecting] = useState(true)
  const [detected, setDetected] = useState<DetectedPlatform>('unknown')
  const [platform, setPlatform] = useState<ConnectPlatform | null>(
    currentCmsType && PLATFORM_ORDER.includes(currentCmsType as ConnectPlatform)
      ? (currentCmsType as ConnectPlatform)
      : null,
  )
  const [values, setValues] = useState<Record<string, string>>({})
  const [connecting, setConnecting] = useState(false)
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/ranko/detect-cms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return
        const d = (data.platform || 'unknown') as DetectedPlatform
        setDetected(d)
        setDetecting(false)
        // Only auto-select detection when the user has no existing connection.
        setPlatform((prev) => {
          if (prev) return prev
          if (currentCmsType && PLATFORM_ORDER.includes(currentCmsType as ConnectPlatform)) {
            return currentCmsType as ConnectPlatform
          }
          return detectedToConnect(d)
        })
      })
      .catch(() => {
        if (!cancelled) {
          setDetected('unknown')
          setDetecting(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [domain, currentCmsType])

  async function handleConnect(target: ConnectPlatform) {
    setConnecting(true)
    setResult(null)
    try {
      const res = await fetch('/api/ranko/connect-site', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId, domain, platform: target, credentials: values }),
      })
      const data = await res.json()
      setResult({ success: Boolean(data.success), message: data.message || data.error || 'Connection failed' })
      if (data.success) {
        setValues({})
        onConnected()
        setTimeout(onClose, 1500)
      }
    } catch {
      setResult({ success: false, message: 'Could not reach SEORANKO — try again.' })
    } finally {
      setConnecting(false)
    }
  }

  const snippet = useMemo(() => {
    if (!universalTagToken) return ''
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    return `<script src="${origin}/api/universal-tag/${universalTagToken}" async></script>`
  }, [universalTagToken])

  const shell = (children: React.ReactNode) => (
    <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl p-5 w-full max-w-md max-h-[90vh] overflow-y-auto">{children}</div>
    </div>
  )

  if (detecting) {
    return shell(
      <div className="py-6 text-center text-sm text-gray-500">
        Detecting {domain}&rsquo;s platform…
      </div>,
    )
  }

  const switching = Boolean(currentCmsType)
  const config = platform && platform !== 'universal-tag' ? PLATFORM_FIELDS[platform] : null

  return shell(
    <>
      <h3 className="text-sm font-semibold mb-1">
        {switching ? 'Change connection for' : 'Connect'} {domain}
      </h3>
      {switching && (
        <p className="text-xs text-amber-800 bg-amber-50 rounded px-2 py-1.5 mb-3">
          Currently connected via <strong>{PLATFORM_META[currentCmsType as ConnectPlatform]?.label || currentCmsType}</strong>.
          Pick a different connector below to replace it (credentials are re-verified before saving).
        </p>
      )}
      {detected !== 'unknown' && (
        <p className="text-xs text-gray-500 mb-2">
          Auto-detected: <strong>{PLATFORM_META[detected]?.label || detected}</strong> — you can still choose GitHub or another method.
        </p>
      )}
      {detected === 'unknown' && !switching && (
        <p className="text-xs text-gray-500 mb-2">
          No WordPress/Shopify/Webflow fingerprint found. For Vercel/Next/Vite sites, choose <strong>GitHub</strong> so Fix Agent can commit real fixes.
        </p>
      )}

      <p className="text-xs font-medium text-gray-700 mb-2">Connection type</p>
      <div className="grid grid-cols-2 gap-2 mb-4">
        {PLATFORM_ORDER.map((p) => {
          const meta = PLATFORM_META[p]
          const selected = platform === p
          const isCurrent = currentCmsType === p
          return (
            <button
              key={p}
              type="button"
              onClick={() => {
                setPlatform(p)
                setValues({})
                setResult(null)
              }}
              className={`text-left rounded-lg border px-3 py-2 transition-colors ${
                selected
                  ? 'border-orange-500 bg-orange-50 text-gray-900'
                  : 'border-gray-200 text-gray-700 hover:border-gray-300'
              }`}
            >
              <div className="text-xs font-semibold">
                {meta.short}
                {isCurrent ? ' · current' : ''}
              </div>
              <div className="text-[11px] text-gray-500 mt-0.5 leading-snug">{meta.blurb}</div>
            </button>
          )
        })}
      </div>

      {!platform && (
        <p className="text-xs text-gray-500 mb-3">Select a connection type to continue.</p>
      )}

      {platform === 'universal-tag' && (
        <>
          <p className="text-xs text-gray-500 mb-3">{PLATFORM_META['universal-tag'].blurb}</p>
          {snippet ? (
            <div className="bg-gray-900 text-gray-100 rounded-lg p-3 pr-10 font-mono text-xs relative break-all mb-3">
              {snippet}
              <button
                onClick={() => {
                  navigator.clipboard.writeText(snippet)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 2000)
                }}
                className="absolute top-2 right-2 text-gray-400 hover:text-white"
                aria-label="Copy snippet"
              >
                {copied ? <IconCheck className="w-4 h-4 text-green-400" /> : <IconCopy className="w-4 h-4" />}
              </button>
            </div>
          ) : (
            <p className="text-xs text-red-600 mb-3">Could not load this site&rsquo;s tag token — try reopening this dialog.</p>
          )}
        </>
      )}

      {config && platform && (
        <>
          <p className="text-xs text-gray-500 mb-3">{config.help}</p>
          {config.fields.map((f) => (
            <div key={f.key} className="mb-2">
              <label className="text-xs text-gray-500 mb-1 block">{f.label}</label>
              <input
                type={f.secret ? 'password' : 'text'}
                placeholder={f.placeholder}
                value={values[f.key] || ''}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                autoComplete="off"
                className={`w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-orange-400 ${f.secret ? 'font-mono' : ''}`}
              />
            </div>
          ))}
          {config.footnote && <p className="text-xs text-gray-400 mt-1 mb-2">{config.footnote}</p>}
        </>
      )}

      {result && (
        <p className={`text-xs my-2 ${result.success ? 'text-green-600' : 'text-red-600'}`}>{result.message}</p>
      )}

      <div className="flex gap-2 mt-3">
        <button
          onClick={() => platform && void handleConnect(platform)}
          disabled={
            connecting ||
            !platform ||
            (platform === 'universal-tag'
              ? !snippet
              : !config?.fields.every((f) => f.optional || values[f.key]?.trim()))
          }
          className="flex-1 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
        >
          {connecting
            ? 'Verifying…'
            : platform === 'universal-tag'
              ? "I've pasted it — enable tag"
              : switching
                ? `Switch to ${PLATFORM_META[platform!]?.label || 'connector'}`
                : `Connect ${PLATFORM_META[platform!]?.label || ''}`}
        </button>
        <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">
          Cancel
        </button>
      </div>
    </>,
  )
}
