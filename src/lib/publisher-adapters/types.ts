// src/lib/publisher-adapters/types.ts
// The PUBLISH-side counterpart to site-adapters/types.ts's CMSAdapter.
// CMSAdapter (RANKO auto-fix) only ever patches a page that already exists —
// every one of its methods starts from findPageContent(url), which requires
// a live URL to resolve to first. Nothing in that interface can originate a
// new post, so it can't be reused as-is for real publishing; this is an
// additive sibling interface, not a replacement.

export type Platform = 'wordpress' | 'shopify' | 'webflow' | 'github' | 'universal-tag'

// Liveness is a state machine, not a boolean — publish succeeding and the
// URL actually being live are different facts. Only Phase B's HTTP
// verification loop (a separate module) is allowed to promote
// LIVE_UNVERIFIED -> LIVE_VERIFIED; nothing in this file does that.
export type LivenessState =
  | 'CREATED'
  | 'PUBLISH_REQUESTED'
  | 'BUILD_PENDING'
  | 'LIVE_UNVERIFIED'
  | 'LIVE_VERIFIED'
  | 'FAILED'

export interface PublisherCredentials {
  siteUrl: string
  /** connected_sites.id — needed by adapters that log back to our own DB. */
  siteId?: string
  [key: string]: string | undefined
}

export interface PublishArticleInput {
  title: string
  bodyHtml: string
  slug: string
  metaDescription?: string
  heroImageUrl?: string
  /** The URL this article's own schema/canonical tag already claims — used
   *  to sanity-check against the URL the platform actually assigns. */
  intendedCanonicalUrl?: string
  keyword?: string
}

export interface PublishResult {
  platform: Platform
  /** Platform-native identifier (WP post ID, Shopify article GID, Webflow
   *  item ID, GitHub file path) — null only on a failure. */
  platformPostId: string | null
  /** Null until the platform tells us, or until Phase B derives it (e.g.
   *  GitHub: we know the intended path/URL immediately, so this is usually
   *  set even though the site itself hasn't rebuilt yet). */
  liveUrl: string | null
  status: LivenessState
  /** True for platforms that serve the new content immediately on write
   *  (WordPress, Shopify, Webflow once /publish is called) — false for
   *  anything that needs a separate build/deploy step (GitHub/headless). */
  isLiveImmediately: boolean
  /** True whenever isLiveImmediately is false, or the platform's own
   *  "success" response has ever been wrong before — i.e. almost always.
   *  Documents that publish() succeeding is never sufficient on its own. */
  requiresSeparateVerification: boolean
  detail?: string
  error?: string
}

// A deliberately thin, platform-side-only signal — "does the platform's own
// API say this post is live" (e.g. WordPress status === 'publish', Shopify
// article not draft). This is NOT the generic "fetch the real URL and check
// its content/canonical" pass — that is Phase B, provider-agnostic, and
// lives in its own module precisely because it must NOT depend on any
// platform-specific API. checkLiveness exists so an adapter can shortcut an
// obviously-still-building state without Phase B needing to poll the public
// URL at all when the platform can just say so directly.
export interface LivenessCheckRef {
  platformPostId: string
  creds: PublisherCredentials
}

export interface LivenessCheckResult {
  state: LivenessState
  detail?: string
}

export interface PublisherAdapter {
  platform: Platform

  publish(article: PublishArticleInput, creds: PublisherCredentials): Promise<PublishResult>

  checkLiveness(ref: LivenessCheckRef): Promise<LivenessCheckResult>
}
