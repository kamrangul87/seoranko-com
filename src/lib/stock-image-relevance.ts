/**
 * Stock-photo query + relevance helpers.
 * Prevents ambiguous terms like "charger" matching phone/tablet product shots
 * when the article is about EV / vehicle charging.
 */

const CONSUMER_ELECTRONICS = [
  'iphone', 'ipad', 'airpods', 'earbuds', 'earphone', 'smartphone', 'smart phone',
  'mobile phone', 'cell phone', 'tablet', 'laptop', 'macbook', 'apple watch',
  'usb cable', 'lightning cable', 'wireless earbuds', 'gadget', 'headphones',
]

const EV_TOPIC = /\b(ev|electric\s*vehicle|wallbox|evse|chargepoint|home\s*charg|car\s*charg|vehicle\s*charg)\b/i

export function isEvChargingTopic(keyword: string, prompt = ''): boolean {
  const blob = `${keyword} ${prompt}`
  if (EV_TOPIC.test(blob)) return true
  // "ev charger", "EV chargers UK", etc.
  if (/\bev\b/i.test(keyword) && /charg/i.test(keyword)) return true
  return false
}

export function mentionsConsumerElectronics(text: string): boolean {
  const lower = text.toLowerCase()
  return CONSUMER_ELECTRONICS.some(term => lower.includes(term))
}

/** Build a stock search query that keeps the keyword subject, not style fluff. */
export function buildStockSearchQuery(keyword: string, fullPrompt: string): string {
  const clauses = fullPrompt
    .split(',')
    .map(c => c.trim())
    .filter(Boolean)
    .filter(c => !/no text|no logos|no watermarks|shallow depth|natural light|editorial|professional photography/i.test(c))

  const subject = clauses.slice(0, 2).join(' ')
    .replace(/close-up of|wide angle|overhead view|detail shot of|modern|professional|residential/gi, '')
    .trim()

  if (isEvChargingTopic(keyword, fullPrompt)) {
    // Force vehicle context — bare "charger" returns iPhone cables on Pexels/Unsplash
    const base = /wallbox|electric vehicle|ev charger|charging station|charge point/i.test(subject)
      ? subject
      : `electric vehicle wallbox charger ${subject || keyword}`
    return base.replace(/\s+/g, ' ').trim().slice(0, 90)
  }

  const withKeyword = subject.toLowerCase().includes(keyword.toLowerCase().slice(0, 12))
    ? subject
    : `${keyword} ${subject}`.trim()
  return withKeyword.replace(/\s+/g, ' ').trim().slice(0, 90)
}

export function stockRelevanceScore(altText: string, keyword: string, prompt: string): number {
  if (!altText) return 0
  const alt = altText.toLowerCase()

  if (isEvChargingTopic(keyword, prompt) && mentionsConsumerElectronics(alt)) {
    return -100 // hard reject phone/tablet "charger" shots
  }

  const intentTerms = new Set(
    `${keyword} ${prompt}`
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3 && !['with', 'from', 'that', 'this', 'professional', 'natural', 'lighting'].includes(w))
  )

  const altTerms = new Set(alt.split(/\s+/).filter(w => w.length > 3))
  let score = Array.from(intentTerms).filter(t => altTerms.has(t) || alt.includes(t)).length

  if (isEvChargingTopic(keyword, prompt)) {
    if (/\b(ev|electric|vehicle|car|wallbox|charging station|charge point)\b/i.test(alt)) score += 3
    if (/\b(phone|tablet|cable|usb|earbud)\b/i.test(alt)) score -= 5
  }

  return score
}

export function isAcceptableStockPhoto(altText: string, keyword: string, prompt: string): boolean {
  return stockRelevanceScore(altText, keyword, prompt) >= 0
}
