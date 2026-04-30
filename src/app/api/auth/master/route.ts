import { NextResponse } from "next/server";
import { createHash } from "crypto";

const COOKIE_NAME = "seoranko_master";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function signToken(email: string): string {
  const secret = process.env.MASTER_PASSWORD ?? "";
  return createHash("sha256").update(`${email}:${secret}:master`).digest("hex");
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { email?: string; password?: string };
  const { email, password } = body;

  const masterEmail = process.env.MASTER_EMAIL;
  const masterPassword = process.env.MASTER_PASSWORD;

  if (!masterEmail || !masterPassword) {
    console.log("[master-login] MASTER_EMAIL set:", !!masterEmail, "| MASTER_PASSWORD set:", !!masterPassword);
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }

  console.log("[master-login] attempt — email match:", email === masterEmail, "| password match:", password === masterPassword);

  if (email !== masterEmail || password !== masterPassword) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const token = signToken(masterEmail);
  const response = NextResponse.json({ success: true });

  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  });

  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ success: true });
  response.cookies.delete(COOKIE_NAME);
  return response;
}
