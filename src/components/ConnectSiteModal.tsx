'use client'
import { useState, useEffect } from 'react'

// Inline SVG icons (lucide-react not installed)
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

// What detectCMS reports…
type DetectedPlatform = 'wordpress' | 'shopify' | 'webflow' | 'unknown'
// …vs the adapter name we persist. 'unknown' maps to 'universal-tag'.
type ConnectPlatform = 'wordpress' | 'shopify' | 'webflow' | 'universal-tag'

/** Narrows a detection result to the platforms that take credentials. */
function takesCredentials(p: DetectedPlatform): p is Exclude<DetectedPlatform, 'unknown'> {
  return p !== 'unknown'
}

interface Field { key: string; label: string; placeholder: string; secret?: boolean }

const PLATFORM_FIELDS: Record<string, { label: string; help: React.ReactNode; fields: Field[] }> = {
  wordpress: {
    label: 'WordPress',
    help: (
      <>
        Uses WordPress&rsquo;s built-in Application Passwords — no plugin needed.
        In WP Admin: <strong>Users → Profile → Application Passwords</strong> → create one named &ldquo;SEORANKO&rdquo;.
        The account needs <strong>Editor</strong> or <strong>Administrator</strong> permissions.
      </>
    ),
    fields: [
      { key: 'username', label: 'WordPress username', placeholder: 'admin' },
      { key: 'appPassword', label: 'Application Password', placeholder: 'xxxx xxxx xxxx xxxx xxxx xxxx', secret: true }
    ]
  },
  shopify: {
    label: 'Shopify',
    help: (
      <>
        Create a Custom App in <strong>Shopify Admin → Settings → Apps → Develop apps</strong>,
        then install it and copy the Admin API access token. It needs the
        <strong> read_content</strong> and <strong>write_content</strong> scopes.
      </>
    ),
    fields: [
      { key: 'shopDomain', label: 'Store domain', placeholder: 'your-store.myshopify.com' },
      { key: 'accessToken', label: 'Admin API access token', placeholder: 'shpat_…', secret: true }
    ]
  },
  webflow: {
    label: 'Webflow',
    help: (
      <>
        Generate a token in <strong>Webflow → Site Settings → Apps &amp; Integrations → API Access</strong>.
        It needs CMS read/write and site publish permissions. The Site ID is on the same screen.
      </>
    ),
    fields: [
      { key: 'siteId', label: 'Webflow Site ID', placeholder: '64f…' },
      { key: 'apiToken', label: 'API token', placeholder: 'Bearer token', secret: true }
    ]
  }
}

