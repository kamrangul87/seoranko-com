import { CompanyFooter } from '@/components/CompanyFooter'
import { MarketingNav } from '@/components/MarketingNav'

export function MarketingPage({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontFamily: "'Outfit', sans-serif", background: '#FAFAF8', color: '#0F0F0F', minHeight: '100vh' }}>
      <MarketingNav />
      {children}
      <CompanyFooter />
    </div>
  )
}
