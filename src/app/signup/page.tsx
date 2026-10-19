"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { SEORANKO_PLANS, SEORANKO_FREE_PLAN } from "@/lib/stripe/plans";
import { SeorankoWordmark } from "@/components/SeorankoLogo";
import { TurnstileField, turnstileRequired } from "@/components/TurnstileField";

// Email confirmation is ON (Supabase Dashboard → Authentication → Settings →
// Email). The signup API returns session: null until the user clicks the
// confirmation link — see the confirmationSent branch in handleSignUp.
// Requires a working SMTP config (docs/AUTH_EMAIL.md) or confirmation
// emails never arrive and every signup is silently stuck.
//
// Bot gate: Cloudflare Turnstile (captchaToken → Supabase Auth) + server-side
// display-name / per-IP checks in POST /api/auth/signup.

const PLANS = [
  { id: SEORANKO_FREE_PLAN.id, label: SEORANKO_FREE_PLAN.label, price: SEORANKO_FREE_PLAN.priceDisplay, description: SEORANKO_FREE_PLAN.tagline },
  ...Object.values(SEORANKO_PLANS).map((p) => ({ id: p.id, label: p.label, price: p.priceDisplay, description: p.tagline })),
];

const TIMEOUT_MS = 8000;

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [plan, setPlan] = useState("free");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [confirmationSent, setConfirmationSent] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    if (turnstileRequired() && !captchaToken) {
      setError("Please complete the security check.");
      setLoading(false);
      return;
    }

    timeoutRef.current = setTimeout(() => {
      setError("Taking too long? Check your connection and try again.");
      setLoading(false);
    }, TIMEOUT_MS);

    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          password,
          plan,
          captchaToken: captchaToken || undefined,
          emailRedirectTo: `${window.location.origin}/dashboard`,
        }),
      });

      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
        session?: { access_token: string; refresh_token?: string } | null;
      };

      if (!res.ok) {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        setError(payload.error || "Sign-up failed. Please try again.");
        setLoading(false);
        setCaptchaToken(null);
        return;
      }

      if (timeoutRef.current) clearTimeout(timeoutRef.current);

      if (!payload.session) {
        setConfirmationSent(true);
        setLoading(false);
        return;
      }

      // Confirmation off / pre-confirmed — establish browser session from API tokens.
      if (payload.session.access_token && payload.session.refresh_token) {
        const supabase = createClient();
        await supabase.auth.setSession({
          access_token: payload.session.access_token,
          refresh_token: payload.session.refresh_token,
        });
      }
      router.push("/dashboard");
    } catch {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setError("Something went wrong. Please try again.");
      setLoading(false);
      setCaptchaToken(null);
    }
  }

  return (
    <div
      className="min-h-screen bg-[#FAFAF8] flex items-center justify-center p-4"
      style={{ fontFamily: "'Outfit', sans-serif" }}
    >
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-8">
          <Link href="/" className="flex items-center gap-2.5">
            <SeorankoWordmark size={32} textStyle={{ fontSize: 20 }} />
          </Link>
        </div>

        <div className="bg-white border border-[#E8E8E4] rounded-[12px] p-8 shadow-sm">
          {confirmationSent ? (
            <div className="text-center py-4">
              <h1 className="text-xl font-bold text-[#0F0F0F] mb-2">Check your email</h1>
              <p className="text-[#6B6B6B] text-sm">
                We sent a confirmation link to <span className="font-medium text-[#0F0F0F]">{email}</span>.
                Click it to activate your account, then come back and sign in.
              </p>
              <Link href="/login" className="inline-block mt-6 text-[#FF6B2C] hover:underline text-sm font-medium">
                Back to sign in
              </Link>
            </div>
          ) : (
            <>
          <h1 className="text-xl font-bold text-[#0F0F0F] mb-1">Create your account</h1>
          <p className="text-[#6B6B6B] text-sm mb-6">Audit your site and start fixing today</p>

          <form onSubmit={handleSignUp} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[#0F0F0F] mb-1.5">Full Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="Jane Smith"
                className="w-full bg-white border border-[#E8E8E4] rounded-[8px] px-4 py-2.5 text-sm text-[#0F0F0F] placeholder-[#9B9B9B] focus:outline-none focus:border-[#FF6B2C] transition-colors"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#0F0F0F] mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="you@example.com"
                className="w-full bg-white border border-[#E8E8E4] rounded-[8px] px-4 py-2.5 text-sm text-[#0F0F0F] placeholder-[#9B9B9B] focus:outline-none focus:border-[#FF6B2C] transition-colors"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#0F0F0F] mb-1.5">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                placeholder="Min. 6 characters"
                className="w-full bg-white border border-[#E8E8E4] rounded-[8px] px-4 py-2.5 text-sm text-[#0F0F0F] placeholder-[#9B9B9B] focus:outline-none focus:border-[#FF6B2C] transition-colors"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#0F0F0F] mb-2">Plan</label>
              <div className="grid grid-cols-2 gap-2">
                {PLANS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPlan(p.id)}
                    className={`flex flex-col items-center p-3 rounded-[8px] border text-center transition-all ${
                      plan === p.id
                        ? "border-[#FF6B2C] bg-[#FF6B2C]/5"
                        : "border-[#E8E8E4] hover:border-[#FF6B2C]/40"
                    }`}
                  >
                    <span className="text-xs font-bold text-[#0F0F0F]">{p.label}</span>
                    <span className={`text-sm font-extrabold mt-0.5 ${plan === p.id ? "text-[#FF6B2C]" : "text-[#6B6B6B]"}`}>
                      {p.price}
                    </span>
                    <span className="text-[10px] text-[#9B9B9B] leading-tight mt-1">{p.description}</span>
                  </button>
                ))}
              </div>
            </div>

            <TurnstileField onToken={setCaptchaToken} />

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-[8px] px-4 py-3">
                <p className="text-red-600 text-sm">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || (turnstileRequired() && !captchaToken)}
              className="w-full bg-[#FF6B2C] hover:bg-[#E85A1E] disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold text-sm py-3 rounded-[8px] transition-colors flex items-center justify-center gap-2"
            >
              {loading && (
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              )}
              {loading ? "Creating account…" : "Create Account"}
            </button>
          </form>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-[#E8E8E4]" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-white px-3 text-[#9B9B9B]">or</span>
            </div>
          </div>

          <p className="text-center text-sm text-[#6B6B6B]">
            Already have an account?{" "}
            <Link href="/login" className="text-[#FF6B2C] hover:underline font-medium">
              Sign In
            </Link>
          </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
