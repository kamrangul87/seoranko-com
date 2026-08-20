/**
 * Concrete next-step copy for Quality Gate issues that still need a human.
 * Every unresolved warning/critical should tell the user what to do in one
 * step — not just "manual review required."
 *
 * Kept free of imports from article-quality-gate to avoid a circular module
 * dependency (the gate calls withActionHints at the end of its run).
 */

export interface ActionHintIssue {
  category: string
  id: string
  title: string
  description: string
  location?: string
  autoFixable: boolean
  actionHint?: string
  citationUrl?: string
  verificationStatus?: 'auto-verified' | 'figure-missing' | 'unreachable' | 'no-citation'
  verificationDetail?: string
}

export function buildActionHint(issue: ActionHintIssue): string {
  if (issue.verificationStatus === 'auto-verified') {
    return issue.verificationDetail || 'Already confirmed against the cited official page — no action needed.'
  }
  if (issue.verificationStatus === 'figure-missing') {
    return issue.citationUrl
      ? `Visit ${issue.citationUrl}, find the current figure, and update the sentence near "${(issue.location || '').slice(0, 60)}" to match.`
      : 'Find the official source for this figure, update the sentence to the current amount, and add the link.'
  }
  if (issue.verificationStatus === 'unreachable') {
    return issue.citationUrl
      ? `Retry later, or open ${issue.citationUrl} yourself and confirm the figure is still correct before publishing.`
      : 'Open the official source yourself and confirm the figure is still correct before publishing.'
  }
  if (issue.verificationStatus === 'no-citation') {
    return 'Add a link to the official page that states this figure (e.g. the GOV.UK grant page), then re-run Quality Gate.'
  }

  switch (issue.category) {
    case 'grant-figure':
      if (issue.citationUrl) {
        return `Visit ${issue.citationUrl} and confirm "${extractFigureHint(issue)}" is still listed, then update the date reference in the sentence if needed.`
      }
      return 'Replace the unsourced figure sentence with one that names the official source and links to it, or add "(verify at GOV.UK)" after the amount and a real GOV.UK link that actually states this figure (a citation for a different claim is not enough).'
    case 'claim-evidence':
      return issue.citationUrl
        ? `Confirm ${issue.citationUrl} actually supports this claim; update the wording or add a more specific source if it does not.`
        : 'Add an official source link that supports this specific claim — citations for other claims in the article do not count.'
    case 'dated-policy':
      if (issue.id.startsWith('stale-year-')) {
        return 'Update the year in the title/heading/meta description to match the article\'s publish year, or rephrase as a clear historical reference (e.g. "the 2022 rules").'
      }
      if (issue.id.startsWith('time-anchored-claim-')) {
        return issue.citationUrl
          ? `Visit ${issue.citationUrl}, confirm the figure, then add or keep that link next to the claim and set a clear "as of [month year]" date.`
          : 'Add an outbound link to the official source that states this figure, and keep an explicit "as of [month year]" date in the same sentence.'
      }
      return issue.citationUrl
        ? `Visit ${issue.citationUrl} and confirm the claim is still current, then update the "as of" date in the sentence.`
        : 'Replace this sentence with a version naming the actual source and linking to it (prefer the official .gov page).'
    case 'ai-slop':
      return 'Delete or rewrite the flagged phrase in plain language — remove filler like "in today\'s landscape" / "it\'s worth noting".'
    case 'typo':
    case 'copy-error':
      return `Find the text near "${(issue.location || issue.title).slice(0, 60)}" and correct the typo/glitch so the sentence reads cleanly.`
    case 'scannability':
      return 'Split the dense paragraph into 2–3 shorter paragraphs (one idea each), or use Fix All to auto-split.'
    case 'schema':
      return 'Open the JSON-LD block at the end of the article and fix the listed schema field, or re-run Fix All to regenerate FAQ/Article schema.'
    case 'brand-mismatch':
      return 'Search the article for the wrong brand name and replace every instance with your brand, or regenerate with the correct brand set.'
    case 'topic-alignment':
      return 'Do not publish — regenerate the article for the requested keyword so the H1 and body match the brief.'
    case 'score-floor':
      return 'Run Fix All, then strengthen the weak area (E-E-A-T: add author/sources; keyword density: use the primary phrase naturally in 2–3 more places; fact sourcing: cite official sources).'
    case 'hedging':
      return 'Review hedge classes: keep appropriate may/can/approximately for variable facts; trim only repetitive boilerplate "typically/generally".'
    case 'word-count':
      return 'Expand thin sections with concrete steps and examples, or trim fluff until the article is inside the target word band.'
    case 'missing-brand':
      return 'Add your brand name naturally in the introduction and conclusion, then re-check.'
    case 'external-links':
    case 'internal-links':
      return 'Add or fix the flagged link so it points at a real, relevant page — remove dead or mismatched citations.'
    case 'images':
      return 'Ensure every figure has a real image URL and descriptive alt text before publishing.'
    case 'brief-coverage':
    case 'secondary-keyword-coverage':
      return 'Weave the missing brief entities / secondary phrases into existing sections with one clear sentence each — do not stuff.'
    default:
      if (issue.autoFixable) {
        return 'Click Fix All Issues to apply the automatic repair, then re-check.'
      }
      return `Edit the sentence near "${(issue.location || 'the flagged spot').slice(0, 60)}" so the problem described above is resolved, then re-run Quality Gate.`
  }
}

function extractFigureHint(issue: Pick<ActionHintIssue, 'title' | 'description'>): string {
  const fromDesc = issue.description?.match(/Found:\s*"([^"]+)"/)
  if (fromDesc) return fromDesc[1]
  const fromTitle = issue.title?.match(/"([^"]+)"/)
  if (fromTitle) return fromTitle[1]
  return 'this figure'
}

/** Attach actionHint to every issue that still needs a human (or verified note). */
export function withActionHints<T extends ActionHintIssue>(issues: T[]): Array<T & { actionHint: string }> {
  return issues.map(issue => ({
    ...issue,
    actionHint: issue.actionHint || buildActionHint(issue),
  }))
}
