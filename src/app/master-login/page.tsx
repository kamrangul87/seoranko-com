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
    <div className="min-h-screen bg-[#FAFAF8] flex items-center justify-center px-4" style={{ fontFamily: "'Outfit', sans-serif" }}>
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2.5 justify-center mb-10">
          <div className="w-8 h-8 bg-[#FF6B2C] rounded-[8px] flex items-center justify-center">
            <span className="text-white font-extrabold text-sm">S</span>
          </div>
          <span className="text-xl font-bold text-[#0F0F0F] tracking-tight">Seoranko</span>
        </div>

        <div className="bg-white border border-[#E8E8E4] rounded-[10px] p-8 shadow-sm">
          <h1 className="text-xl font-bold text-[#0F0F0F] mb-1">Admin access</h1>
          <p className="text-[#6B6B6B] text-sm mb-7">Restricted area.</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[#0F0F0F] mb-1.5">
                Email
              </label>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@example.com"
                className="w-full bg-white border border-[#E8E8E4] focus:border-[#FF6B2C] outline-none rounded-[8px] px-3 py-2.5 text-sm text-[#0F0F0F] placeholder-[#9B9B9B] transition-colors"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#0F0F0F] mb-1.5">
                Password
              </label>
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full bg-white border border-[#E8E8E4] focus:border-[#FF6B2C] outline-none rounded-[8px] px-3 py-2.5 text-sm text-[#0F0F0F] placeholder-[#9B9B9B] transition-colors"
              />
            </div>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-[8px] px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#FF6B2C] hover:bg-[#E85A1E] disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold text-sm py-3 rounded-[10px] transition-colors mt-2"
            >
              {loading ? "Authenticating…" : "Sign In"}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-[#9B9B9B] mt-6">
          This page is not publicly linked.
        </p>
      </div>
    </div>
  );
}
