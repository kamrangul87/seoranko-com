import type { Metadata } from 'next'
import { SIGNUP_METADATA } from '@/lib/site-metadata'

export const metadata: Metadata = SIGNUP_METADATA

export default function SignupLayout({ children }: { children: React.ReactNode }) {
  return children
}
