import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service | AuditGPT",
  description: "Terms of Service for the AuditGPT platform, CLI tools, and Receiptd runtime components.",
};

export default function TermsPage() {
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
          <span className="font-mono text-xs text-slate-500">Legal / Terms</span>
        </div>

        <div className="space-y-2">
          <h1 className="font-serif text-3xl sm:text-4xl text-white font-normal">
            AuditGPT Terms of Service
          </h1>
          <p className="font-mono text-xs text-slate-500">
            Last Updated: November 10, 2026 &bull; Effective Date: November 10, 2026
          </p>
        </div>

        <div className="prose prose-invert prose-slate text-sm leading-relaxed space-y-6">
          <p>
            Please read these Terms of Service (&quot;Terms&quot;) carefully before using the AuditGPT platform, CLI tools, GitHub Actions, and Receiptd runtime components (collectively, the &quot;Service&quot;) operated by AuditGPT Inc. (&quot;we,&quot; &quot;our,&quot; or &quot;us&quot;). By accessing or using the Service, you agree to be bound by these Terms.
          </p>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-white font-mono uppercase tracking-wide">
              1. Scope of Service &amp; Open-Core Licensing
            </h2>
            <p>
              AuditGPT provides pre-merge adversarial testing batteries, CI/CD security gates, and runtime authorization engines (including the open-source Receiptd protocol) designed to evaluate and govern autonomous AI agents. Certain components are distributed under open-source licenses (e.g., MIT for code, CC-BY-4.0 for specifications); your use of those components is governed by their respective licenses.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-white font-mono uppercase tracking-wide">
              2. User Responsibilities &amp; Acceptable Use
            </h2>
            <p>
              You represent and warrant that you own or have explicit authorization to test all agent workflows, codebases, repositories, and API endpoints submitted to AuditGPT. You agree <em>not</em> to use the Service to:
            </p>
            <ul className="list-disc list-inside space-y-1.5 text-slate-400">
              <li>Stress-test or target third-party systems, networks, or infrastructure without explicit, written authorization from the system owner.</li>
              <li>Exfiltrate sensitive production data, credentials, or proprietary intellectual property belonging to unauthorized entities.</li>
              <li>Circumvent lawful access controls or violate any applicable local, state, federal, or international laws.</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-white font-mono uppercase tracking-wide">
              3. Limitation of Liability &amp; Autonomous Agent Actions
            </h2>
            <p>
              Autonomous AI agents are probabilistic systems capable of executing unpredictable actions. <strong className="text-white">AuditGPT provides adversarial simulation, policy enforcement, and audit telemetry &quot;AS IS&quot; without warranty of any kind.</strong>
            </p>
            <ul className="list-disc list-inside space-y-1.5 text-slate-400">
              <li>You assume 100% responsibility for executing test batteries, fault injections, and runtime pre-tool hooks (<code className="text-sky-300 font-mono text-xs">PreToolUse</code>) in your environments.</li>
              <li>Under no circumstances shall AuditGPT, its founders, or contributors be liable for any direct, indirect, incidental, special, or consequential damages—including but not limited to data loss, database corruption, unintended model cost accrual, or system downtime—arising out of the use or inability to use the Service.</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-white font-mono uppercase tracking-wide">
              4. Intellectual Property
            </h2>
            <p>
              All software, trademarks, documentation, and interface designs associated with AuditGPT are the exclusive property of AuditGPT Inc. You retain all intellectual property rights in your proprietary agent definitions, Loopfiles, and custom policy rulesets.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-white font-mono uppercase tracking-wide">
              5. Modifications to Terms
            </h2>
            <p>
              We reserve the right to modify these Terms at any time. Continued use of the Service following any modifications constitutes your acceptance of the updated Terms.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-white font-mono uppercase tracking-wide">
              6. Governing Law
            </h2>
            <p>
              These Terms shall be governed by and construed in accordance with the laws of the State of New York, without regard to its conflict of law provisions.
            </p>
          </section>
        </div>

        <div className="pt-8 border-t border-[#222733] font-mono text-xs text-slate-500 flex justify-between">
          <span>&copy; 2026 AuditGPT Inc. All rights reserved.</span>
          <Link href="/privacy" className="text-slate-400 hover:text-white underline">
            Privacy Policy
          </Link>
        </div>
      </div>
    </div>
  );
}
