// src/lib/site-adapters/wordpress-adapter.ts
// Wraps the existing wordpress-connector into the common adapter interface.
//
// PageContent.id encodes `${type}:${id}` (e.g. "posts:12") because WordPress
// needs to know whether to hit /wp/v2/posts or /wp/v2/pages, and bodyHtml is
// always the RAW post_content — never the rendered output.

import { CMSAdapter, SiteCredentials, PageContent, FixApplyResult } from './types'
import * as wp from '../wordpress-connector'

function toConn(creds: SiteCredentials): wp.WPConnection {
  return {
    siteUrl: creds.siteUrl,
    username: creds.username || '',
    appPassword: creds.appPassword || ''
  }
}

function toWpPost(page: PageContent): wp.WPPost {
  const [type, id] = page.id.split(':')
  return {
    id: Number(id),
    title: page.title,
    content: page.bodyHtml,
    link: page.url,
    status: 'publish',
    type: (type === 'pages' ? 'pages' : 'posts')
  }
}

export const wordpressAdapter: CMSAdapter = {
  platform: 'wordpress',
  serverVerifiable: true,

  async verifyConnection(creds) {
    const result = await wp.verifyConnection(toConn(creds))
    return { success: result.success, detail: result.wpVersion, error: result.error }
  },

  async findPageContent(creds, url) {
    const post = await wp.findPostByUrl(toConn(creds), url)
    if (!post) return null
    return {
      id: `${post.type}:${post.id}`,
      url: post.link,
      title: post.title,
      bodyHtml: post.content,
      hasSchema: post.content.includes('application/ld+json')
    }
  },

  async injectSchema(creds, page, schemaJsonLd): Promise<FixApplyResult> {
    return wp.injectSchemaIntoPost(toConn(creds), toWpPost(page), schemaJsonLd)
  },

  async appendContent(creds, page, html, position): Promise<FixApplyResult> {
    return wp.appendContentFix(toConn(creds), toWpPost(page), html, position)
  }
}
