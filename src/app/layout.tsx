import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";
import { ROOT_METADATA } from "@/lib/site-metadata";
import { AuthHashHandler } from "@/components/AuthHashHandler";
import { AUTH_HASH_CAPTURE_SCRIPT } from "@/lib/auth/auth-hash";

export const metadata: Metadata = ROOT_METADATA;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="bg-background text-foreground antialiased">
        <Script id="seoranko-auth-hash" strategy="beforeInteractive">
          {AUTH_HASH_CAPTURE_SCRIPT}
        </Script>
        <AuthHashHandler />
        {children}
      </body>
    </html>
  );
}
