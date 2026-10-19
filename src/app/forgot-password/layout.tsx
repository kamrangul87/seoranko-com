import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Forgot password — SEORANKO',
  description: 'Reset your SEORANKO account password.',
}

export default function ForgotPasswordLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
