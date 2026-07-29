import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Serves the one-line script the user pastes into their <head>.
// Keyed by the site's secret universal_tag_token — never the raw site UUID.

export async function GET(
  req: NextRequest,
  { params }: { params: { siteToken: string } }
) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: site } = await supabase
    .from('connected_sites')
    .select('id')
    .eq('universal_tag_token', params.siteToken)
    .maybeSingle()

  const jsHeaders = {
    'Content-Type': 'application/javascript; charset=utf-8',
    // Short cache so revoking a tag takes effect quickly.
    'Cache-Control': 'public, max-age=300'
  }

  if (!site) {
    return new NextResponse('console.warn("SEORANKO: invalid site token");', { headers: jsHeaders })
  }

  // Derive the origin from this request so the tag works on preview
  // deployments and custom domains, not just seoranko.com.
  const origin = req.nextUrl.origin
  const token = encodeURIComponent(params.siteToken)

  const js = `(function () {
  try {
    var u = window.location.origin + window.location.pathname;
    u = u.replace(/\\/+$/, '');
    var endpoint = ${JSON.stringify(origin)} + '/api/universal-tag/fixes?token=${token}&url=' + encodeURIComponent(u);
    fetch(endpoint, { credentials: 'omit' })
      .then(function (r) { return r.ok ? r.json() : { fixes: [] }; })
      .then(function (data) {
        (data.fixes || []).forEach(function (fix) {
          if (fix.type !== 'schema') return;
          if (document.querySelector('script[data-seoranko="' + fix.id + '"]')) return;
          var s = document.createElement('script');
          s.type = 'application/ld+json';
          s.setAttribute('data-seoranko', fix.id);
          s.textContent = JSON.stringify(fix.payload);
          document.head.appendChild(s);
        });
      })
      .catch(function () {});
  } catch (e) {}
})();`

  return new NextResponse(js, { headers: jsHeaders })
}
