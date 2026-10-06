import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import "./globals.css";
import { ROOT_METADATA } from "@/lib/site-metadata";

const outfit = Outfit({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  variable: "--font-outfit",
});

export const metadata: Metadata = ROOT_METADATA;

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
