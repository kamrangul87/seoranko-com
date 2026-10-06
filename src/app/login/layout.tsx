import type { Metadata } from 'next'
import { LOGIN_METADATA } from '@/lib/site-metadata'

export const metadata: Metadata = LOGIN_METADATA

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children
}
