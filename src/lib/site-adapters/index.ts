/* eslint-disable @typescript-eslint/no-explicit-any */
// src/lib/site-adapters/index.ts

import { CMSAdapter } from './types'
import { wordpressAdapter } from './wordpress-adapter'
import { shopifyAdapter } from './shopify-adapter'
import { webflowAdapter } from './webflow-adapter'
import { githubAdapter } from './github-adapter'
import { createUniversalTagAdapter } from './universal-tag-adapter'

export { detectCMS } from './detect-cms'
export type { DetectedCMS } from './detect-cms'
export type { CMSAdapter, SiteCredentials, PageContent, FixApplyResult } from './types'

export const SUPPORTED_PLATFORMS = ['wordpress', 'shopify', 'webflow', 'github', 'universal-tag'] as const

export function getAdapter(platform: string, supabase: any): CMSAdapter {
  switch (platform) {
    case 'wordpress': return wordpressAdapter
    case 'shopify':   return shopifyAdapter
    case 'webflow':   return webflowAdapter
    case 'github':    return githubAdapter
    default:          return createUniversalTagAdapter(supabase)
  }
}
