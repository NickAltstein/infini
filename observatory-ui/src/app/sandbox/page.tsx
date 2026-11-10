import type { Metadata } from "next";
import { BlastRadiusSimulator } from "@/features/blast-radius-simulator";

export const metadata: Metadata = {
  title: "Birkin Blast-Radius Simulator & Deterministic Interceptor",
  description:
    "Interactive adversarial MCP attack vector simulator, RFC-8785 deterministic canonicalization, WebCrypto Ed25519 execution receipts, and SHA-256 Merkle audit ledgers.",
};

export default function SandboxPage() {
  return (
    <main className="min-h-screen bg-[#0B0D11] text-[#F3F4F6] selection:bg-[#38BDF8]/20 selection:text-[#38BDF8]">
      <BlastRadiusSimulator />
    </main>
  );
}

