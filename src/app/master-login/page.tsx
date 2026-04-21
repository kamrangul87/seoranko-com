"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function MasterLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/master", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (res.ok) {
        router.push("/dashboard");
      } else {
        const data = await res.json();
        setError(data.error ?? "Authentication failed");
      }
    } catch {
      setError("Network error — please try again");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center px-4" style={{ fontFamily: "'Outfit', sans-serif" }}>
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex items-center gap-2.5 justify-center mb-10">
          <div className="w-8 h-8 bg-[#f59e0b] rounded-[8px] flex items-center justify-center">
            <span className="text-[#0a0a0a] font-extrabold text-sm">S</span>
          </div>
          <span className="text-xl font-bold text-[#fafafa] tracking-tight">Seoranko</span>
        </div>

        <div className="bg-[#111111] border border-[#1f1f1f] rounded-[10px] p-8">
          <h1 className="text-xl font-bold text-[#fafafa] mb-1">Admin access</h1>
          <p className="text-[#6b7280] text-sm mb-7">Restricted area.</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[#fafafa] mb-1.5">
                Email
              </label>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@example.com"
                className="w-full bg-[#0a0a0a] border border-[#1f1f1f] focus:border-[#f59e0b] outline-none rounded-[8px] px-3 py-2.5 text-sm text-[#fafafa] placeholder-[#6b7280] transition-colors"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#fafafa] mb-1.5">
                Password
              </label>
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full bg-[#0a0a0a] border border-[#1f1f1f] focus:border-[#f59e0b] outline-none rounded-[8px] px-3 py-2.5 text-sm text-[#fafafa] placeholder-[#6b7280] transition-colors"
              />
            </div>

            {error && (
              <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-[8px] px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#f59e0b] hover:bg-[#d97706] disabled:opacity-60 disabled:cursor-not-allowed text-[#0a0a0a] font-bold text-sm py-3 rounded-[10px] transition-colors mt-2"
            >
              {loading ? "Authenticating…" : "Sign In"}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-[#6b7280] mt-6">
          This page is not publicly linked.
        </p>
      </div>
    </div>
  );
}
