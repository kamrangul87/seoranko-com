// src/lib/publisher-adapters/universal-tag-publisher.ts
// Universal Tag (site-adapters/universal-tag-adapter.ts) has no server-side
// write path at all — it's a Supabase-only fix queue consumed by a
// client-side script already embedded on a page the user already has live.
// That model can patch an existing page's DOM on load; it fundamentally
// cannot originate a brand-new page nobody has requested yet, since there's
// no request for the tag to intercept until the page already exists. This
// stub says so plainly rather than pretending to support a publish flow
// this platform's architecture can't do.

import type { PublisherAdapter, PublishResult, LivenessCheckResult } from './types'

export const universalTagPublisher: PublisherAdapter = {
  platform: 'universal-tag',

  async publish(): Promise<PublishResult> {
    return {
      platform: 'universal-tag',
      platformPostId: null,
      liveUrl: null,
      status: 'FAILED',
      isLiveImmediately: false,
      requiresSeparateVerification: true,
      error: 'Universal Tag cannot publish a new article — it only patches pages that already exist and are already receiving traffic with the tag installed. Connect a platform-specific adapter (WordPress/Shopify/Webflow/GitHub) to publish new content, or publish this article on the platform directly and use Universal Tag for post-publish schema/byline fixes instead.',
    }
  },

  async checkLiveness(): Promise<LivenessCheckResult> {
    return { state: 'FAILED', detail: 'Universal Tag has no publish-liveness concept — see publish().' }
  },
}
