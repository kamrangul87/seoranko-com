/**
 * Topic 1 Stage 4 fixture — only the slice covered by stages 1–3.
 *
 * Pages:
 * - /posts/a  — source HTML with four anchors (410, mailto, #, healthy 200)
 * - /gone     — returns 410
 * - /healthy  — returns 200
 */

export const FIXTURE_HOST = 'https://fixture.test'

export const SOURCE_PATH = '/posts/a'
export const GONE_PATH = '/gone'
export const HEALTHY_PATH = '/healthy'

export function sourcePageHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head><title>Fixture source</title></head>
  <body>
    <nav>
      <a href="${GONE_PATH}">Removed page</a>
      <a href="mailto:hello@fixture.test">Email us</a>
      <a href="#">Back to top</a>
      <a href="${HEALTHY_PATH}">Still here</a>
    </nav>
  </body>
</html>
`
}

export function healthyPageHtml(): string {
  return `<!doctype html><html><body><h1>Healthy</h1></body></html>`
}

export function gonePageBody(): string {
  return 'Gone'
}

/** Map of path → { status, body } for the fixture HTTP surface. */
export function fixtureResponses(): Record<
  string,
  { status: number; body: string }
> {
  return {
    [SOURCE_PATH]: { status: 200, body: sourcePageHtml() },
    [GONE_PATH]: { status: 410, body: gonePageBody() },
    [HEALTHY_PATH]: { status: 200, body: healthyPageHtml() },
  }
}
