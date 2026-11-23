import type { Metadata } from 'next'
import { HOME_METADATA } from '@/lib/site-metadata'

export const metadata: Metadata = HOME_METADATA

export default function HomeLayout({ children }: { children: React.ReactNode }) {
  return children
}
