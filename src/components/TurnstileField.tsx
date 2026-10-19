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
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() || "";
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
  return Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim());
}
