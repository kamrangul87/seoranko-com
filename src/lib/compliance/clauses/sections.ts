/**
 * CLAUSE_LIBRARY_VERSION=1
 * human-reviewed text — do not generate or rewrite with a model
 *
 * Section blocks aligned with the ICO privacy notice structure:
 * https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/the-right-to-be-informed/what-privacy-information-should-we-provide/
 */

import { CLAUSE_LIBRARY_VERSION } from './version'

export { CLAUSE_LIBRARY_VERSION }

export type SectionClauseId =
  | 'controller_identity'
  | 'contact'
  | 'lawful_basis'
  | 'recipients_intro'
  | 'international_transfers'
  | 'retention'
  | 'rights'

export type SectionClause = {
  id: SectionClauseId
  heading: string
  body: string
}

/**
 * Placeholders only: {{controller_name}}, {{controller_address}},
 * {{contact_email}}, {{jurisdiction}}, {{supervisory_authority}},
 * {{retention_summary}}, {{retention_analytics}}, {{retention_forms}}.
 */
export const SECTION_CLAUSES: readonly SectionClause[] = [
  {
    id: 'controller_identity',
    heading: 'Who we are',
    body:
      'The data controller for this website is {{controller_name}}, of {{controller_address}}. ' +
      'This notice explains how we process personal data when you use our site.',
  },
  {
    id: 'contact',
    heading: 'How to contact us',
    body:
      'Questions about this notice or your personal data can be sent to {{contact_email}}.',
  },
  {
    id: 'lawful_basis',
    heading: 'Lawful bases',
    body:
      'We process personal data only where a lawful basis applies. Depending on the activity, ' +
      'that may be consent (for example non-essential cookies and similar technologies), ' +
      'contract (to provide a service you request), legitimate interests (for example securing ' +
      'and improving the site, balanced against your rights), or a legal obligation.',
  },
  {
    id: 'recipients_intro',
    heading: 'Who we share data with',
    body:
      'We use the following categories of recipients / processors to operate this site. ' +
      'Each receives only what is needed for their role:',
  },
  {
    id: 'international_transfers',
    heading: 'International transfers',
    body:
      'Some recipients process data outside {{jurisdiction}}. Where that happens we rely on ' +
      'an adequacy decision where available, or appropriate safeguards such as standard ' +
      'contractual clauses, together with any supplementary measures required.',
  },
  {
    id: 'retention',
    heading: 'How long we keep data',
    body:
      '{{retention_summary}} Analytics-related data is retained for {{retention_analytics}}. ' +
      'Form submission data is retained for {{retention_forms}}.',
  },
  {
    id: 'rights',
    heading: 'Your rights',
    body:
      'Depending on applicable law you may have rights to access, rectify, erase, restrict, ' +
      'or object to processing, and to data portability. Where processing is based on consent ' +
      'you may withdraw consent at any time without affecting prior lawful processing. ' +
      'You also have the right to lodge a complaint with {{supervisory_authority}}.',
  },
] as const
