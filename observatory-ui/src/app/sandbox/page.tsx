import type { Metadata } from "next";
import SandboxView from "@/sandbox/sandbox-view";

export const metadata: Metadata = {
  title: "Blast-Radius Sandbox — INFINI Observatory",
  description:
    "In-browser MCP interceptor with Ed25519 or HMAC receipts, canonical JSON, and Merkle tamper detection.",
};

export default function SandboxPage() {
  return <SandboxView homeHref="/" />;
}
