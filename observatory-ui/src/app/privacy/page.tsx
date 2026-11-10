import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy | AuditGPT",
  description: "Privacy Policy for the AuditGPT platform, CLI tools, and Receiptd runtime components.",
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-[#0B0D11] text-slate-300 font-sans px-6 py-12">
      <div className="max-w-3xl mx-auto space-y-8">
        <div className="border-b border-[#222733] pb-6 flex items-center justify-between">
          <Link
            href="/"
            className="font-mono text-xs text-[#38BDF8] hover:underline flex items-center gap-1.5"
          >
            &larr; Back to AuditGPT Sandbox
          </Link>
          <span className="font-mono text-xs text-slate-500">Legal / Privacy</span>
        </div>

        <div className="space-y-2">
          <h1 className="font-serif text-3xl sm:text-4xl text-white font-normal">
            AuditGPT Privacy Policy
          </h1>
          <p className="font-mono text-xs text-slate-500">
            Last Updated: November 10, 2026 &bull; Effective Date: November 10, 2026
          </p>
        </div>

        <div className="prose prose-invert prose-slate text-sm leading-relaxed space-y-6">
          <p>
            AuditGPT Inc. (&quot;we,&quot; &quot;our,&quot; or &quot;us&quot;) is committed to protecting your privacy. This Privacy Policy explains how we handle information when you use our website (<code className="text-sky-300 font-mono text-xs">auditgpt.ai</code>), CLI tools, and GitHub integrations.
          </p>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-emerald-400 font-mono uppercase tracking-wide">
              1. Local-First Architecture: CLI &amp; GitHub Actions
            </h2>
            <p className="text-white font-medium">
              The CLI tools, GitHub Actions, and Receiptd runtime hooks execute 100% locally and send zero data off your machine.
            </p>
            <ul className="list-disc list-inside space-y-1.5 text-slate-400">
              <li>When you run the CLI tools or wire <code className="text-emerald-400 font-mono text-xs">Receiptd</code> runtime hooks (<code className="text-sky-300 font-mono text-xs">PreToolUse</code>), your agent prompts, tool arguments, environment variables (<code className="text-sky-300 font-mono text-xs">.env</code>), API keys, and execution traces <strong>never leave your local runner or private GitHub Actions runner</strong>.</li>
              <li>The CLI tools and GitHub Actions send no telemetry, prompts, codebase contents, or credentials to any remote server.</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-white font-mono uppercase tracking-wide">
              2. Website Operations &amp; Logging (auditgpt.ai)
            </h2>
            <p>
              When you visit the <code className="text-sky-300 font-mono text-xs">auditgpt.ai</code> website:
            </p>
            <ul className="list-disc list-inside space-y-1.5 text-slate-400">
              <li><strong>Interactive Simulator State:</strong> The Blast-Radius Simulator executes entirely in your browser via client-side WebCrypto. Execution state, simulated vectors, and hashes remain in your browser memory and URL parameters; they are not sent to or stored on our servers.</li>
              <li><strong>Standard Server Request Logs:</strong> Like virtually all web hosts, our hosting provider (Vercel) automatically records standard HTTP request metadata (IP addresses, browser user-agent, referrers, and request timestamps) strictly for routing, CDN caching, performance monitoring, and security defense.</li>
              <li><strong>Account &amp; Commercial Billing:</strong> If you register for commercial support tiers, payment processing and billing records are handled directly by our payment processor (Stripe). We never store raw payment card credentials.</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-white font-mono uppercase tracking-wide">
              3. How We Use Information
            </h2>
            <ul className="list-disc list-inside space-y-1.5 text-slate-400">
              <li>To provide, maintain, and improve the <code className="text-sky-300 font-mono text-xs">auditgpt.ai</code> web interface and browser sandbox.</li>
              <li>To communicate with you regarding service updates, security advisories, or account management.</li>
              <li>To prevent abuse, unauthorized access, or malicious activity against our infrastructure.</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-white font-mono uppercase tracking-wide">
              4. Data Security
            </h2>
            <p>
              We employ industry-standard security measures, including HTTPS encryption in transit and secure hashing practices. Because our core scanning and runtime tools execute locally within your environment, your core operational data remains behind your organization&apos;s perimeter security controls.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-white font-mono uppercase tracking-wide">
              5. Third-Party Services
            </h2>
            <p>
              We utilize trusted third-party subprocessors for specific operational functions:
            </p>
            <ul className="list-disc list-inside space-y-1.5 text-slate-400">
              <li><strong>Vercel:</strong> Web hosting and edge routing for <code className="text-sky-300 font-mono text-xs">auditgpt.ai</code>.</li>
              <li><strong>Stripe:</strong> Secure payment processing for commercial tier subscribers.</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-white font-mono uppercase tracking-wide">
              6. Contact Us
            </h2>
            <p>
              If you have questions regarding this Privacy Policy or our data practices, contact us at:
            </p>
            <p className="font-mono text-xs text-sky-400">
              Email: security@auditgpt.ai / nickaltstein@gmail.com
            </p>
          </section>
        </div>

        <div className="pt-8 border-t border-[#222733] font-mono text-xs text-slate-500 flex justify-between">
          <span>&copy; 2026 AuditGPT Inc. All rights reserved.</span>
          <Link href="/terms" className="text-slate-400 hover:text-white underline">
            Terms of Service
          </Link>
        </div>
      </div>
    </div>
  );
}
