"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      setError(signInError.message);
      setLoading(false);
    } else {
      router.push("/dashboard");
      router.refresh();
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
          <h1 className="text-xl font-bold text-[#fafafa] mb-1">Welcome back</h1>
          <p className="text-[#6b7280] text-sm mb-6">Sign in to your account</p>

          <form onSubmit={handleSignIn} className="space-y-4">
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
                placeholder="••••••••"
                className="w-full bg-[#0a0a0a] border border-[#1f1f1f] rounded-[8px] px-4 py-2.5 text-sm text-[#fafafa] placeholder-[#6b7280] focus:outline-none focus:border-[#f59e0b]/50 transition-colors"
              />
            </div>

            {error && (
              <div className="bg-[#ef4444]/10 border border-[#ef4444]/20 rounded-[8px] px-4 py-3">
                <p className="text-[#ef4444] text-sm">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#f59e0b] hover:bg-[#d97706] disabled:opacity-60 disabled:cursor-not-allowed text-[#0a0a0a] font-bold text-sm py-3 rounded-[8px] transition-colors"
            >
              {loading ? "Signing in…" : "Sign In"}
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
            Don&apos;t have an account?{" "}
            <Link href="/signup" className="text-[#f59e0b] hover:underline font-medium">
              Sign Up
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
