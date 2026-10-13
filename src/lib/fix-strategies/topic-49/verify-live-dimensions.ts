/**
 * Topic 49 postcondition verifier.
 *
 * Asserts against LIVE served HTML + fetched image headers:
 * every <img> carries width/height whose ratio matches the intrinsic header
 * ratio within tolerance. Never claims CLS. Does not import the fixer.
 *
 * Images are always resolved against `pageUrl` (the deployment being verified).
 * Callers must pass a preview/production URL whose deploy SHA contains the
 * item commit — never a stale shared preview from an earlier item.
 */

import { parseHtml } from '@/lib/fix-strategies/shared'
import {
  fetchImageHeaderBytes,
  readImageIntrinsicSize,
} from '@/lib/fix-strategies/shared/image-intrinsic-size'
import {
  isSvgWithViewBox,
  parseDeclaredDims,
  ratioOf,
  ratiosMatch,
} from './classify'
import { inspectImgCss } from './css-signals'

export type LiveImgDimImageDiagnostic = {
  srcAttr: string
  resolvedImgUrl: string
  httpStatus: number
  contentType: string | null
  intrinsicWidth: number | null
  intrinsicHeight: number | null
  attrWidth: number | null
  attrHeight: number | null
  heightAuto: boolean
  failedCondition: string | null
}

export type LiveImgDimDiagnostics = {
  deploymentUrl: string
  deploymentSha: string | null
  images: LiveImgDimImageDiagnostic[]
}

export type LiveImgDimVerification = {
  ok: boolean
  detail: string
  failures: Array<{ src: string; reason: string }>
  diagnostics?: LiveImgDimDiagnostics
}

