/**
 * Copy-to-clipboard and download helpers for briefs and manual fix output.
 */

import type { ManualFixPayload, ManualFixSnippet } from '@/lib/index-diagnosis/types'

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export interface BriefMarkdownInput {
  seedKeyword: string
  suggestedTitle: string
  intent: string
  mode: string
  strategistNotes: string[]
  sections: Array<{
    heading: string
    level: string
    guidance: string
    primaryKeywordPlacement?: string
    secondaryKeywordPlacement?: string
    needsCitation?: boolean
    citationNote?: string
  }>
  badge?: string
}

export function briefToMarkdown(b: BriefMarkdownInput): string {
  const lines: string[] = []
  if (b.badge) lines.push(`> ${b.badge}`, '')
  lines.push(`# ${b.suggestedTitle}`, '')
  lines.push(`**Seed:** ${b.seedKeyword}`, `**Mode:** ${b.mode}`, `**Intent:** ${b.intent}`, '')
  if (b.strategistNotes.length) {
    lines.push('## Strategist notes', '')
    for (const n of b.strategistNotes) lines.push(`- ${n}`)
    lines.push('')
  }
  for (const s of b.sections) {
    const prefix = s.level === 'h1' ? '#' : s.level === 'h3' ? '###' : '##'
    lines.push(`${prefix} ${s.heading}`, '', s.guidance, '')
    const placement = [s.primaryKeywordPlacement, s.secondaryKeywordPlacement].filter(Boolean).join(' · ')
    if (placement) lines.push(`*Placement:* ${placement}`, '')
    if (s.needsCitation) lines.push(`*Needs real source:* ${s.citationNote || 'Add an official citation before publishing.'}`, '')
  }
  return lines.join('\n').trim() + '\n'
}

export function manualFixToText(
  fix: ManualFixPayload,
  opts?: {
    platform?: string
    platformSteps?: string[]
    pasteFixOutput?: string
  },
): string {
  const lines: string[] = [fix.evidenceCitation, '']
  if (fix.removeLinkGuidance) {
    lines.push(fix.removeLinkGuidance, '')
  }
  if (opts?.platformSteps?.length) {
    lines.push(`Platform: ${opts.platform || 'selected'}`, '')
    for (const step of opts.platformSteps) {
      lines.push(step, '---', '')
    }
  }
  if (opts?.pasteFixOutput) {
    lines.push('Paste-and-fix output:', '', opts.pasteFixOutput, '')
  }
  for (const s of fix.snippets) {
    lines.push(`## ${s.label}`, '', s.content, '')
  }
  return lines.join('\n').trim() + '\n'
}

export function snippetsToText(snippets: ManualFixSnippet[]): string {
  return snippets.map((s) => `## ${s.label}\n\n${s.content}`).join('\n\n---\n\n')
}
