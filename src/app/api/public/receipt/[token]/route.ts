import { NextResponse } from 'next/server'
import { getFixReceiptByShareToken } from '@/lib/fix-strategies/findings-ui/fix-receipt'

export const dynamic = 'force-dynamic'

type Ctx = { params: { token: string } }

/** Public Fix Receipt JSON — only when share_token is set. */
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const receipt = await getFixReceiptByShareToken(ctx.params.token)
    if (!receipt || !receipt.shareToken) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    // Strip ids that are only useful privately.
    return NextResponse.json({
      receipt: {
        pageUrl: receipt.pageUrl,
        plainEnglish: receipt.plainEnglish,
        path: receipt.path,
        commitSha: receipt.commitSha,
        prUrl: receipt.prUrl,
        prNumber: receipt.prNumber,
        mergeSha: receipt.mergeSha,
        previewVerifiedAt: receipt.previewVerifiedAt,
        productionVerifiedAt: receipt.productionVerifiedAt,
        createdAt: receipt.createdAt,
      },
    })
  } catch (err) {
    console.error('[public/receipt]', err)
    return NextResponse.json({ error: 'Unavailable' }, { status: 500 })
  }
}
