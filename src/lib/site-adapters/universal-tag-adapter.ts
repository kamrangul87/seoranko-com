/* eslint-disable @typescript-eslint/no-explicit-any */
// src/lib/site-adapters/universal-tag-adapter.ts
// Fallback for any platform without a write API — Wix, Squarespace, Framer,
// custom builds. The user pastes one script tag into <head>; fixes are queued
// here and injected into the DOM on page load.
//
// Honest tradeoff: this is JS-injected, not server-rendered. Googlebot executes
// JS and this is the same pattern GTM uses for schema, but a server-side
// re-fetch will never see it — hence serverVerifiable: false, so the fix flow
// reports "queued" rather than falsely claiming verification failed.

import { CMSAdapter, FixApplyResult } from './types'

export function createUniversalTagAdapter(supabase: any): CMSAdapter {
  return {
    platform: 'universal-tag',
    serverVerifiable: false,

    async verifyConnection() {
      // We cannot confirm the tag is installed from here — say so plainly
      // rather than reporting a connection we haven't proven.
      return {
        success: true,
        detail: 'Universal Tag ready — paste the script into your site\'s <head>. Fixes apply once it is live.'
      }
    },

    async findPageContent(creds, url) {
      // Nothing to read: fixes are pushed to this URL, not parsed from it.
      return { id: url, url, title: '', bodyHtml: '', hasSchema: false }
    },

    async injectSchema(creds, page, schemaJsonLd): Promise<FixApplyResult> {
      if (!creds.siteId) {
        return { success: false, error: 'Missing site reference for the Universal Tag.' }
      }

      const targetUrl = page.url.replace(/[?#].*$/, '').replace(/\/+$/, '')
      const type = String(schemaJsonLd['@type'] || '')

      // Idempotent — don't queue a second block of the same type for this URL.
      const { data: existing } = await supabase
        .from('universal_tag_fixes')
        .select('id, payload')
        .eq('site_id', creds.siteId)
        .eq('target_url', targetUrl)
        .eq('is_active', true)

      if ((existing || []).some((f: any) => String(f.payload?.['@type'] || '') === type)) {
        return { success: true, skipped: true }
      }

      const { error } = await supabase.from('universal_tag_fixes').insert({
        site_id: creds.siteId,
        target_url: targetUrl,
        fix_type: 'schema',
        payload: schemaJsonLd
      })

      return error ? { success: false, error: error.message } : { success: true }
    },

    async appendContent(): Promise<FixApplyResult> {
      return {
        success: false,
        error: 'The Universal Tag supports schema injection only. Visible content edits need a platform with a write API (WordPress, Shopify or Webflow).'
      }
    }
  }
}
