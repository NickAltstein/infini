import type { Metadata } from "next";
import { Geist_Mono, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const plusJakarta = Plus_Jakarta_Sans({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AuditGPT — Cryptographic Proof for Every Autonomous Tool Call",
  description:
    "Deterministic fail-closed PreToolUse runtime hooks, Ed25519 execution receipts, and pre-merge CI blast-radius gating for autonomous AI agents.",
  keywords: [
    "AuditGPT",
    "Receiptd",
    "INFINI",
    "agent security",
    "cryptographic receipts",
    "PreToolUse",
    "MCP",
    "blast radius",
    "Claude Code",
    "AI agents",
  ],
  authors: [{ name: "Nick Altstein" }],
  openGraph: {
    title: "AuditGPT — Cryptographic Proof for Every Autonomous Tool Call",
    description: "Deterministic fail-closed PreToolUse runtime hooks, Ed25519 execution receipts, and pre-merge CI blast-radius gating for autonomous AI agents.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className="dark">
      <body
        className={`${plusJakarta.variable} ${geistMono.variable} antialiased`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
