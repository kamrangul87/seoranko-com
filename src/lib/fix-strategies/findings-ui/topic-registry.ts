/**
 * Topic id → dossier slug for source lookup.
 * Derived from dossier "Topic: N" frontmatter — static map for shipped topics.
 */

export const TOPIC_DOSSIER_SLUG: Record<string, string> = {
  '1': 'broken-internal-link__target_returns_4xx',
  '2b': 'soft-404__200_no_real_content',
  '3': 'status__5xx_responses',
  '4': 'redirect__chains',
  '5': 'redirect__loops_and_self_redirects',
  '6': 'redirect__302_where_301_correct',
  '7': 'redirect__target_not_200',
  '8': 'duplicate-url__trailing_slash',
  '9': 'duplicate-url__http_vs_https',
  '10': 'duplicate-url__www_vs_non_www',
  '11': 'duplicate-url__uppercase_vs_lowercase',
  '12': 'duplicate-url__query_parameter_variants',
  '13': 'canonical__tag_absent',
  '14': 'canonical__points_to_non_200',
  '15': 'canonical__points_to_noindexed',
  '16': 'canonical__html_and_http_link_disagree',
  '17': 'canonical__multiple_tags',
  '19': 'indexability__noindex_on_should_be_indexed',
  '20': 'indexability__meta_robots_x_robots_disagree',
  '21': 'robots__blocking_css_js',
  '22': 'robots__syntax_invalid_or_unreachable',
  '24': 'sitemap__missing_or_unreachable',
  '25': 'sitemap__xml_invalid',
  '26': 'sitemap__urls_return_4xx',
  '27': 'sitemap__indexable_urls_absent',
  '28': 'sitemap__not_referenced_in_robots',
  '29': 'head__tags_outside_head',
  '30': 'head__missing_or_malformed_title',
  '31': 'head__missing_meta_description',
  '33': 'head__duplicate_titles_descriptions',
  '34': 'head__missing_or_wrong_lang',
  '35': 'structured-data__required_properties_absent',
  '36': 'structured-data__urls_dont_resolve',
  '37': 'structured-data__invalid_or_mismatched_type',
  '38': 'structured-data__contradicts_visible_page',
  '39': 'structured-data__deprecated_types',
  '42': 'internal-links__pointing_at_redirects',
  '43': 'internal-links__orphan_pages',
  '45': 'internal-links__excessive_crawl_depth',
  '46': 'hreflang__missing_return_links',
  '47': 'hreflang__invalid_language_region_codes',
  '48': 'hreflang__non_200_or_noindexed',
  '49': 'performance__images_missing_width_height',
}

export function dossierSlugForTopic(topicId: string): string | null {
  return TOPIC_DOSSIER_SLUG[topicId] ?? null
}
