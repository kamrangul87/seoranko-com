// Derives a stable machine key for a site-audit AuditIssue.
//
// scorer.ts's AuditIssue only ever carried a free-text `message`, many of
// which embed a dynamic value (a count, a byte size, a percentage) at the
// very start — e.g. "42 images missing alt text" or "Only 3 H2 headings".
// A stable key is required for seo_issue's NEW/FIXED lifecycle: without one,
// an issue can never be recognised as "the same issue" across two audits.
//
// This is a superset of the older, partial ISSUE_KEY_MAP in
// src/app/api/site-audit/route.ts (kept there for the legacy fixedIssues
// UI list; not replaced here to avoid touching working code). Every
// AuditIssue this repo's scorer can currently emit is covered by an exact
// rule below; the fallback exists so a future scorer.ts change never
// silently produces an unkeyed (untrackable) issue.

interface IssueLike {
  category: string
  message: string
}

type Rule = { category?: string; test: (msg: string) => boolean; key: string }

const RULES: Rule[] = [
  // crawlability
  { category: 'crawlability', test: m => m.startsWith('Noindex meta tag'), key: 'noindex' },
  { category: 'crawlability', test: m => m.startsWith('X-Robots-Tag: noindex'), key: 'x_robots_noindex' },
  { category: 'crawlability', test: m => m.startsWith('Served over HTTP'), key: 'not_https' },
  { category: 'crawlability', test: m => m.startsWith('No canonical tag'), key: 'no_canonical' },
  { category: 'crawlability', test: m => m.startsWith('Canonical points off-site'), key: 'canonical_offsite' },
  { category: 'crawlability', test: m => m.startsWith('Page not found (404)'), key: 'page_not_found' },
  { category: 'crawlability', test: m => m.startsWith('Page cannot be accessed:'), key: 'page_fetch_error' },

  // onpage
  { category: 'onpage', test: m => m.startsWith('Missing title tag'), key: 'missing_title' },
  { category: 'onpage', test: m => m.startsWith('Title too short'), key: 'title_too_short' },
  { category: 'onpage', test: m => m.startsWith('Title too long'), key: 'title_too_long' },
  { category: 'onpage', test: m => m.startsWith('Missing meta description'), key: 'missing_meta_description' },
  { category: 'onpage', test: m => m.startsWith('Meta description too short'), key: 'meta_description_too_short' },
  { category: 'onpage', test: m => m.startsWith('Meta description too long'), key: 'meta_description_too_long' },
  { category: 'onpage', test: m => m.startsWith('Missing H1'), key: 'missing_h1' },
  { category: 'onpage', test: m => m.startsWith('Multiple H1 tags'), key: 'multiple_h1' },
  { category: 'onpage', test: m => m.startsWith('No H2 headings'), key: 'no_h2_headings' },
  { category: 'onpage', test: m => m.includes('H2 heading'), key: 'few_h2_headings' },
  { category: 'onpage', test: m => m.includes('missing alt text'), key: 'images_missing_alt' },
  { category: 'onpage', test: m => m.startsWith('Duplicate title'), key: 'duplicate_title' },
  { category: 'onpage', test: m => m.startsWith('Duplicate meta description'), key: 'duplicate_meta_description' },

  // content
  { category: 'content', test: m => m.startsWith('Thin content:') || m.startsWith('Low word count:'), key: 'thin_content' },
  { category: 'content', test: m => m.includes('top-ranking pages'), key: 'below_competitive_word_count' },
  { category: 'content', test: m => m.startsWith('No official source citations'), key: 'no_official_sources' },
  { category: 'content', test: m => m.startsWith('No images'), key: 'no_images' },

  // schema
  { category: 'schema', test: m => m.startsWith('No structured data'), key: 'no_schema' },
  { category: 'schema', test: m => m.startsWith('No BreadcrumbList schema'), key: 'no_breadcrumb_schema' },

  // security
  { category: 'security', test: m => m.startsWith('No HSTS header'), key: 'no_hsts' },
  { category: 'security', test: m => m.startsWith('No X-Frame-Options'), key: 'no_x_frame_options' },
  { category: 'security', test: m => m.startsWith('Missing X-Content-Type-Options'), key: 'no_x_content_type_options' },
  { category: 'security', test: m => m.startsWith('No Content-Security-Policy'), key: 'no_csp' },

  // speed
  { category: 'speed', test: m => m.includes('Very slow TTFB'), key: 'very_slow_ttfb' },
  { category: 'speed', test: m => m.includes('Slow server response'), key: 'slow_ttfb' },
  { category: 'speed', test: m => m.includes('Extremely large page'), key: 'page_too_large' },
  { category: 'speed', test: m => m.includes('Large page size'), key: 'page_large' },
  { category: 'speed', test: m => m.includes('render-blocking script'), key: 'render_blocking_scripts' },
  { category: 'speed', test: m => m.includes('not lazy loaded'), key: 'images_not_lazy' },
  { category: 'speed', test: m => m.startsWith('No viewport meta tag'), key: 'no_viewport' },
  { category: 'speed', test: m => m.startsWith('No GZIP/Brotli compression'), key: 'no_compression' },

  // links
  { category: 'links', test: m => m.startsWith('No internal links'), key: 'no_internal_links' },
  { category: 'links', test: m => m.includes('internal link'), key: 'few_internal_links' },
  { category: 'links', test: m => m.startsWith('No outbound links'), key: 'no_outbound_links' },
  { category: 'links', test: m => m.includes('generic anchor text'), key: 'poor_anchor_text' },

  // mobile
  { category: 'mobile', test: m => m.includes('missing width/height'), key: 'images_missing_dimensions' },
  { category: 'mobile', test: m => m.startsWith('No og:image'), key: 'no_og_image' },
  { category: 'mobile', test: m => m.startsWith('Open Graph tags missing'), key: 'missing_og_tags' },
  { category: 'mobile', test: m => m.startsWith('No Twitter Card'), key: 'no_twitter_card' },
  { category: 'mobile', test: m => m.startsWith('No lang attribute'), key: 'no_lang_attribute' },

  // depth
  { category: 'depth', test: m => m.includes('Long sentences'), key: 'long_sentences' },
  { category: 'depth', test: m => m.startsWith('Broken heading hierarchy'), key: 'broken_heading_hierarchy' },
  { category: 'depth', test: m => m.startsWith('Very little paragraph structure'), key: 'poor_paragraph_structure' },

  // ai
  { category: 'ai', test: m => m.includes('blocked in robots.txt'), key: 'ai_crawler_blocked' },
  { category: 'ai', test: m => m.startsWith('No llms.txt file'), key: 'no_llms_txt' },
  { category: 'ai', test: m => m.startsWith('Missing Article schema'), key: 'missing_article_schema' },
  { category: 'ai', test: m => m.includes('not updated in') && m.includes('days'), key: 'stale_content_major' },
  { category: 'ai', test: m => m.includes('updated') && m.includes('days ago'), key: 'stale_content_minor' },
  { category: 'ai', test: m => m.startsWith('Article schema missing dateModified'), key: 'missing_date_modified' },
  { category: 'ai', test: m => m.includes('answer-length passage'), key: 'few_answer_passages' },
  { category: 'ai', test: m => m.includes('question heading'), key: 'few_question_headings' },
  { category: 'ai', test: m => m.includes('Low fact density'), key: 'low_fact_density' },
  { category: 'ai', test: m => m.startsWith('No author byline'), key: 'no_author_byline' },
  { category: 'ai', test: m => m.startsWith('Author credited but no bio'), key: 'no_author_bio' },
  { category: 'ai', test: m => m.startsWith('No Person schema'), key: 'no_person_schema' },
  { category: 'ai', test: m => m.includes('Deprecated schema type'), key: 'deprecated_schema' },
  { category: 'ai', test: m => m.startsWith('FAQ content found but no FAQPage'), key: 'missing_faq_schema' },
  { category: 'ai', test: m => m.startsWith('No Q&A heading structure'), key: 'no_qa_structure' },
  { category: 'ai', test: m => m.startsWith('No speakable schema'), key: 'no_speakable_schema' },
  { category: 'ai', test: m => m.startsWith('Missing breadcrumb schema'), key: 'ai_missing_breadcrumb' },
  { category: 'ai', test: m => m.startsWith('How-to page'), key: 'howto_missing_schema' },
  { category: 'ai', test: m => m.startsWith('No first-person experience language'), key: 'no_experience_signals' },
  { category: 'ai', test: m => m.startsWith('No entity presence found'), key: 'no_entity_presence' },
  { category: 'ai', test: m => m.startsWith('Limited entity presence'), key: 'limited_entity_presence' },
  { category: 'ai', test: m => m.startsWith('If any product images are AI-generated'), key: 'ai_image_label_missing' },
]

/** Best-effort fallback for any message this list doesn't cover: strip
 * numbers/quoted substrings so re-runs of the *same* underlying condition
 * still collapse to the same key, then slugify. */
function fallbackKey(issue: IssueLike): string {
  const normalized = issue.message
    .replace(/["“][^"”]*["”]/g, 'Q')
    .replace(/\d+(\.\d+)?/g, '#')
    .toLowerCase()
    .split(/[^a-z#]+/)
    .filter(Boolean)
    .slice(0, 6)
    .join('_')
  return `${issue.category}__${normalized || 'issue'}`
}

export function deriveIssueKey(issue: IssueLike): string {
  for (const rule of RULES) {
    if (rule.category && rule.category !== issue.category) continue
    if (rule.test(issue.message)) return rule.key
  }
  return fallbackKey(issue)
}
