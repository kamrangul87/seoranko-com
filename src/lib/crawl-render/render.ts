/**
 * Headless render for crawl guard — @sparticuz/chromium + puppeteer-core.
 * Soft-fails to render_failed when chromium cannot launch or the per-page
 * hard timeout fires. A hung render must never block the crawl tick.
 *
 * On first failure: retry once with a longer timeout (15s) and the same
 * third-party script/font/ad blockers so analytics cannot stall the DOM.
 */

import type { Browser, HTTPRequest, Page } from 'puppeteer-core'
import { FIX_STRATEGY_PRODUCT_DECISIONS } from '@/lib/fix-strategies/product-decisions'
import { isSafePublicUrl } from '@/lib/fetch-page-content'

export type RenderPageResult =
  | { ok: true; html: string; tookMs: number }
  | { ok: false; error: string; tookMs: number }

let browserPromise: Promise<Browser> | null = null

/** Host suffixes / substrings that stall SPA render without affecting first-party hydration. */
const THIRD_PARTY_BLOCK_PATTERNS: RegExp[] = [
  /google-analytics\.com/i,
  /googletagmanager\.com/i,
  /googleadservices\.com/i,
  /doubleclick\.net/i,
  /facebook\.net/i,
  /facebook\.com\/tr/i,
  /connect\.facebook\.net/i,
  /hotjar\.com/i,
  /clarity\.ms/i,
  /segment\.com/i,
  /segment\.io/i,
  /mixpanel\.com/i,
  /amplitude\.com/i,
  /fullstory\.com/i,
  /sentry\.io/i,
  /cdn\.segment/i,
  /fonts\.googleapis\.com/i,
  /fonts\.gstatic\.com/i,
  /use\.typekit\.net/i,
  /advertising/i,
  /adservice\./i,
  /pagead2\.googlesyndication\.com/i,
  /googlesyndication\.com/i,
]

function isThirdPartyNoise(requestUrl: string, pageUrl: string): boolean {
  let reqHost = ''
  let pageHost = ''
  try {
    reqHost = new URL(requestUrl).hostname.toLowerCase()
    pageHost = new URL(pageUrl).hostname.toLowerCase()
  } catch {
    return false
  }
  if (!reqHost) return false
  // Same registrable host (incl. www) — allow first-party bundles.
  const stripWww = (h: string) => h.replace(/^www\./, '')
  if (stripWww(reqHost) === stripWww(pageHost)) return false
  return THIRD_PARTY_BLOCK_PATTERNS.some((re) => re.test(requestUrl))
}

async function installRequestBlocks(page: Page, pageUrl: string): Promise<void> {
  await page.setRequestInterception(true)
  page.on('request', (req: HTTPRequest) => {
    const type = req.resourceType()
    const url = req.url()
    if (type === 'font' || type === 'media' || type === 'websocket') {
      void req.abort().catch(() => undefined)
      return
    }
    if (type === 'image' && isThirdPartyNoise(url, pageUrl)) {
      void req.abort().catch(() => undefined)
      return
    }
    if (
      (type === 'script' || type === 'stylesheet' || type === 'xhr' || type === 'fetch') &&
      isThirdPartyNoise(url, pageUrl)
    ) {
      void req.abort().catch(() => undefined)
      return
    }
    void req.continue().catch(() => undefined)
  })
}

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = (async () => {
      const puppeteer = await import('puppeteer-core')
      const { mkdtemp } = await import('node:fs/promises')
      const { tmpdir } = await import('node:os')
      const { join } = await import('node:path')
      const userDataDir = await mkdtemp(join(tmpdir(), 'seoranko-render-'))
      const isServerless =
        Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME) ||
        Boolean(process.env.VERCEL) ||
        process.env.CRAWL_RENDER_USE_SPARTICUZ === '1'

      if (isServerless) {
        const chromium = await import('@sparticuz/chromium')
        return puppeteer.default.launch({
          args: [...chromium.default.args, `--user-data-dir=${userDataDir}`],
          defaultViewport: { width: 1280, height: 720 },
          executablePath: await chromium.default.executablePath(),
          headless: true,
          userDataDir,
        })
      }

      const candidates = [
        process.env.CHROME_PATH,
        process.env.PUPPETEER_EXECUTABLE_PATH,
        '/usr/local/bin/google-chrome',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
      ].filter(Boolean) as string[]

      let lastErr: unknown
      for (const executablePath of candidates) {
        try {
          return await puppeteer.default.launch({
            executablePath,
            headless: true,
            args: [
              '--no-sandbox',
              '--disable-gpu',
              '--disable-dev-shm-usage',
              `--user-data-dir=${userDataDir}`,
            ],
            defaultViewport: { width: 1280, height: 720 },
            userDataDir,
          })
        } catch (e) {
          lastErr = e
        }
      }
      throw lastErr ?? new Error('No Chrome/Chromium executable found for crawl render')
    })().catch((err) => {
      browserPromise = null
      throw err
    })
  }
  return browserPromise
}

