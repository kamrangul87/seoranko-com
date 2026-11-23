import type { Metadata } from 'next'
import { MarketingPage } from '@/components/MarketingPage'
import { PROOF_EXAMPLES, PROOF_SITE_HOST, PROOF_UI_COPY } from '@/lib/proof-examples'
import {
  AUTODUN_CASE_STUDY_COPY,
  AUTODUN_GSC_WEEKLY_IMPRESSIONS,
  autodunCaseStudyArticleJsonLd,
  formatImpressions,
  formatWeekOf,
} from '@/lib/case-study-autodun'
import { AUTODUN_CASE_STUDY_METADATA } from '@/lib/site-metadata'

export const metadata: Metadata = AUTODUN_CASE_STUDY_METADATA

export default function AutodunCaseStudyPage() {
  const jsonLd = autodunCaseStudyArticleJsonLd()
  return (
    <MarketingPage>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <main style={{ maxWidth: 720, margin: '0 auto', padding: '72px 24px 96px' }}>
        <p style={{ fontSize: 13, color: '#FF6B2C', fontWeight: 700, marginBottom: 12 }}>Case study</p>
        <h1 style={{ fontSize: 36, fontWeight: 800, letterSpacing: '-1px', lineHeight: 1.15, marginBottom: 16 }}>
          {AUTODUN_CASE_STUDY_COPY.headline}
        </h1>
        <p style={{ fontSize: 18, color: '#333', lineHeight: 1.65, marginBottom: 12 }}>
          {AUTODUN_CASE_STUDY_COPY.siteKind}
        </p>
        <p style={{ fontSize: 16, color: '#333', lineHeight: 1.65, marginBottom: 12 }}>
          {AUTODUN_CASE_STUDY_COPY.shippedPrefix} {AUTODUN_CASE_STUDY_COPY.verifiedFixesLine}.
        </p>
        <p style={{ fontSize: 16, color: '#6B6B6B', lineHeight: 1.65, marginBottom: 40 }}>
          {AUTODUN_CASE_STUDY_COPY.description}
        </p>

        <h2 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.4px', marginBottom: 12 }}>
          {AUTODUN_CASE_STUDY_COPY.gscHeading}
        </h2>
        <p style={{ fontSize: 15, color: '#6B6B6B', lineHeight: 1.65, marginBottom: 20 }}>
          {AUTODUN_CASE_STUDY_COPY.gscIntro}
        </p>
        <ol
          style={{
            listStyle: 'none',
            padding: 0,
            margin: '0 0 24px',
            border: '1px solid #E8E8E4',
            borderRadius: 12,
            overflow: 'hidden',
            background: '#fff',
          }}
        >
          {AUTODUN_GSC_WEEKLY_IMPRESSIONS.map((row, i) => (
            <li
              key={row.weekOf}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 16,
                padding: '14px 18px',
                borderTop: i === 0 ? undefined : '1px solid #E8E8E4',
                fontSize: 15,
              }}
            >
              <span>
                Week of {formatWeekOf(row.weekOf)}
                {row.partial ? ' (partial week)' : ''}
              </span>
              <span style={{ fontWeight: 700 }}>{formatImpressions(row.impressions)}</span>
            </li>
          ))}
        </ol>
        <p style={{ fontSize: 15, color: '#333', lineHeight: 1.65, marginBottom: 8 }}>
          {AUTODUN_CASE_STUDY_COPY.clicksCaveat}
        </p>
        <p style={{ fontSize: 15, color: '#6B6B6B', lineHeight: 1.65, marginBottom: 48 }}>
          {AUTODUN_CASE_STUDY_COPY.earlyProgressLine}
        </p>

        <h2 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.4px', marginBottom: 12 }}>
          {AUTODUN_CASE_STUDY_COPY.fixesHeading}
        </h2>
        <p style={{ fontSize: 15, color: '#6B6B6B', lineHeight: 1.65, marginBottom: 20 }}>
          {PROOF_UI_COPY.proofNothingMore}
        </p>
        <div style={{ display: 'grid', gap: 12 }}>
          {PROOF_EXAMPLES.map((ex) => (
            <article
              key={ex.prNumber}
              style={{
                background: '#fff',
                border: '1px solid #E8E8E4',
                borderRadius: 12,
                padding: 20,
              }}
            >
              <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>{ex.problem}</h3>
              <p style={{ fontSize: 14, color: '#6B6B6B', lineHeight: 1.6, margin: 0 }}>{ex.whatChanged}</p>
              {ex.verifiedUrl ? (
                <p style={{ fontSize: 13, margin: '10px 0 0' }}>
                  <a href={ex.verifiedUrl} target="_blank" rel="noopener" style={{ color: '#FF6B2C' }}>
                    {PROOF_SITE_HOST}
                  </a>
                  {' · '}
                  {PROOF_UI_COPY.viewLivePage}
                </p>
              ) : null}
            </article>
          ))}
        </div>
      </main>
    </MarketingPage>
  )
}
