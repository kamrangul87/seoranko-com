export function sanitiseForTransport(text: string): string {
  return text
    .replace(/—/g, '--')      // em dash → --
    .replace(/–/g, '-')       // en dash → -
    .replace(/‘|’/g, "'") // smart single quotes → '
    .replace(/“|”/g, '"') // smart double quotes → "
    .replace(/…/g, '...')     // ellipsis → ...
    .replace(/ /g, ' ')       // non-breaking space → space
    .replace(/[^\x00-\x7F]/g, (char) => {
      // For any remaining non-ASCII, strip characters above U+00FF
      const code = char.charCodeAt(0)
      return code > 255 ? '' : char
    })
}

export function sanitiseForDisplay(text: string): string {
  // Keeps Unicode intact for display — only use sanitiseForTransport for HTTP/DB calls
  return text.trim()
}
