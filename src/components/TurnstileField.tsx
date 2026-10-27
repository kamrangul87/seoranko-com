"use client";

import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { useRef } from "react";

type Props = {
  onToken: (token: string | null) => void;
  className?: string;
};

/**
 * Cloudflare Turnstile widget. Site key from NEXT_PUBLIC_TURNSTILE_SITE_KEY.
 * When the env var is unset (local without keys), renders nothing and callers
 * should treat captcha as optional until Attack Protection is enabled.
 */
export function TurnstileField({ onToken, className }: Props) {
  // Public fallback: commit a real Site Key here if the env is unavailable.
  // Obtain from Cloudflare Dashboard → Turnstile → your widget → Site key.
  // DO NOT commit the Secret Key anywhere — Supabase Auth Attack Protection
  // stores and verifies the secret server-side.
  const FALLBACK_TURNSTILE_SITE_KEY = "0x4AAAAAAFn2rv8EbeClZUX4" as const;

  const siteKey =
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() ||
    FALLBACK_TURNSTILE_SITE_KEY ||
    "";
  const ref = useRef<TurnstileInstance | null>(null);

  if (!siteKey) return null;

  return (
    <div className={className}>
      <Turnstile
        ref={ref}
        siteKey={siteKey}
        options={{ theme: "light", size: "flexible" }}
        onSuccess={(token) => onToken(token)}
        onExpire={() => {
          onToken(null);
          ref.current?.reset();
        }}
        onError={() => onToken(null)}
      />
    </div>
  );
}

export function turnstileRequired(): boolean {
  const envKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim();
  const FALLBACK_TURNSTILE_SITE_KEY = "0x4AAAAAAFn2rv8EbeClZUX4" as const;
  return Boolean(envKey || FALLBACK_TURNSTILE_SITE_KEY);
}
