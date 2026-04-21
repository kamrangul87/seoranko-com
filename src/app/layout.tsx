import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import "./globals.css";

const outfit = Outfit({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  variable: "--font-outfit",
});

export const metadata: Metadata = {
  title: "Seoranko — AI-Powered SEO Content That Actually Ranks",
  description:
    "Generate EEAT-compliant, humanised SEO articles backed by real keyword data. Built for content teams who want to rank faster.",
  keywords: ["SEO", "AI content", "keyword research", "EEAT", "content marketing"],
  openGraph: {
    title: "Seoranko — AI-Powered SEO Content",
    description: "Generate EEAT-compliant SEO articles that rank",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={outfit.variable}>
      <body className="font-outfit bg-background text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
