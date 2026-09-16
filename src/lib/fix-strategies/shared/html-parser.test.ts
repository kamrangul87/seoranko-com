import { describe, expect, it } from 'vitest'
import { parseHtml } from './html-parser'

describe('parseHtml', () => {
  it('keeps title and meta in head for well-formed HTML', () => {
    const html = `<!DOCTYPE html>
<html>
<head>
  <title>Hello</title>
  <meta name="description" content="A page">
  <meta name="robots" content="index,follow">
</head>
<body>
  <p>Body copy</p>
  <meta name="should-not-count" content="body">
</body>
</html>`

    const doc = parseHtml(html)
    expect(doc.titleText()).toBe('Hello')
    expect(doc.metaByName('description')?.attrs.content).toBe('A page')
    expect(doc.metaByName('robots')?.attrs.content).toBe('index,follow')
    expect(doc.headElements('meta')).toHaveLength(2)
    expect(doc.bodyElements('meta')).toHaveLength(1)
    expect(doc.queryHead('title')[0]?.textContent).toBe('Hello')
  })

  it('CRITICAL: div before </head> implicitly closes head; following meta is NOT in head', () => {
    // A body-content element (<div>) before </head> closes head per the HTML
    // parsing algorithm. Regex-based "everything before </head>" would wrongly
    // treat the trailing <meta> as a head tag — parse5 must not.
    const html = `<!DOCTYPE html>
<html>
<head>
  <title>In head</title>
  <div id="premature">closes head</div>
  <meta name="robots" content="noindex">
</head>
<body>
  <p>hi</p>
</body>
</html>`

    const doc = parseHtml(html)

    expect(doc.titleText()).toBe('In head')
    expect(doc.headElements('div')).toHaveLength(0)
    expect(doc.bodyElements('div')).toHaveLength(1)
    expect(doc.bodyElements('div')[0]?.attrs.id).toBe('premature')

    // The meta after the div must NOT be treated as in head.
    expect(doc.headElements('meta')).toHaveLength(0)
    expect(doc.metaByName('robots')).toBeNull()
    expect(doc.bodyElements('meta')).toHaveLength(1)
    expect(doc.bodyElements('meta')[0]?.attrs.name).toBe('robots')
  })
})
