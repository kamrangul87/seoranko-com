/**
 * Realistic autodun.com-shaped HTML for tests.
 * Relative nav + .html blog URLs, clean marketing URLs, and subdomain tools.
 * Not a copy of live content — structure only.
 */

export const AUTODUN_LIKE_ORIGIN = 'https://autodun.com'

export const AUTODUN_LIKE_HOME_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Autodun | Free AI Vehicle Tools</title>
    <meta name="robots" content="index, follow" />
    <link rel="canonical" href="https://autodun.com/" />
    <script type="module" src="/assets/index-app.js"></script>
  </head>
  <body>
    <div id="root">
      <h1>Autodun | Free AI Vehicle Tools</h1>
      <nav aria-label="Site">
        <p>Tools: <a href="https://ev.autodun.com">EV Charger Finder</a> and <a href="https://mot.autodun.com">MOT Risk Predictor</a>.</p>
        <ul>
          <li><a href="/blog">Blog</a></li>
          <li><a href="/about">About Autodun</a></li>
          <li><a href="/contact">Contact</a></li>
          <li><a href="/privacy">Privacy Policy</a></li>
        </ul>
        <h2>Popular guides</h2>
        <ul>
          <li><a href="/blog/mot-history-check-uk.html">MOT History Check UK</a></li>
          <li><a href="/blog/mot-cost-uk-2026.html">MOT Cost in the UK 2026</a></li>
          <li><a href="/blog/electric-car-charger-map-uk.html">Electric Car Charger Map UK</a></li>
        </ul>
      </nav>
    </div>
  </body>
</html>
`

export const AUTODUN_LIKE_BLOG_INDEX_HTML = `<!doctype html>
<html lang="en">
  <head><title>Blog</title></head>
  <body>
    <h1>Blog</h1>
    <nav><a href="/">Home</a><a href="/about">About</a></nav>
    <ul>
      <li><a href="/blog/mot-history-check-uk.html">MOT History Check UK</a></li>
      <li><a href="/blog/mot-cost-uk-2026.html">MOT Cost in the UK 2026</a></li>
      <li><a href="/blog/mot-advisories-explained-uk.html">MOT Advisories Explained</a></li>
      <li><a href="/blog/electric-car-charger-map-uk.html">Electric Car Charger Map UK</a></li>
      <li><a href="/blog/ev-charging-on-uk-motorways.html">EV Charging on UK Motorways</a></li>
    </ul>
  </body>
</html>
`

export const AUTODUN_LIKE_POST_HTML = `<!doctype html>
<html lang="en">
  <head><title>MOT Cost in the UK 2026</title></head>
  <body>
    <h1>MOT Cost in the UK 2026</h1>
    <nav><a href="/">Home</a><a href="/blog">Blog</a></nav>
    <p>See also <a href="/blog/mot-history-check-uk.html">MOT history check</a>
    and the <a href="https://www.autodun.com/about">about page</a>.</p>
  </body>
</html>
`

export const AUTODUN_LIKE_JOBS: Array<{
  url: string
  status: string
  httpStatus: number
  finalUrl: string
  html: string
}> = [
  {
    url: 'https://autodun.com/',
    status: 'crawled',
    httpStatus: 200,
    finalUrl: 'https://autodun.com/',
    html: AUTODUN_LIKE_HOME_HTML,
  },
  {
    url: 'https://autodun.com/about',
    status: 'crawled',
    httpStatus: 200,
    finalUrl: 'https://autodun.com/about',
    html: `<html><head><title>About Autodun</title></head><body><h1>About Autodun</h1><a href="/">Home</a><a href="/blog">Blog</a></body></html>`,
  },
  {
    url: 'https://autodun.com/blog',
    status: 'crawled',
    httpStatus: 200,
    finalUrl: 'https://autodun.com/blog',
    html: AUTODUN_LIKE_BLOG_INDEX_HTML,
  },
  {
    url: 'https://autodun.com/blog/mot-cost-uk-2026.html',
    status: 'crawled',
    httpStatus: 200,
    finalUrl: 'https://autodun.com/blog/mot-cost-uk-2026.html',
    html: AUTODUN_LIKE_POST_HTML,
  },
  {
    url: 'https://autodun.com/blog/mot-history-check-uk.html',
    status: 'crawled',
    httpStatus: 200,
    finalUrl: 'https://autodun.com/blog/mot-history-check-uk.html',
    html: `<html><head><title>MOT History Check UK</title></head><body><h1>MOT History Check UK</h1><a href="/blog">Blog</a></body></html>`,
  },
  {
    url: 'https://autodun.com/contact',
    status: 'crawled',
    httpStatus: 200,
    finalUrl: 'https://autodun.com/contact',
    html: `<html><head><title>Contact</title></head><body><h1>Contact Autodun</h1><a href="/">Home</a></body></html>`,
  },
  {
    url: 'https://autodun.com/privacy',
    status: 'crawled',
    httpStatus: 200,
    finalUrl: 'https://autodun.com/privacy',
    html: `<html><head><title>Privacy Policy</title></head><body><h1>Privacy Policy</h1><a href="/">Home</a></body></html>`,
  },
]
