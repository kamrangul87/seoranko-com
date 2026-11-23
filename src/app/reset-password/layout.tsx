import type { Metadata } from 'next'
import { RESET_PASSWORD_METADATA } from '@/lib/site-metadata'

export const metadata: Metadata = RESET_PASSWORD_METADATA

export default function ResetPasswordLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