export async function verifyLiveImgDimensions(
  liveHtml: string,
  pageUrl: string,
  fetchImpl: typeof fetch,
  opts?: { deploymentSha?: string | null },
): Promise<LiveImgDimVerification> {
  const parsed = parseHtml(liveHtml)
  const imgs = [
    ...parsed.bodyElements('img'),
    ...parsed.headElements('img'),
  ]
  const failures: LiveImgDimVerification['failures'] = []
  const imageDiags: LiveImgDimImageDiagnostic[] = []
  const deploymentSha = opts?.deploymentSha ?? null

  for (const img of imgs) {
    const srcAttr = img.attrs.src ?? ''
    if (!srcAttr) continue

    const css = inspectImgCss(liveHtml, img.attrs)
    const declared = parseDeclaredDims(img.attrs)

    let absolute: string
    try {
      absolute = new URL(srcAttr, pageUrl).toString()
    } catch {
      const reason = 'unparseable src'
      failures.push({ src: srcAttr, reason })
      imageDiags.push({
        srcAttr,
        resolvedImgUrl: '',
        httpStatus: 0,
        contentType: null,
        intrinsicWidth: null,
        intrinsicHeight: null,
        attrWidth: declared.width,
        attrHeight: declared.height,
        heightAuto: css.hasHeightAuto,
        failedCondition: reason,
      })
      continue
    }

    const header = await fetchImageHeaderBytes(absolute, fetchImpl)
    if (isSvgWithViewBox(img.attrs, header.contentType, header.bytes)) {
      imageDiags.push({
        srcAttr,
        resolvedImgUrl: absolute,
        httpStatus: header.status,
        contentType: header.contentType,
        intrinsicWidth: null,
        intrinsicHeight: null,
        attrWidth: declared.width,
        attrHeight: declared.height,
        heightAuto: css.hasHeightAuto,
        failedCondition: null,
      })
      continue
    }

    if (!header.bytes) {
      const reason = `cannot verify — ${header.detail}`
      failures.push({ src: srcAttr, reason })
      imageDiags.push({
        srcAttr,
        resolvedImgUrl: absolute,
        httpStatus: header.status,
        contentType: header.contentType,
        intrinsicWidth: null,
        intrinsicHeight: null,
        attrWidth: declared.width,
        attrHeight: declared.height,
        heightAuto: css.hasHeightAuto,
        failedCondition: reason,
      })
      console.info('[topic-49/verify]', {
        deploymentUrl: pageUrl,
        deploymentSha,
        resolvedImgUrl: absolute,
        httpStatus: header.status,
        attrWidth: declared.width,
        attrHeight: declared.height,
        heightAuto: css.hasHeightAuto,
        failedCondition: reason,
      })
      continue
    }

    const intrinsic = readImageIntrinsicSize(header.bytes)
    if (!intrinsic) {
      const reason = 'intrinsic header unreadable'
      failures.push({ src: srcAttr, reason })
      imageDiags.push({
        srcAttr,
        resolvedImgUrl: absolute,
        httpStatus: header.status,
        contentType: header.contentType,
        intrinsicWidth: null,
        intrinsicHeight: null,
        attrWidth: declared.width,
        attrHeight: declared.height,
        heightAuto: css.hasHeightAuto,
        failedCondition: reason,
      })
      console.info('[topic-49/verify]', {
        deploymentUrl: pageUrl,
        deploymentSha,
        resolvedImgUrl: absolute,
        httpStatus: header.status,
        contentType: header.contentType,
        byteLength: header.bytes.length,
        magicHex: Array.from(header.bytes.subarray(0, 4))
          .map((x) => x.toString(16).padStart(2, '0'))
          .join(''),
        heightAuto: css.hasHeightAuto,
        failedCondition: reason,
      })
      continue
    }

    if (declared.width == null || declared.height == null) {
      const reason = 'missing width and/or height attribute'
      failures.push({ src: srcAttr, reason })
      imageDiags.push({
        srcAttr,
        resolvedImgUrl: absolute,
        httpStatus: header.status,
        contentType: header.contentType,
        intrinsicWidth: intrinsic.width,
        intrinsicHeight: intrinsic.height,
        attrWidth: declared.width,
        attrHeight: declared.height,
        heightAuto: css.hasHeightAuto,
        failedCondition: reason,
      })
      console.info('[topic-49/verify]', {
        deploymentUrl: pageUrl,
        deploymentSha,
        resolvedImgUrl: absolute,
        httpStatus: header.status,
        intrinsicWidth: intrinsic.width,
        intrinsicHeight: intrinsic.height,
        attrWidth: declared.width,
        attrHeight: declared.height,
        heightAuto: css.hasHeightAuto,
        failedCondition: reason,
      })
      continue
    }

    if (
      !ratiosMatch(
        ratioOf(declared.width, declared.height),
        ratioOf(intrinsic.width, intrinsic.height),
      )
    ) {
      const reason = `ratio ${declared.width}×${declared.height} ≠ intrinsic ${intrinsic.width}×${intrinsic.height}`
      failures.push({ src: srcAttr, reason })
      imageDiags.push({
        srcAttr,
        resolvedImgUrl: absolute,
        httpStatus: header.status,
        contentType: header.contentType,
        intrinsicWidth: intrinsic.width,
        intrinsicHeight: intrinsic.height,
        attrWidth: declared.width,
        attrHeight: declared.height,
        heightAuto: css.hasHeightAuto,
        failedCondition: reason,
      })
      console.info('[topic-49/verify]', {
        deploymentUrl: pageUrl,
        deploymentSha,
        resolvedImgUrl: absolute,
        httpStatus: header.status,
        intrinsicWidth: intrinsic.width,
        intrinsicHeight: intrinsic.height,
        attrWidth: declared.width,
        attrHeight: declared.height,
        heightAuto: css.hasHeightAuto,
        failedCondition: reason,
      })
      continue
    }

    imageDiags.push({
      srcAttr,
      resolvedImgUrl: absolute,
      httpStatus: header.status,
      contentType: header.contentType,
      intrinsicWidth: intrinsic.width,
      intrinsicHeight: intrinsic.height,
      attrWidth: declared.width,
      attrHeight: declared.height,
      heightAuto: css.hasHeightAuto,
      failedCondition: null,
    })
  }

  const diagnostics: LiveImgDimDiagnostics = {
    deploymentUrl: pageUrl,
    deploymentSha,
    images: imageDiags,
  }

  if (failures.length > 0) {
    const first = imageDiags.find((d) => d.failedCondition)
    const detailParts = [
      `${failures.length} img(s) fail dimension postcondition`,
      `deploymentUrl=${pageUrl}`,
      deploymentSha ? `deploymentSha=${deploymentSha.slice(0, 7)}` : null,
      first
        ? `img=${first.resolvedImgUrl} status=${first.httpStatus} intrinsic=${first.intrinsicWidth ?? '?'}×${first.intrinsicHeight ?? '?'} attr=${first.attrWidth ?? '?'}×${first.attrHeight ?? '?'} heightAuto=${first.heightAuto ? 'yes' : 'no'} failed=${first.failedCondition}`
        : null,
    ].filter(Boolean)
    return {
      ok: false,
      detail: detailParts.join(' | '),
      failures,
      diagnostics,
    }
  }

  return {
    ok: true,
    detail:
      'all imgs have width/height matching intrinsic header ratio',
    failures: [],
    diagnostics,
  }
}