export function ConnectSiteModal({
  siteId, domain, universalTagToken, onClose, onConnected
}: {
  siteId: string
  domain: string
  universalTagToken?: string | null
  onClose: () => void
  onConnected: () => void
}) {
  const [detecting, setDetecting] = useState(true)
  const [platform, setPlatform] = useState<DetectedPlatform>('unknown')
  const [values, setValues] = useState<Record<string, string>>({})
  const [connecting, setConnecting] = useState(false)
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/ranko/detect-cms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain })
    })
      .then(r => r.json())
      .then(data => {
        if (cancelled) return
        setPlatform(data.platform || 'unknown')
        setDetecting(false)
      })
      .catch(() => { if (!cancelled) { setPlatform('unknown'); setDetecting(false) } })
    return () => { cancelled = true }
  }, [domain])

  async function handleConnect(target: ConnectPlatform) {
    setConnecting(true)
    setResult(null)
    try {
      const res = await fetch('/api/ranko/connect-site', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId, domain, platform: target, credentials: values })
      })
      const data = await res.json()
      setResult({ success: Boolean(data.success), message: data.message || data.error || 'Connection failed' })
      if (data.success) {
        setValues({})          // don't retain credentials in component state
        onConnected()
        setTimeout(onClose, 1500)
      }
    } catch {
      setResult({ success: false, message: 'Could not reach SEORANKO — try again.' })
    } finally {
      setConnecting(false)
    }
  }

  const shell = (children: React.ReactNode) => (
    <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl p-5 w-full max-w-md max-h-[90vh] overflow-y-auto">{children}</div>
    </div>
  )

  if (detecting) {
    return shell(
      <div className="py-6 text-center text-sm text-gray-500">
        Detecting {domain}&rsquo;s platform…
      </div>
    )
  }

  const config = PLATFORM_FIELDS[platform]

  if (config && takesCredentials(platform)) {
    const allFilled = config.fields.every(f => values[f.key]?.trim())
    return shell(
      <>
        <h3 className="text-sm font-semibold mb-1">Connect {domain}</h3>
        <p className="text-xs text-gray-500 mb-1">
          Detected <strong>{config.label}</strong>.
        </p>
        <p className="text-xs text-gray-500 mb-4">{config.help}</p>

        {config.fields.map(f => (
          <div key={f.key} className="mb-2">
            <label className="text-xs text-gray-500 mb-1 block">{f.label}</label>
            <input
              type={f.secret ? 'password' : 'text'}
              placeholder={f.placeholder}
              value={values[f.key] || ''}
              onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}
              autoComplete="off"
              className={`w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-orange-400 ${f.secret ? 'font-mono' : ''}`}
            />
          </div>
        ))}

        {result && (
          <p className={`text-xs my-2 ${result.success ? 'text-green-600' : 'text-red-600'}`}>{result.message}</p>
        )}

        <div className="flex gap-2 mt-3">
          <button
            onClick={() => handleConnect(platform)}
            disabled={connecting || !allFilled}
            className="flex-1 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
          >
            {connecting ? 'Verifying…' : 'Connect'}
          </button>
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">Cancel</button>
        </div>

        <button
          onClick={() => setPlatform('unknown')}
          className="mt-3 text-xs text-gray-400 hover:text-gray-600 underline"
        >
          Not {config.label}? Use the Universal Tag instead
        </button>
      </>
    )
  }

  // Universal Tag fallback — works on anything
  const snippet = universalTagToken
    ? `<script src="${typeof window !== 'undefined' ? window.location.origin : ''}/api/universal-tag/${universalTagToken}" async></script>`
    : ''

  return shell(
    <>
      <h3 className="text-sm font-semibold mb-1">Connect {domain}</h3>
      <p className="text-xs text-gray-500 mb-4">
        We couldn&rsquo;t detect WordPress, Shopify or Webflow — no problem.
        Paste this one line into your site&rsquo;s <code>&lt;head&gt;</code>
        (works on Wix, Squarespace, Framer, or any custom-built site):
      </p>

      {snippet ? (
        <div className="bg-gray-900 text-gray-100 rounded-lg p-3 pr-10 font-mono text-xs relative break-all">
          {snippet}
          <button
            onClick={() => { navigator.clipboard.writeText(snippet); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
            className="absolute top-2 right-2 text-gray-400 hover:text-white"
            aria-label="Copy snippet"
          >
            {copied ? <IconCheck className="w-4 h-4 text-green-400" /> : <IconCopy className="w-4 h-4" />}
          </button>
        </div>
      ) : (
        <p className="text-xs text-red-600">Could not load this site&rsquo;s tag token — try reopening this dialog.</p>
      )}

      <p className="text-xs text-gray-400 mt-3">
        Schema fixes are injected in the browser when the page loads. Googlebot renders
        JavaScript, so this is valid — but it won&rsquo;t appear in a plain
        &ldquo;view source&rdquo;. Verify with Google&rsquo;s Rich Results Test.
      </p>

      {result && (
        <p className={`text-xs mt-2 ${result.success ? 'text-green-600' : 'text-red-600'}`}>{result.message}</p>
      )}

      <div className="flex gap-2 mt-4">
        <button
          onClick={() => handleConnect('universal-tag')}
          disabled={connecting || !snippet}
          className="flex-1 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
        >
          {connecting ? 'Saving…' : 'I\'ve pasted it — enable fixes'}
        </button>
        <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">Cancel</button>
      </div>
    </>
  )
}
