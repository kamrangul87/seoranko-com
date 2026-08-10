// src/lib/publisher-adapters/shopify-publisher.ts
// UNVERIFIED against a live Shopify store — no real Admin API credentials
// were available while building this. Built to the GraphQL Admin API's
// documented shape (articleCreate mutation, API version 2025-10+, since the
// REST Admin API for blog articles is legacy as of October 2024), but exact
// field names on mutations/types can shift between API versions — confirm
// against https://shopify.dev/docs/api/admin-graphql/latest/mutations/articleCreate
// for whatever version is actually live before trusting this with a real
// store. This is the least-verified of the four publishers in this PR.

import type {
  PublisherAdapter, PublisherCredentials, PublishArticleInput, PublishResult,
  LivenessCheckRef, LivenessCheckResult,
} from './types'

const API_VERSION = '2025-10'

function graphqlUrl(creds: PublisherCredentials): string {
  const domain = creds.siteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')
  return `https://${domain}/admin/api/${API_VERSION}/graphql.json`
}

async function shopifyGraphQL<T>(
  creds: PublisherCredentials,
  query: string,
  variables: Record<string, unknown>,
): Promise<{ data?: T; errors?: string }> {
  try {
    const res = await fetch(graphqlUrl(creds), {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': creds.accessToken || '',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(20000),
    })
    const json = await res.json()
    if (!res.ok) return { errors: `Shopify GraphQL HTTP ${res.status}: ${JSON.stringify(json)}` }
    if (json.errors?.length) return { errors: json.errors.map((e: { message: string }) => e.message).join('; ') }
    return { data: json.data as T }
  } catch (err) {
    return { errors: `Shopify request failed: ${err instanceof Error ? err.message : String(err)}` }
  }
}

interface BlogsQuery {
  blogs: { nodes: Array<{ id: string; handle: string }> }
}

async function resolveBlogId(creds: PublisherCredentials): Promise<{ blogId: string; blogHandle: string } | { error: string }> {
  // A pre-configured blogId skips the lookup — articles must belong to a
  // blog, and most stores only have one, but a multi-blog store needs this
  // set explicitly rather than guessed.
  if (creds.blogId && creds.blogHandle) {
    return { blogId: creds.blogId, blogHandle: creds.blogHandle }
  }
  const { data, errors } = await shopifyGraphQL<BlogsQuery>(
    creds,
    `query { blogs(first: 5) { nodes { id handle } } }`,
    {},
  )
  if (errors || !data?.blogs?.nodes?.length) {
    return { error: errors || 'This store has no blogs — create one in Shopify admin before publishing.' }
  }
  const blog = data.blogs.nodes[0]
  return { blogId: blog.id, blogHandle: blog.handle }
}

interface ArticleCreateResponse {
  articleCreate: {
    article: { id: string; handle: string } | null
    userErrors: Array<{ field: string[]; message: string }>
  }
}

const ARTICLE_CREATE_MUTATION = `
mutation ArticleCreate($article: ArticleCreateInput!) {
  articleCreate(article: $article) {
    article { id handle }
    userErrors { field message }
  }
}`

export const shopifyPublisher: PublisherAdapter = {
  platform: 'shopify',

  async publish(article: PublishArticleInput, creds: PublisherCredentials): Promise<PublishResult> {
    if (!creds.accessToken) {
      return {
        platform: 'shopify', platformPostId: null, liveUrl: null, status: 'FAILED',
        isLiveImmediately: false, requiresSeparateVerification: true,
        error: 'A Shopify Admin API access token is required.',
      }
    }

    const blogResult = await resolveBlogId(creds)
    if ('error' in blogResult) {
      return {
        platform: 'shopify', platformPostId: null, liveUrl: null, status: 'FAILED',
        isLiveImmediately: false, requiresSeparateVerification: true,
        error: blogResult.error,
      }
    }

    // SEO title/description live in the `global` metafield namespace —
    // that's what Shopify's own admin "Search engine listing" editor reads
    // from, not a plain title/description field on the article itself.
    const metafields = [
      { namespace: 'global', key: 'title_tag', type: 'single_line_text_field', value: article.title.slice(0, 70) },
      ...(article.metaDescription
        ? [{ namespace: 'global', key: 'description_tag', type: 'single_line_text_field', value: article.metaDescription.slice(0, 160) }]
        : []),
    ]

    const { data, errors } = await shopifyGraphQL<ArticleCreateResponse>(creds, ARTICLE_CREATE_MUTATION, {
      article: {
        blogId: blogResult.blogId,
        title: article.title,
        body: article.bodyHtml,
        handle: article.slug,
        isPublished: true,
        metafields,
      },
    })

    if (errors) {
      return {
        platform: 'shopify', platformPostId: null, liveUrl: null, status: 'FAILED',
        isLiveImmediately: false, requiresSeparateVerification: true, error: errors,
      }
    }
    const userErrors = data?.articleCreate.userErrors
    if (userErrors && userErrors.length > 0) {
      return {
        platform: 'shopify', platformPostId: null, liveUrl: null, status: 'FAILED',
        isLiveImmediately: false, requiresSeparateVerification: true,
        error: userErrors.map(e => `${e.field.join('.')}: ${e.message}`).join('; '),
      }
    }
    const createdArticle = data?.articleCreate.article
    if (!createdArticle) {
      return {
        platform: 'shopify', platformPostId: null, liveUrl: null, status: 'FAILED',
        isLiveImmediately: false, requiresSeparateVerification: true,
        error: 'Shopify returned no article and no error — unexpected response shape, check the API version.',
      }
    }

    const domain = creds.siteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')
    const liveUrl = `https://${domain}/blogs/${blogResult.blogHandle}/${createdArticle.handle}`

    return {
      platform: 'shopify',
      platformPostId: createdArticle.id,
      liveUrl,
      status: 'LIVE_UNVERIFIED',
      isLiveImmediately: true,
      requiresSeparateVerification: true,
      detail: 'Article created via articleCreate and marked published.',
    }
  },

  async checkLiveness(ref: LivenessCheckRef): Promise<LivenessCheckResult> {
    const { data, errors } = await shopifyGraphQL<{ article: { publishedAt: string | null } | null }>(
      ref.creds,
      `query ArticleStatus($id: ID!) { article(id: $id) { publishedAt } }`,
      { id: ref.platformPostId },
    )
    if (errors || !data?.article) {
      return { state: 'BUILD_PENDING', detail: errors || 'Could not read this article back from Shopify.' }
    }
    return data.article.publishedAt
      ? { state: 'LIVE_UNVERIFIED', detail: 'Shopify reports this article as published.' }
      : { state: 'BUILD_PENDING', detail: 'Shopify reports this article as not yet published.' }
  },
}
