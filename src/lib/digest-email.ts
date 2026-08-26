// src/lib/digest-email.ts
// Weekly Monday digest email — makes SEORANKO indispensable
// Sends via Resend

export interface DigestData {
  userName: string
  userEmail: string
  weekEnding: string
  articles: DigestArticle[]
  topAction: string
  freshnessSummary: { fresh: number; aging: number; stale: number }
  citationSummary: { cited: number; notCited: number; unchecked: number }
  weeklySummary?: string
  /** C04 — claims whose cited source no longer resolves. Review only, never auto-rewritten. */
  temporalClaimDrift?: TemporalClaimDriftItem[]
}

export interface TemporalClaimDriftItem {
  articleId: string
  claimText: string
  sourceUrl: string
  reason: string
}

export interface DigestArticle {
  title: string
  keyword: string
  rankScore: number
  rankChange: number | null     // + = improved, - = dropped, null = no data
  currentPosition: number | null
  positionChange: number | null
  locationCode?: number
  isCited: boolean | null
  citedCompetitors: string[]
  freshnessStatus: string
  needsRefresh: boolean
  topAction: string
}

export function buildDigestHTML(data: DigestData): string {
  const { userName, weekEnding, articles, topAction, freshnessSummary, citationSummary, weeklySummary, temporalClaimDrift } = data

  const driftSection = temporalClaimDrift && temporalClaimDrift.length > 0 ? `
    <div style="padding:16px 28px;background:#FCEBEB;border-bottom:1px solid #F5C6C6">
      <p style="margin:0 0 8px;font-size:11px;color:#791F1F;font-weight:500;text-transform:uppercase;letter-spacing:.06em">Claims needing review — cited source no longer resolves</p>
      ${temporalClaimDrift.slice(0, 5).map(d => `
        <p style="margin:0 0 6px;font-size:13px;color:#7A1F1F;line-height:1.4">
          "${d.claimText.slice(0, 140)}" — <span style="color:#9A4E1A">${d.reason}</span>
        </p>
      `).join('')}
    </div>` : ''

  const articleRows = articles.slice(0, 10).map(a => `
    <tr style="border-bottom:1px solid #F3F4F6">
      <td style="padding:10px 8px;font-size:13px;color:#111827;max-width:160px">${a.title}</td>
      <td style="padding:10px 8px;text-align:center">
        <span style="font-size:14px;font-weight:600;color:${a.rankScore >= 80 ? '#1D9E75' : a.rankScore >= 60 ? '#BA7517' : '#E24B4A'}">${a.rankScore}</span>
      </td>
      <td style="padding:10px 8px;text-align:center;font-size:13px">
        <!-- §10 item 10 / §6.4: negative positionChange = improved -->
        ${a.currentPosition
          ? `<span style="font-weight:600">#${a.currentPosition}</span>${
              a.positionChange
                ? a.positionChange < 0
                  ? `<span style="color:#1D9E75;font-size:11px"> ↑${Math.abs(a.positionChange)}</span>`
                  : a.positionChange > 0
                    ? `<span style="color:#E24B4A;font-size:11px"> ↓${a.positionChange}</span>`
                    : ''
                : ''
            }`
          : '<span style="color:#9CA3AF">—</span>'
        }
      </td>
      <td style="padding:10px 8px;text-align:center;font-size:13px">
        ${a.isCited === null ? '<span style="color:#9CA3AF">—</span>' : a.isCited ? '<span style="color:#1D9E75">✓</span>' : '<span style="color:#E24B4A">✗</span>'}
      </td>
      <td style="padding:10px 8px;text-align:center">
        <span style="font-size:11px;padding:2px 7px;border-radius:20px;background:${a.freshnessStatus === 'fresh' ? '#E1F5EE' : a.freshnessStatus === 'aging' ? '#FAEEDA' : '#FCEBEB'};color:${a.freshnessStatus === 'fresh' ? '#085041' : a.freshnessStatus === 'aging' ? '#633806' : '#791F1F'}">${a.freshnessStatus}</span>
      </td>
    </tr>
  `).join('')

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#F9FAFB;margin:0;padding:20px">
  <div style="max-width:600px;margin:0 auto;background:#FFFFFF;border-radius:12px;overflow:hidden;border:1px solid #E5E7EB">

    <!-- Header -->
    <div style="background:#FF6B2C;padding:24px 28px">
      <p style="margin:0;color:#FFFFFF;font-size:11px;letter-spacing:.08em;text-transform:uppercase;opacity:.8">RANKO — Your SEO Strategist</p>
      <h1 style="margin:6px 0 0;color:#FFFFFF;font-size:22px;font-weight:600">RANKO Weekly: week ending ${weekEnding}</h1>
    </div>

    <!-- Top action -->
    <div style="padding:20px 28px;background:#FFF7F0;border-bottom:1px solid #FFE4CC">
      <p style="margin:0;font-size:11px;color:#9A4E1A;font-weight:500;text-transform:uppercase;letter-spacing:.06em">Your #1 action this week</p>
      <p style="margin:6px 0 0;font-size:15px;color:#7C3A0F;font-weight:500">${topAction}</p>
    </div>

    <!-- Summary stats -->
    <div style="display:flex;padding:20px 28px;gap:16px;border-bottom:1px solid #F3F4F6">
      <div style="flex:1;text-align:center">
        <div style="font-size:24px;font-weight:700;color:#1D9E75">${citationSummary.cited}</div>
        <div style="font-size:11px;color:#6B7280;margin-top:2px">Articles cited by AI</div>
      </div>
      <div style="flex:1;text-align:center">
        <div style="font-size:24px;font-weight:700;color:#E24B4A">${citationSummary.notCited}</div>
        <div style="font-size:11px;color:#6B7280;margin-top:2px">Not yet cited</div>
      </div>
      <div style="flex:1;text-align:center">
        <div style="font-size:24px;font-weight:700;color:#BA7517">${freshnessSummary.stale}</div>
        <div style="font-size:11px;color:#6B7280;margin-top:2px">Need refreshing</div>
      </div>
    </div>

    <!-- Weekly AI summary -->
    ${weeklySummary ? `
    <div style="padding:16px 28px;background:#F0FDF4;border-bottom:1px solid #D1FAE5">
      <p style="margin:0 0 4px;font-size:11px;color:#065F46;font-weight:500;text-transform:uppercase;letter-spacing:.06em">AI Weekly Summary</p>
      <p style="margin:0;font-size:14px;color:#064E3B;line-height:1.5">${weeklySummary}</p>
    </div>` : ''}
    ${driftSection}

    <!-- Article table -->
    <div style="padding:20px 28px">
      <p style="margin:0 0 12px;font-size:13px;font-weight:600;color:#374151">Tracked articles — hi ${userName}</p>
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="border-bottom:2px solid #E5E7EB">
            <th style="padding:8px;text-align:left;font-size:11px;color:#6B7280;font-weight:500">Article</th>
            <th style="padding:8px;text-align:center;font-size:11px;color:#6B7280;font-weight:500">RANK</th>
            <th style="padding:8px;text-align:center;font-size:11px;color:#6B7280;font-weight:500">Position</th>
            <th style="padding:8px;text-align:center;font-size:11px;color:#6B7280;font-weight:500">AI cited</th>
            <th style="padding:8px;text-align:center;font-size:11px;color:#6B7280;font-weight:500">Fresh</th>
          </tr>
        </thead>
        <tbody>${articleRows}</tbody>
      </table>
    </div>

    <!-- Footer -->
    <div style="padding:16px 28px;background:#F9FAFB;border-top:1px solid #E5E7EB">
      <p style="margin:0;font-size:12px;color:#9CA3AF">
        RANKO by SEORANKO · <a href="https://seoranko.com/dashboard" style="color:#FF6B2C">Open dashboard</a> · <a href="https://seoranko.com/unsubscribe" style="color:#9CA3AF">Unsubscribe</a>
      </p>
    </div>
  </div>
