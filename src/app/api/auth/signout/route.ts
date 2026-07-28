import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();

  // Purge the legacy master-login cookie. The backdoor is gone, but
  // browsers that signed in through it still carry the cookie.
  cookies().delete("seoranko_master");

  const response = NextResponse.redirect(new URL("/login", request.url), {
    status: 303,
  });
  response.cookies.delete("seoranko_master");
  return response;
}
