import { redirect } from 'next/navigation'

/**
 * Article Write station removed in the SEO copilot pivot.
 * Full pipeline preserved on branch `article-writing-feature-backup`.
 */
export default function WritePageRemoved() {
  redirect('/dashboard/audit')
}
