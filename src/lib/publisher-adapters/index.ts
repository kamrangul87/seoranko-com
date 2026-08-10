// src/lib/publisher-adapters/index.ts
// Mirrors the existing site-adapters/index.ts factory pattern exactly.

import type { Platform, PublisherAdapter } from './types'
import { githubPublisher } from './github-publisher'
import { wordpressPublisher } from './wordpress-publisher'
import { shopifyPublisher } from './shopify-publisher'
import { webflowPublisher } from './webflow-publisher'
import { universalTagPublisher } from './universal-tag-publisher'

export function getPublisherAdapter(platform: string): PublisherAdapter {
  switch (platform as Platform) {
    case 'github': return githubPublisher
    case 'wordpress': return wordpressPublisher
    case 'shopify': return shopifyPublisher
    case 'webflow': return webflowPublisher
    case 'universal-tag': return universalTagPublisher
    default: return universalTagPublisher
  }
}

export * from './types'
export { transitionLiveness, appendLivenessHistory } from './liveness-state-machine'
export type { LivenessEvent, LivenessTransitionResult, LivenessHistoryEntry } from './liveness-state-machine'
