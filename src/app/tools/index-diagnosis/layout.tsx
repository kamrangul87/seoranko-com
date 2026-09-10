import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Index Diagnosis — Free indexing crawl | Seoranko',
  description:
    'Enter a domain and get the top mechanical reasons pages may not be indexed — robots, noindex, canonicals, orphans, and more.',
}

export default function IndexDiagnosisToolLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
