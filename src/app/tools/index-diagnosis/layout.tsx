import type { Metadata } from 'next'
import { INDEX_DIAGNOSIS_METADATA } from '@/lib/site-metadata'

export const metadata: Metadata = INDEX_DIAGNOSIS_METADATA

export default function IndexDiagnosisToolLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
