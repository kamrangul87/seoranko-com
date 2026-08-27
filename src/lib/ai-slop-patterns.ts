// Shared AI-slop phrase detectors used by Quality Gate and the mechanical
// post-generation stripper. Keep the list in ONE place so generation-time
// cleanup and gate detection cannot drift.

/**
 * Patterns that flag stock AI transition / filler phrases.
 * Match with or without a trailing comma where the phrase commonly appears
 * both ways (models often drop the comma: "In other words the grant…").
 */
export const AI_SLOP_PATTERNS: RegExp[] = [
  /\bin today's (world|landscape|digital age|fast-paced)/i,
  /\bit('s| is) (worth noting|important to note|crucial to understand)/i,
  /\bin (conclusion|summary|this article|this guide|this piece)\b/i,
  /\bwe will (explore|delve into|dive into|examine|discuss)/i,
  /\blet('s| us) (explore|delve into|dive into|examine)/i,
  /\bcomprehensive (guide|overview|look|analysis)/i,
  /\bin the realm of/i,
  /\bleverage (your|our|the|this)/i,
  /\bdelve into/i,
  /\bfurthermore\b,?/i,
  /\bmoreover\b,?/i,
  /\bthe bottom line is/i,
  /\bit goes without saying/i,
  /\bneedless to say/i,
  /\bwithout further ado/i,
  /\bat the end of the day/i,
  // Comma optional — live articles ship "In other words the scheme…"
  /\bin other words\b,?/i,
  /\bto summarize\b,?/i,
  /\bto conclude\b,?/i,
  /\bto summarise\b,?/i,
]

/** Human-readable phrases for the write prompt (keep in sync with patterns). */
export const AI_SLOP_BANNED_PHRASES = [
  "It is worth noting",
  "It is important to",
  "In today's world",
  "When it comes to",
  "In the realm of",
  "Delve into",
  "Crucial",
  "Leverage",
  "Navigate",
  "Certainly",
  "In conclusion",
  "Furthermore",
  "Moreover",
  "In addition to this",
  "It goes without saying",
  "Needless to say",
  "At the end of the day",
  "This article will explore",
  "Let us examine",
  "To summarise",
  "To summarize",
  "To conclude",
  "In other words",
  "The bottom line is",
  "Without further ado",
] as const
