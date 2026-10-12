/**
 * Deterministic privacy-page assembler from inventory + owner form fields.
 * Refuses when any required field is empty — never invents a value.
 * No LLM calls.
 */

import {
  CLAUSE_LIBRARY_VERSION,
  SECTION_CLAUSES,
  vendorClauseById,
} from './clauses'
import type { SiteInventory } from './inventory'

/** Jurisdiction → supervisory authority label (explicit map; no silent UK default in detector). */
export const SUPERVISORY_AUTHORITY_BY_JURISDICTION: Record<string, string> = {
  UK: 'the Information Commissioner’s Office (ICO)',
  GB: 'the Information Commissioner’s Office (ICO)',
  'United Kingdom': 'the Information Commissioner’s Office (ICO)',
  IE: 'the Data Protection Commission (Ireland)',
  Ireland: 'the Data Protection Commission (Ireland)',
  EU: 'your local EU supervisory authority',
  DE: 'your competent German supervisory authority (Landesbeauftragte)',
  Germany: 'your competent German supervisory authority (Landesbeauftragte)',
  FR: 'the Commission Nationale de l’Informatique et des Libertés (CNIL)',
  France: 'the Commission Nationale de l’Informatique et des Libertés (CNIL)',
  US: 'your applicable US state privacy regulator',
  'United States': 'your applicable US state privacy regulator',
}

export type PrivacyOwnerFields = {
  controllerName: string
  controllerAddress: string
  contactEmail: string
  jurisdiction: string
  retentionSummary: string
  retentionAnalytics: string
  retentionForms: string
}

export type AssembleResult =
  | {
      ok: true
      html: string
      mdx: string
      clauseLibraryVersion: typeof CLAUSE_LIBRARY_VERSION
      placeholdersUsed: Record<string, string>
    }
  | {
      ok: false
      reasons: string[]
    }

const REQUIRED: Array<{ key: keyof PrivacyOwnerFields; label: string }> = [
  { key: 'controllerName', label: 'controller name' },
  { key: 'controllerAddress', label: 'controller address' },
  { key: 'contactEmail', label: 'contact email' },
  { key: 'jurisdiction', label: 'jurisdiction' },
  { key: 'retentionSummary', label: 'retention summary' },
  { key: 'retentionAnalytics', label: 'analytics retention' },
  { key: 'retentionForms', label: 'forms retention' },
]

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    if (!(key in values) || !values[key]) {
      throw new Error(`Missing placeholder value: ${key}`)
    }
    return values[key]!
  })
}

export function assemblePrivacyPage(
  inventory: SiteInventory,
  fields: PrivacyOwnerFields,
): AssembleResult {
  const reasons: string[] = []
  for (const r of REQUIRED) {
    const v = (fields[r.key] ?? '').trim()
    if (!v) reasons.push(`missing required field: ${r.label}`)
  }
  if (reasons.length > 0) return { ok: false, reasons }

  const jurisdiction = fields.jurisdiction.trim()
  const authority = SUPERVISORY_AUTHORITY_BY_JURISDICTION[jurisdiction]
  if (!authority) {
    return {
      ok: false,
      reasons: [
        `jurisdiction "${jurisdiction}" has no mapped supervisory authority — set a supported jurisdiction or extend the explicit map (no silent default)`,
      ],
    }
  }

  const placeholders: Record<string, string> = {
    controller_name: fields.controllerName.trim(),
    controller_address: fields.controllerAddress.trim(),
    contact_email: fields.contactEmail.trim(),
    jurisdiction,
    supervisory_authority: authority,
    retention_summary: fields.retentionSummary.trim(),
    retention_analytics: fields.retentionAnalytics.trim(),
    retention_forms: fields.retentionForms.trim(),
  }

  const sections: string[] = []
  const mdxParts: string[] = []

  sections.push('<article class="privacy-notice">')
  sections.push('<h1>Privacy notice</h1>')
  mdxParts.push('# Privacy notice\n')

  for (const clause of SECTION_CLAUSES) {
    let body: string
    try {
      body = fill(clause.body, placeholders)
    } catch (e) {
      return {
        ok: false,
        reasons: [e instanceof Error ? e.message : String(e)],
      }
    }
    sections.push(`<h2>${escapeHtml(clause.heading)}</h2>`)
    sections.push(`<p>${escapeHtml(body)}</p>`)
    mdxParts.push(`## ${clause.heading}\n`)
    mdxParts.push(`${body}\n`)

    if (clause.id === 'recipients_intro') {
      const vendorIds = inventory.vendors.map((v) => v.vendor.id)
      if (vendorIds.length === 0) {
        sections.push('<p>We do not currently load third-party processors detected by inventory.</p>')
        mdxParts.push(
          'We do not currently load third-party processors detected by inventory.\n',
        )
      } else {
        sections.push('<ul>')
        for (const id of vendorIds) {
          const vc = vendorClauseById(id)
          if (!vc) {
            return {
              ok: false,
              reasons: [`missing vendor clause for detected vendor: ${id}`],
            }
          }
          sections.push(`<li>${escapeHtml(vc.body)}</li>`)
          mdxParts.push(`- ${vc.body}`)
        }
        sections.push('</ul>')
        mdxParts.push('')
      }
    }
  }

  sections.push('</article>')

  return {
    ok: true,
    html: sections.join('\n'),
    mdx: mdxParts.join('\n'),
    clauseLibraryVersion: CLAUSE_LIBRARY_VERSION,
    placeholdersUsed: placeholders,
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
