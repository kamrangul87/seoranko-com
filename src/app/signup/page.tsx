"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// NOTE FOR DEPLOYMENT:
// Go to Supabase Dashboard → Authentication → Settings → Email →
// turn OFF "Enable email confirmations" for instant signup without email verification.

const PLANS = [
  { id: "free",    label: "Free",    price: "£0",      description: "5 keywords/day · 1 article/day" },
  { id: "starter", label: "Starter", price: "£19/mo",  description: "500 keywords · 30 articles/mo" },
  { id: "pro",     label: "Pro",     price: "£49/mo",  description: "2,000 keywords · 100 articles/mo" },
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
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    console.log('Supabase URL:', process.env.NEXT_PUBLIC_SUPABASE_URL);
    console.log('Supabase Key exists:', !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    // Timeout fallback: if still loading after TIMEOUT_MS, show hint
    timeoutRef.current = setTimeout(() => {
      setError("Taking too long? Check your connection and try again.");
      setLoading(false);
    }, TIMEOUT_MS);

    try {
      const supabase = createClient();

      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { name, plan } },
      });

      if (signUpError) {
        console.log('Supabase signup error:', signUpError);
        setError(signUpError.message);
        setLoading(false);
        return;
      }

      console.log('Supabase signup success:', data);

      if (data.user) {
        // upsert so re-signup attempts don't fail on duplicate key
        await supabase.from("user_profiles").upsert({
          id: data.user.id,
          email,
          name,
          plan,
        });
      }

      // Redirect immediately — works whether email confirmation is on or off.
      // If confirmation is required, Supabase will still create the user and
      // the cookie session will be set once they confirm.
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      router.push("/dashboard");

    } catch {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-4"
      style={{ fontFamily: "'Outfit', sans-serif" }}
    >
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-[#f59e0b] rounded-[8px] flex items-center justify-center">
              <span className="text-[#0a0a0a] font-extrabold text-sm">S</span>
            </div>
            <span className="font-bold text-xl tracking-tight text-[#fafafa]">Seoranko</span>
          </Link>
        </div>

        <div className="bg-[#111111] border border-[#1f1f1f] rounded-[12px] p-8">
          <h1 className="text-xl font-bold text-[#fafafa] mb-1">Create your account</h1>
          <p className="text-[#6b7280] text-sm mb-6">Start ranking on Google today</p>

          <form onSubmit={handleSignUp} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[#fafafa] mb-1.5">Full Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="Jane Smith"
                className="w-full bg-[#0a0a0a] border border-[#1f1f1f] rounded-[8px] px-4 py-2.5 text-sm text-[#fafafa] placeholder-[#6b7280] focus:outline-none focus:border-[#f59e0b]/50 transition-colors"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#fafafa] mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="you@example.com"
                className="w-full bg-[#0a0a0a] border border-[#1f1f1f] rounded-[8px] px-4 py-2.5 text-sm text-[#fafafa] placeholder-[#6b7280] focus:outline-none focus:border-[#f59e0b]/50 transition-colors"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#fafafa] mb-1.5">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                placeholder="Min. 6 characters"
                className="w-full bg-[#0a0a0a] border border-[#1f1f1f] rounded-[8px] px-4 py-2.5 text-sm text-[#fafafa] placeholder-[#6b7280] focus:outline-none focus:border-[#f59e0b]/50 transition-colors"
              />
            </div>

            {/* Plan selector */}
            <div>
              <label className="block text-sm font-medium text-[#fafafa] mb-2">Plan</label>
              <div className="grid grid-cols-3 gap-2">
                {PLANS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPlan(p.id)}
                    className={`flex flex-col items-center p-3 rounded-[8px] border text-center transition-all ${
                      plan === p.id
                        ? "border-[#f59e0b] bg-[#f59e0b]/5"
                        : "border-[#1f1f1f] hover:border-[#f59e0b]/40"
                    }`}
                  >
                    <span className="text-xs font-bold text-[#fafafa]">{p.label}</span>
                    <span className={`text-sm font-extrabold mt-0.5 ${plan === p.id ? "text-[#f59e0b]" : "text-[#6b7280]"}`}>
                      {p.price}
                    </span>
                    <span className="text-[10px] text-[#6b7280] leading-tight mt-1">{p.description}</span>
                  </button>
                ))}
              </div>
            </div>

            {error && (
              <div className="bg-[#ef4444]/10 border border-[#ef4444]/20 rounded-[8px] px-4 py-3">
                <p className="text-[#ef4444] text-sm">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#f59e0b] hover:bg-[#d97706] disabled:opacity-60 disabled:cursor-not-allowed text-[#0a0a0a] font-bold text-sm py-3 rounded-[8px] transition-colors flex items-center justify-center gap-2"
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
              <div className="w-full border-t border-[#1f1f1f]" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-[#111111] px-3 text-[#6b7280]">or</span>
            </div>
          </div>

          <p className="text-center text-sm text-[#6b7280]">
            Already have an account?{" "}
            <Link href="/login" className="text-[#f59e0b] hover:underline font-medium">
              Sign In
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
