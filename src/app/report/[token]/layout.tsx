import type { Metadata } from 'next'
import { REPORT_METADATA } from '@/lib/site-metadata'

export const metadata: Metadata = REPORT_METADATA

export default function ReportLayout({ children }: { children: React.ReactNode }) {
  return children
}
