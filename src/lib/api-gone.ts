/**
 * 410 Gone for retired product surfaces (article writing, keywords, etc.).
 */

import { NextResponse } from 'next/server'

export function goneLegacy(feature = 'This API'): NextResponse {
  return NextResponse.json(
    {
      error: 'Gone',
      code: 'FEATURE_REMOVED',
      message: `${feature} has been removed from SEORANKO.`,
    },
    { status: 410 },
  )
}
