/**
 * Headless render for crawl guard — @sparticuz/chromium + puppeteer-core.
 * Soft-fails to render_failed when chromium cannot launch (local/CI without
 * binary, or Vercel budget exceeded).
 */

import type { Browser } from 'puppeteer-core'
import { FIX_STRATEGY_PRODUCT_DECISIONS } from '@/lib/fix-strategies/product-decisions'
import { isSafePublicUrl } from '@/lib/fetch-page-content'

export type RenderPageResult =
  | { ok: true; html: string; tookMs: number }
  | { ok: false; error: string; tookMs: number }

let browserPromise: Promise<Browser> | null = null

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

      // Local / cloud-agent: prefer system chrome when present.
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

export async function renderPageHtml(url: string): Promise<RenderPageResult> {
  const started = Date.now()
  if (!isSafePublicUrl(url)) {
    return { ok: false, error: 'blocked_unsafe_url', tookMs: Date.now() - started }
  }
  if (process.env.CRAWL_RENDER_DISABLED === '1') {
    return { ok: false, error: 'render_disabled', tookMs: Date.now() - started }
  }

  const timeoutMs = FIX_STRATEGY_PRODUCT_DECISIONS.crawlRenderTimeoutMs
  let page: Awaited<ReturnType<Browser['newPage']>> | null = null
  try {
    const browser = await getBrowser()
    page = await browser.newPage()
    page.setDefaultNavigationTimeout(timeoutMs)
    await page.setUserAgent(
      'Mozilla/5.0 (compatible; SEORANKO-Render/1.0; +https://www.seoranko.com)',
    )
    await page.goto(url, { waitUntil: 'networkidle2', timeout: timeoutMs })
    // Small settle for client routers that paint after network idle.
    await new Promise((r) => setTimeout(r, 400))
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
