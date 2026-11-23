import type { Metadata } from 'next'
import { FORGOT_PASSWORD_METADATA } from '@/lib/site-metadata'

export const metadata: Metadata = FORGOT_PASSWORD_METADATA

export default function ForgotPasswordLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
