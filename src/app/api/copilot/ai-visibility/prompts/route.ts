import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { getAiVisibilityPromptCap } from '@/lib/ai-visibility/config'
import { ensureDefaultPrompts, suggestPromptsForSite } from '@/lib/ai-visibility/run-citation-check'

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

async function authUser() {
  const cookieStore = cookies()
  const authClient = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get: (name: string) => cookieStore.get(name)?.value } },
  )
  const { data: { user } } = await authClient.auth.getUser()
  return user
}

/** GET ?siteId= — list prompts (+ suggestions if empty). */
export async function GET(req: NextRequest) {
  const user = await authUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const siteId = req.nextUrl.searchParams.get('siteId') || ''
  if (!siteId) return NextResponse.json({ error: 'siteId is required' }, { status: 400 })

  const supabase = serviceClient()
  const { data: site } = await supabase
    .from('connected_sites')
    .select('id, domain, brand')
    .eq('id', siteId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })

  const prompts = await ensureDefaultPrompts(supabase, user.id, siteId, site.brand, site.domain)
  return NextResponse.json({
    ok: true,
    prompts,
    promptCap: getAiVisibilityPromptCap(),
    suggestions: suggestPromptsForSite({ brand: site.brand, domain: site.domain }),
  })
}

/** POST { siteId, prompt } — add a prompt (respects cap). */
export async function POST(req: NextRequest) {
  const user = await authUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const siteId = typeof body.siteId === 'string' ? body.siteId : ''
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
  if (!siteId || !prompt) return NextResponse.json({ error: 'siteId and prompt required' }, { status: 400 })

  const supabase = serviceClient()
  const { count } = await supabase
    .from('ai_visibility_prompts')
    .select('id', { count: 'exact', head: true })
    .eq('site_id', siteId)
    .eq('user_id', user.id)
    .eq('is_active', true)

  if ((count || 0) >= getAiVisibilityPromptCap()) {
    return NextResponse.json(
      { error: `Prompt cap reached (${getAiVisibilityPromptCap()}). Deactivate one before adding.` },
      { status: 400 },
    )
  }

  const { data, error } = await supabase
    .from('ai_visibility_prompts')
    .upsert(
      {
        user_id: user.id,
        site_id: siteId,
        prompt,
        source: 'manual',
        is_active: true,
      },
      { onConflict: 'site_id,prompt' },
    )
    .select('id, prompt')
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true, prompt: data })
}

/** DELETE ?id= — deactivate a prompt. */
export async function DELETE(req: NextRequest) {
  const user = await authUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const id = req.nextUrl.searchParams.get('id') || ''
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const supabase = serviceClient()
  const { error } = await supabase
    .from('ai_visibility_prompts')
    .update({ is_active: false })
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
