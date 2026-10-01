'use client'
import { useEffect, useState } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'

type Installation = {
  installationId: number
  accountLogin: string
  accountType: string
  repositorySelection: string | null
  suspended: boolean
}

type Status =
  | { configured: false }
  | { configured: true; slug: string; installUrl: string; installations: Installation[] }

const RESULT_COPY: Record<string, { tone: 'success' | 'error'; message: string }> = {
  connected: {
    tone: 'success',
    message: 'GitHub App connected. Findings can now commit via pull request to repos it covers — no token needed.',
  },
  missing_code: { tone: 'error', message: 'GitHub did not send an authorization code — try installing again.' },
  missing_installation: { tone: 'error', message: 'Lost track of which installation this was for — try installing again.' },
  install_not_visible: {
    tone: 'error',
    message: "That installation isn't visible to your GitHub account — install using an account with access to it.",
  },
  oauth_failed: { tone: 'error', message: 'GitHub authorization failed — try installing again.' },
  bad_setup: { tone: 'error', message: 'GitHub sent an invalid setup callback — try installing again.' },
  app_not_configured: { tone: 'error', message: 'The SEORANKO GitHub App is not set up yet — contact support.' },
  auth_config: { tone: 'error', message: 'Could not verify your session — refresh and try again.' },
}

function IconGithub({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.57.1.78-.25.78-.55 0-.27-.01-1.16-.02-2.11-3.2.7-3.88-1.36-3.88-1.36-.52-1.34-1.28-1.69-1.28-1.69-1.04-.72.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.83 1.19 3.09 0 4.43-2.7 5.41-5.26 5.69.41.36.78 1.06.78 2.14 0 1.55-.01 2.79-.01 3.17 0 .3.21.66.79.55A10.52 10.52 0 0 0 23.5 12c0-6.35-5.15-11.5-11.5-11.5Z" />
    </svg>
  )
}

export function GithubAppConnect() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const [status, setStatus] = useState<Status | null>(null)
  const [loading, setLoading] = useState(true)

  const resultCode = searchParams.get('github_app')

  useEffect(() => {
    let cancelled = false
    fetch('/api/github/app/status')
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setStatus(data)
      })
      .catch(() => {
        if (!cancelled) setStatus({ configured: false })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [resultCode])

  function dismissResult() {
    const params = new URLSearchParams(searchParams.toString())
    params.delete('github_app')
    router.replace(params.toString() ? `${pathname}?${params.toString()}` : pathname)
  }

  const result = resultCode ? RESULT_COPY[resultCode] : null

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-gray-900 flex items-center gap-1.5">
            <IconGithub className="w-4 h-4" /> GitHub App
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Install once on your GitHub account or org. Covers every repo you grant it — no token
            to paste or rotate. This is the primary way to connect GitHub; a personal access token
            per-site (below, in Connect site) is the fallback.
          </p>
        </div>
        {!loading && status?.configured && (
          <a
            href={status.installUrl}
            className="flex items-center gap-1.5 text-sm font-medium text-white bg-gray-900 hover:bg-gray-800 px-3 py-1.5 rounded-lg transition-colors flex-shrink-0"
          >
            <IconGithub className="w-4 h-4" />
            Install GitHub App
          </a>
        )}
      </div>

      {result && (
        <div
          className={`text-xs rounded-lg px-3 py-2 flex items-start justify-between gap-3 ${
            result.tone === 'success'
              ? 'bg-green-50 text-green-800 border border-green-200'
              : 'bg-red-50 text-red-800 border border-red-200'
          }`}
        >
          <span>{result.message}</span>
          <button onClick={dismissResult} className="underline flex-shrink-0">
            Dismiss
          </button>
        </div>
      )}

      {!loading && status?.configured === false && (
        <p className="text-xs text-gray-400">GitHub App is not configured for this deployment yet.</p>
      )}

      {!loading && status?.configured && status.installations.length > 0 && (
        <div className="space-y-1.5">
          {status.installations.map((i) => (
            <div
              key={i.installationId}
              className="flex items-center gap-2 text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5"
            >
              <IconGithub className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
              <span className="font-medium">{i.accountLogin}</span>
              <span className="text-gray-400">
                ({i.repositorySelection === 'all' ? 'all repos' : 'selected repos'})
              </span>
              {i.suspended && <span className="text-amber-600">· suspended</span>}
            </div>
          ))}
        </div>
      )}

      {!loading && status?.configured && status.installations.length === 0 && (
        <p className="text-xs text-gray-400">
          No GitHub account linked to your SEORANKO user yet. If the App is already
          installed on GitHub, click Install GitHub App and approve again to link it —
          do not create a second App.
        </p>
      )}
    </div>
  )
}
