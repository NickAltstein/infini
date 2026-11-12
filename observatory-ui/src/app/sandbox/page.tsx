import type { Metadata } from "next";
import { BlastRadiusSimulator } from "@/features/blast-radius-simulator";

export const metadata: Metadata = {
  title: "AuditGPT Sandbox — Browser-Side Policy Simulation for Hooked Tool Calls",
  description:
    "Interactive adversarial MCP attack vector simulator, canonical JSON (sorted keys), WebCrypto Ed25519 execution receipts, and SHA-256 Merkle audit ledgers.",
};

export default function SandboxPage() {
  return (
    <main className="min-h-screen bg-[#0B0D11] text-[#F3F4F6] selection:bg-[#38BDF8]/20 selection:text-[#38BDF8]">
      <BlastRadiusSimulator />
    </main>
  );
}

