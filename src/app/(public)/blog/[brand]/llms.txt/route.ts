import { NextResponse } from 'next/server'
import { listPublishedForBrand } from '@/lib/public-article-loader'

// Plain-text index of live articles for this brand, at
// /blog/[brand]/llms.txt.
export async function GET(_req: Request, { params }: { params: { brand: string } }) {
  const published = await listPublishedForBrand(params.brand)
  const lines = published.map(p => {
    const summary = (p.article.metaDescription || '').slice(0, 160)
    return `# ${p.article.title}\n> ${summary}\nURL: ${p.publicUrl}\nLast-Updated: ${p.article.updatedAt.slice(0, 10)}\n`
  })
  const body = `# ${params.brand}\n\n${lines.join('\n')}`
  return new NextResponse(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}