/** Close shared browser (tests). */
export async function closeCrawlRenderBrowser(): Promise<void> {
  if (!browserPromise) return
  try {
    const b = await browserPromise
    await b.close()
  } catch {
    /* ignore */
  } finally {
    browserPromise = null
  }
}

async function renderOnce(url: string, timeoutMs: number): Promise<RenderPageResult> {
  const started = Date.now()
  let page: Page | null = null
  try {
    const browser = await getBrowser()
    page = await browser.newPage()
    page.setDefaultNavigationTimeout(timeoutMs)
    await page.setUserAgent(
      'Mozilla/5.0 (compatible; SEORANKO-Render/1.0; +https://www.seoranko.com)',
    )
    await installRequestBlocks(page, url)
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs })
    // Brief settle for client routers; keep well under remaining timeout.
    await new Promise((r) => setTimeout(r, 250))
    const html = await page.content()
    return { ok: true, html, tookMs: Date.now() - started }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      error: message.slice(0, 300),
      tookMs: Date.now() - started,
    }
  } finally {
    if (page) {
      try {
        await page.close()
      } catch {
        /* ignore */
      }
    }
  }
}

async function raceRender(
  url: string,
  timeoutMs: number,
): Promise<RenderPageResult> {
  const started = Date.now()
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      renderOnce(url, timeoutMs),
      new Promise<RenderPageResult>((resolve) => {
        timer = setTimeout(() => {
          resolve({
            ok: false,
            error: `render_timeout_${timeoutMs}ms`,
            tookMs: Date.now() - started,
          })
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Render one URL with a hard wall-clock timeout. On first failure, retries
 * once with crawlRenderRetryTimeoutMs. Callers must continue the tick on fail.
 */
export async function renderPageHtml(url: string): Promise<RenderPageResult> {
  const started = Date.now()
  if (!isSafePublicUrl(url)) {
    return { ok: false, error: 'blocked_unsafe_url', tookMs: Date.now() - started }
  }
  if (process.env.CRAWL_RENDER_DISABLED === '1') {
    return { ok: false, error: 'render_disabled', tookMs: Date.now() - started }
  }

  const firstTimeout = FIX_STRATEGY_PRODUCT_DECISIONS.crawlRenderTimeoutMs
  const retryTimeout = FIX_STRATEGY_PRODUCT_DECISIONS.crawlRenderRetryTimeoutMs

  try {
    const first = await raceRender(url, firstTimeout)
    if (first.ok) return first

    const retry = await raceRender(url, retryTimeout)
    if (retry.ok) {
      return { ...retry, tookMs: Date.now() - started }
    }
    return {
      ok: false,
      error: retry.error || first.error,
      tookMs: Date.now() - started,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      error: message.slice(0, 300),
      tookMs: Date.now() - started,
    }
  }
}
