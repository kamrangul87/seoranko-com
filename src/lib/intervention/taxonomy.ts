/**
 * Intervention taxonomy — only types the system can detect or verify today.
 * Lookup mirrors `intervention_taxonomy` seed; code is the mechanical source of truth
 * for mapping AutoFixKind → (type, subtype, scope).
 */

import type { AutoFixKind } from '@/lib/fix-agent-classification'

export type InterferenceScope = 'url' | 'section' | 'sitewide'

export type InterventionType =
  | 'metadata'
  | 'indexability'
  | 'structured_data'
  | 'internal_linking'
  | 'heading_structure'

export type InterventionSubtype =
  | 'title'
  | 'meta_description'
  | 'canonical'
  | 'meta_robots'
  | 'robots_txt'
  | 'schema_added'
  | 'schema_modified'
  | 'schema_removed'
  | 'inlink_added'
  | 'inlink_removed'
  | 'anchor_changed'
  | 'h1_changed'
  | 'hierarchy_fixed'

export type TaxonomyEntry = {
  intervention_type: InterventionType
  intervention_subtype: InterventionSubtype
  interference_scope: InterferenceScope
}

/** Seed rows — must stay in sync with migration `intervention_taxonomy` inserts. */
export const INTERVENTION_TAXONOMY: readonly TaxonomyEntry[] = [
  { intervention_type: 'metadata', intervention_subtype: 'title', interference_scope: 'url' },
  {
    intervention_type: 'metadata',
    intervention_subtype: 'meta_description',
    interference_scope: 'url',
  },
  { intervention_type: 'indexability', intervention_subtype: 'canonical', interference_scope: 'url' },
  {
    intervention_type: 'indexability',
    intervention_subtype: 'meta_robots',
    interference_scope: 'url',
  },
  {
    intervention_type: 'indexability',
    intervention_subtype: 'robots_txt',
    interference_scope: 'sitewide',
  },
  {
    intervention_type: 'structured_data',
    intervention_subtype: 'schema_added',
    interference_scope: 'url',
  },
  {
    intervention_type: 'structured_data',
    intervention_subtype: 'schema_modified',
    interference_scope: 'url',
  },
  {
    intervention_type: 'structured_data',
    intervention_subtype: 'schema_removed',
    interference_scope: 'url',
  },
  {
    intervention_type: 'internal_linking',
    intervention_subtype: 'inlink_added',
    interference_scope: 'section',
  },
  {
    intervention_type: 'internal_linking',
    intervention_subtype: 'inlink_removed',
    interference_scope: 'section',
  },
  {
    intervention_type: 'internal_linking',
    intervention_subtype: 'anchor_changed',
    interference_scope: 'section',
  },
  {
    intervention_type: 'heading_structure',
    intervention_subtype: 'h1_changed',
    interference_scope: 'url',
  },
  {
    intervention_type: 'heading_structure',
    intervention_subtype: 'hierarchy_fixed',
    interference_scope: 'url',
  },
] as const

const TAXONOMY_KEY = (type: string, subtype: string) => `${type}::${subtype}`

const TAXONOMY_BY_KEY = new Map(
  INTERVENTION_TAXONOMY.map((e) => [TAXONOMY_KEY(e.intervention_type, e.intervention_subtype), e]),
)

export function lookupTaxonomy(
  interventionType: string,
  interventionSubtype: string,
): TaxonomyEntry | null {
  return TAXONOMY_BY_KEY.get(TAXONOMY_KEY(interventionType, interventionSubtype)) || null
}

export function interferenceScopeFor(
  interventionType: string,
  interventionSubtype: string,
): InterferenceScope | null {
  return lookupTaxonomy(interventionType, interventionSubtype)?.interference_scope ?? null
}

/**
 * Treatment/control URL split is only valid when interference stays at `url`.
 * Section/sitewide interventions contaminate controls.
 */
export function allowsTreatmentControlSplit(scope: InterferenceScope): boolean {
  return scope === 'url'
}

export type SchemaChangeKind = 'schema_added' | 'schema_modified' | 'schema_removed'

export function classifySchemaChange(
  beforeTypes: string[],
  afterTypes: string[],
): SchemaChangeKind | null {
  const before = new Set(beforeTypes.map((t) => t.toLowerCase()))
  const after = new Set(afterTypes.map((t) => t.toLowerCase()))
  const added = Array.from(after).filter((t) => !before.has(t))
  const removed = Array.from(before).filter((t) => !after.has(t))
  if (added.length === 0 && removed.length === 0) return null
  if (added.length > 0 && removed.length === 0 && before.size === 0) return 'schema_added'
  if (added.length > 0 && removed.length === 0) return 'schema_added'
  if (removed.length > 0 && added.length === 0) return 'schema_removed'
  return 'schema_modified'
}

/**
 * Map a Fix Agent auto-kind to a taxonomy row when the kind is detectable today.
 * Schema subtype is refined by `classifySchemaChange` when before/after types are known.
 */
export function taxonomyForAutoFixKind(
  kind: AutoFixKind,
  opts?: { schemaChange?: SchemaChangeKind | null },
): TaxonomyEntry | null {
  switch (kind) {
    case 'meta-title':
      return lookupTaxonomy('metadata', 'title')
    case 'meta-description':
      return lookupTaxonomy('metadata', 'meta_description')
    case 'missing-h1':
      return lookupTaxonomy('heading_structure', 'h1_changed')
    case 'html-structure':
      return lookupTaxonomy('heading_structure', 'hierarchy_fixed')
    case 'redirect-canonical':
      return lookupTaxonomy('indexability', 'canonical')
    case 'schema-organization':
    case 'schema-article':
    case 'schema-product':
    case 'schema-breadcrumb': {
      const subtype = opts?.schemaChange || 'schema_added'
      return lookupTaxonomy('structured_data', subtype)
    }
    case 'rewrite-link-href':
      return lookupTaxonomy('internal_linking', 'anchor_changed')
    case 'remove-dead-link':
      return lookupTaxonomy('internal_linking', 'inlink_removed')
    default:
      return null
  }
}
