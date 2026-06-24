/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient } from '@supabase/supabase-js';
import { normalizeDomain, normalizeUrl } from './audit-db';

function getClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } }
  );
}

export interface SeoFix {
  id?: string;
  site_id: string;
  page_url: string;
  fix_type: 'meta_title' | 'meta_description' | 'h1' | 'og_image' | 'og_title' | 'schema' | 'alt_text' | 'canonical';
  selector?: string;
  old_value?: string;
  new_value: string;
  enabled?: boolean;
  created_at?: string;
}

export function siteIdFromDomain(domain: string): string {
  return normalizeDomain(domain);
}

export async function upsertFix(fix: SeoFix): Promise<{ id: string } | null> {
  const supabase = getClient();
  const row = {
    ...fix,
    site_id: normalizeDomain(fix.site_id),
    page_url: normalizeUrl(fix.page_url),
    enabled: fix.enabled ?? true,
  };

  // Upsert by site_id + page_url + fix_type (one fix per type per page)
  const { data, error } = await supabase
    .from('seo_fixes')
    .upsert(row, { onConflict: 'site_id,page_url,fix_type', ignoreDuplicates: false })
    .select('id')
    .single();

  if (error) {
    console.error('[fixes-db] upsertFix error:', error.message);
    return null;
  }
  return data;
}

export async function getFixesForPage(siteId: string, pageUrl: string): Promise<SeoFix[]> {
  const supabase = getClient();
  const { data, error } = await supabase
    .from('seo_fixes')
    .select('*')
    .eq('site_id', normalizeDomain(siteId))
    .eq('page_url', normalizeUrl(pageUrl))
    .eq('enabled', true)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[fixes-db] getFixesForPage error:', error.message);
    return [];
  }
  return data ?? [];
}

export async function getFixesForSite(siteId: string): Promise<SeoFix[]> {
  const supabase = getClient();
  const { data, error } = await supabase
    .from('seo_fixes')
    .select('*')
    .eq('site_id', normalizeDomain(siteId))
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[fixes-db] getFixesForSite error:', error.message);
    return [];
  }
  return data ?? [];
}

export async function toggleFix(id: string, enabled: boolean): Promise<void> {
  const supabase = getClient();
  const { error } = await supabase
    .from('seo_fixes')
    .update({ enabled })
    .eq('id', id);
  if (error) console.error('[fixes-db] toggleFix error:', error.message);
}

export async function deleteFix(id: string): Promise<void> {
  const supabase = getClient();
  const { error } = await supabase
    .from('seo_fixes')
    .delete()
    .eq('id', id);
  if (error) console.error('[fixes-db] deleteFix error:', error.message);
}

// Map an audit issue message to a fix_type and new_value
export function issueToFix(
  issue: { message: string; fix?: string },
  pageSignals: { title?: string; h1?: string; metaDescription?: string }
): Pick<SeoFix, 'fix_type' | 'new_value' | 'old_value'> | null {
  const msg = issue.message || '';
  const fix = issue.fix || '';

  if (msg.startsWith('Missing title tag') || msg.startsWith('Title too')) {
    return { fix_type: 'meta_title', old_value: pageSignals.title || '', new_value: fix || 'Untitled Page' };
  }
  if (msg.startsWith('Missing meta description') || msg.startsWith('Meta description too')) {
    return { fix_type: 'meta_description', old_value: pageSignals.metaDescription || '', new_value: fix || '' };
  }
  if (msg.startsWith('Missing H1') || msg.startsWith('Multiple H1')) {
    return { fix_type: 'h1', old_value: pageSignals.h1 || '', new_value: fix || '' };
  }
  if (msg.startsWith('Missing Open Graph')) {
    return { fix_type: 'og_title', old_value: '', new_value: pageSignals.title || fix || '' };
  }
  if (msg.startsWith('No canonical')) {
    return { fix_type: 'canonical', old_value: '', new_value: fix || '' };
  }
  return null;
}