</body>
</html>`
}

export function computeTopAction(articles: DigestArticle[]): string {
  // §10 item 10 / §6.4: negative Δposition = good, so a drop is positionChange > 3.
  const droppedArticles = articles.filter(
    a => a.positionChange !== null && a.positionChange > 3
  )
  if (droppedArticles.length > 0) {
    const worst = droppedArticles.sort((a, b) =>
      (b.positionChange || 0) - (a.positionChange || 0)
    )[0]
    return `"${worst.title}" dropped ${Math.abs(worst.positionChange!)} positions this week — auto-fix has been applied. Check the article and consider a manual review.`
  }

  const stale = articles.filter(a => a.needsRefresh)
  if (stale.length > 0) {
    return `Refresh "${stale[0].title}" — content is ${stale[0].freshnessStatus} and 3× less likely to be cited by AI engines`
  }

  const uncited = articles.filter(a => a.isCited === false)
  if (uncited.length > 0) {
    return `Improve AI citability for "${uncited[0].title}" — competitors are being cited instead. Check fact density and schema.`
  }

  const lowScore = articles.filter(a => a.rankScore < 60)
  if (lowScore.length > 0) {
    return `Boost RANK score for "${lowScore[0].title}" (currently ${lowScore[0].rankScore}/100) — click Improve All in the article editor`
  }

  return 'All articles are performing well — consider generating a new article targeting a related keyword cluster'
}
