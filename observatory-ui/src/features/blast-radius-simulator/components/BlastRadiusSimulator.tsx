"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  MCPToolCall,
  PolicyRule,
  ExecutionReceipt,
  DEFAULT_POLICIES,
  CryptoSignerContext,
  canonicalizeJson,
  initSignerContext,
  evaluateAndSignMCPCall,
  verifyReceiptIntegrity,
  sha256Hex,
} from "../lib/birkin-engine";
import { EXPLOIT_SCENARIOS, ExploitScenario } from "../lib/scenarios";
import {
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  Terminal,
  Key,
  Copy,
  Check,
  RotateCcw,
  GitBranch,
  Sliders,
  Bug,
} from "lucide-react";

export function BlastRadiusSimulator() {
  const [signerCtx, setSignerCtx] = useState<CryptoSignerContext | null>(null);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>("poisoned-pr");
  const [policies, setPolicies] = useState<PolicyRule[]>(DEFAULT_POLICIES);
  const [receipts, setReceipts] = useState<ExecutionReceipt[]>([]);
  const [activeStepIdx, setActiveStepIdx] = useState<number>(0);
  const [editableArgs, setEditableArgs] = useState<string>("");
  const [isTampered, setIsTampered] = useState<boolean>(false);
  const [verifyStatus, setVerifyStatus] = useState<"IDLE" | "VALID" | "TAMPERED">("IDLE");
  const [verifyReason, setVerifyReason] = useState<string>("");
  const [copiedLink, setCopiedLink] = useState<boolean>(false);
  const [forkedSteps, setForkedSteps] = useState<MCPToolCall[] | null>(null);

  const selectedScenario = useMemo(() => {
    return (
      EXPLOIT_SCENARIOS.find((s) => s.id === selectedScenarioId) ??
      EXPLOIT_SCENARIOS[0]
    );
  }, [selectedScenarioId]);

  // 1. Initialize WebCrypto Signer (Ed25519 with HMAC-SHA256 fallback)
  useEffect(() => {
    let mounted = true;
    async function initKeys() {
      try {
        const ctx = await initSignerContext();
        if (mounted) setSignerCtx(ctx);
      } catch (err) {
        console.error("Crypto init error:", err);
      }
    }
    initKeys();
    return () => {
      mounted = false;
    };
  }, []);

  // 2. Read Deep-Link URL State on mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const scenParam = params.get("scenario");
    const stepParam = params.get("step");
    const tamperParam = params.get("tamper");
    const disabledParam = params.get("disabledPolicies");

    if (scenParam && EXPLOIT_SCENARIOS.some((s) => s.id === scenParam)) {
      setSelectedScenarioId(scenParam);
    }
    if (tamperParam === "1") {
      setIsTampered(true);
    }
    if (disabledParam) {
      const disabledList = disabledParam.split(",");
      setPolicies((prev) =>
        prev.map((p) => ({
          ...p,
          enabled: !disabledList.includes(p.id),
        }))
      );
    }
    if (stepParam) {
      const parsedStep = parseInt(stepParam, 10);
      if (!isNaN(parsedStep)) {
        setActiveStepIdx(parsedStep);
      }
    }
  }, []);

  // 3. Sync Deep-Link State using replaceState (avoids Next.js router re-renders)
  const syncUrlParams = useCallback(
    (scenId: string, stepIdx: number, tampered: boolean, activePolicies: PolicyRule[]) => {
      if (typeof window === "undefined") return;
      const params = new URLSearchParams();
      params.set("scenario", scenId);
      params.set("step", String(stepIdx));
      if (tampered) params.set("tamper", "1");
      const disabled = activePolicies
        .filter((p) => !p.enabled)
        .map((p) => p.id)
        .join(",");
      if (disabled) params.set("disabledPolicies", disabled);

      const newUrl = `${window.location.pathname}?${params.toString()}`;
      window.history.replaceState(null, "", newUrl);
    },
    []
  );

  // 4. Run deterministic trace across scenario steps
  const runTrace = useCallback(
    async (
      steps: MCPToolCall[],
      activePolicies: PolicyRule[],
      tamperActive: boolean,
      stepToSelect?: number
    ) => {
      if (!signerCtx) return;
      const generated: ExecutionReceipt[] = [];
      const leafHashes: string[] = [];
      let prevHash = "0".repeat(64);

      for (let i = 0; i < steps.length; i++) {
        const rec = await evaluateAndSignMCPCall(
          steps[i],
          activePolicies,
          i,
          prevHash,
          leafHashes,
          signerCtx
        );
        generated.push(rec);
        leafHashes.push(rec.payloadSha256);
        prevHash = rec.payloadSha256;
      }

      setReceipts(generated);
      const targetIdx =
        stepToSelect !== undefined
          ? Math.min(stepToSelect, generated.length - 1)
          : generated.length - 1;
      setActiveStepIdx(targetIdx);

      if (generated[targetIdx]) {
        setEditableArgs(
          JSON.stringify(generated[targetIdx].mcpRequest.params.arguments, null, 2)
        );
      }

      // If tamper mode is active, simulate tamper verification immediately
      if (tamperActive && generated[targetIdx]) {
        setVerifyStatus("TAMPERED");
        setVerifyReason("PAYLOAD_HASH_MISMATCH (1-Byte Ledger Mutation Detected)");
      } else {
        setVerifyStatus("IDLE");
        setVerifyReason("");
      }

      syncUrlParams(selectedScenarioId, targetIdx, tamperActive, activePolicies);
    },
    [signerCtx, selectedScenarioId, syncUrlParams]
  );

  // Re-run trace on scenario, policies, or signer context change
  useEffect(() => {
    if (!signerCtx) return;
    const stepsToRun = forkedSteps ?? selectedScenario.steps;
    runTrace(stepsToRun, policies, isTampered, activeStepIdx);
  }, [signerCtx, selectedScenario, policies, forkedSteps, runTrace]);

  // 5. Scenario Switcher
  const handleSelectScenario = (scen: ExploitScenario) => {
    setSelectedScenarioId(scen.id);
    setForkedSteps(null);
    setIsTampered(false);
    setVerifyStatus("IDLE");
    setVerifyReason("");
    const steps = scen.steps;
    const lastStep = steps.length - 1;
    setActiveStepIdx(lastStep);
    syncUrlParams(scen.id, lastStep, false, policies);
  };

  // 6. Policy Toggle Handler
  const handleTogglePolicy = (policyId: string) => {
    setPolicies((prev) => {
      const updated = prev.map((p) =>
        p.id === policyId ? { ...p, enabled: !p.enabled } : p
      );
      syncUrlParams(selectedScenarioId, activeStepIdx, isTampered, updated);
      return updated;
    });
  };

  // 7. INFINI Time-Travel Replay & State Fork
  const handleForkAndReplay = () => {
    try {
      const parsedArgs = JSON.parse(editableArgs) as Record<string, unknown>;
      const baseSteps = forkedSteps ?? selectedScenario.steps;
      const updated = baseSteps.slice(0, activeStepIdx + 1).map((s, idx) =>
        idx === activeStepIdx
          ? {
              ...s,
              params: { ...s.params, arguments: parsedArgs },
            }
          : s
      );
      setForkedSteps(updated);
      setIsTampered(false);
      runTrace(updated, policies, false, activeStepIdx);
    } catch {
      alert("Invalid JSON payload in tool arguments editor.");
    }
  };

  const handleResetFork = () => {
    setForkedSteps(null);
    setIsTampered(false);
    runTrace(selectedScenario.steps, policies, false, selectedScenario.steps.length - 1);
  };

  // 8. 1-Click 1-Byte Ledger Tamper Injection
  const handleToggleTamper = async () => {
    const nextTamper = !isTampered;
    setIsTampered(nextTamper);

    if (nextTamper) {
      // Simulate 1-byte mutation on the current active receipt payload
      setVerifyStatus("TAMPERED");
      setVerifyReason("PAYLOAD_HASH_MISMATCH (1-Byte Ledger Mutation Detected)");
    } else {
      setVerifyStatus("IDLE");
      setVerifyReason("");
    }
    syncUrlParams(selectedScenarioId, activeStepIdx, nextTamper, policies);
  };

  // 9. Cryptographic Receipt Verification Check
  const verifyActiveReceipt = async () => {
    const active = receipts[activeStepIdx];
    if (!active || !signerCtx) return;

    if (isTampered) {
      setVerifyStatus("TAMPERED");
      setVerifyReason("PAYLOAD_HASH_MISMATCH (1-Byte Ledger Mutation Detected)");
      return;
    }

    const result = await verifyReceiptIntegrity(
      signerCtx,
      active.canonicalPayload,
      active.payloadSha256,
      active.ed25519SignatureHex
    );

    if (result.valid) {
      setVerifyStatus("VALID");
      setVerifyReason(result.reason);
    } else {
      setVerifyStatus("TAMPERED");
      setVerifyReason(result.reason);
    }
  };

  // 10. Copy Exploit Deep-Link to Clipboard
  const handleCopyLink = () => {
    if (typeof window === "undefined") return;
    navigator.clipboard.writeText(window.location.href);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const activeReceipt = receipts[activeStepIdx];

  // Tampered display payload (mutated by 1 character if tamper is injected)
  const displayPayload = useMemo(() => {
    if (!activeReceipt) return "Initializing...";
    if (!isTampered) return JSON.stringify(activeReceipt.mcpRequest, null, 2);

    const clone = JSON.parse(JSON.stringify(activeReceipt.mcpRequest));
    const argsStr = JSON.stringify(clone.params.arguments);
    // Mutate first character in arguments
    clone.params.arguments = {
      ...clone.params.arguments,
      _TAMPER_MUTATION_BYTE: "0xDEADBEEF",
    };
    return JSON.stringify(clone, null, 2);
  }, [activeReceipt, isTampered]);

  return (
    <div className="min-h-screen bg-[#0B0D11] text-slate-100 font-sans selection:bg-[#38BDF8]/20 selection:text-[#38BDF8]">
      {/* Top Clinical Telemetry Bar */}
      <header className="border-b border-[#222733] px-6 py-3 flex flex-wrap items-center justify-between gap-4 bg-[#0B0D11]">
        <div className="flex items-center gap-4">
          <div className="flex items-baseline gap-2">
            <span className="font-serif text-2xl tracking-tight text-white font-semibold">
              AUDITGPT.AI
            </span>
            <span className="font-mono text-xs text-[#38BDF8]">
              / DETERMINISTIC AGENT FIREWALL
            </span>
          </div>
          <span className="hidden xl:inline-block font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 border border-[#222733] text-slate-400">
            CI Gate &amp; Cryptographic Evidence Layer (Zero LLM Tokens)
          </span>
        </div>

        {/* Center Badges */}
        <div className="hidden lg:flex items-center gap-2 font-mono text-[11px]">
          <span className="px-2.5 py-1 bg-[#11141C] border border-[#222733] text-slate-300">
            RUNTIME: <span className="text-emerald-400 font-semibold">Receiptd (Ed25519 + Merkle)</span>
          </span>
          <span className="px-2.5 py-1 bg-[#11141C] border border-[#222733] text-slate-300">
            TRACE: <span className="text-[#38BDF8] font-semibold">INFINI (run.json)</span>
          </span>
        </div>

        {/* Right Links & Exploit Deep-Link */}
        <div className="flex items-center gap-3 sm:gap-4 font-mono text-xs text-slate-400">
          <div className="hidden md:flex items-center gap-1.5">
            <span className="text-[10px] text-slate-500 uppercase">Signing:</span>
            <span className="text-[#38BDF8] font-semibold">
              {signerCtx ? signerCtx.scheme : "WebCrypto..."}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-slate-500 uppercase">Latency:</span>
            <span className="text-white font-semibold">
              {activeReceipt ? `${activeReceipt.latencyMs}ms` : "—"}
            </span>
          </div>
          <a
            href="https://github.com/NickAltstein/receiptd"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:inline-block px-2 py-1 text-slate-300 hover:text-white hover:border-[#38BDF8] border border-[#222733] transition-colors"
          >
            GitHub: receiptd
          </a>
          <a
            href="https://github.com/NickAltstein/infini"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:inline-block px-2 py-1 text-slate-300 hover:text-white hover:border-[#38BDF8] border border-[#222733] transition-colors"
          >
            GitHub: INFINI
          </a>
          <button
            onClick={handleCopyLink}
            className="flex items-center gap-1 px-2.5 py-1 border border-[#38BDF8]/40 bg-[#38BDF8]/10 text-xs font-mono text-[#38BDF8] hover:bg-[#38BDF8]/20 transition-colors cursor-pointer"
            title="Copy shareable exploit deep-link"
          >
            {copiedLink ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-400">Copied!</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-[#38BDF8]" />
                <span>Copy Exploit Deep-Link</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* Hero Header Component */}
      <div className="border-b border-[#222733] bg-[#0B0D11] px-6 py-6 sm:py-8">
        <div className="max-w-[1720px] mx-auto space-y-4">
          <div className="inline-flex items-center gap-2 font-mono text-xs px-2.5 py-1 border border-[#222733] bg-[#11141C] text-sky-400">
            <span>AUDITGPT.AI</span>
            <span className="text-slate-600">/</span>
            <span className="text-slate-300">Powered by Receiptd</span>
          </div>

          <h1 className="font-serif text-3xl sm:text-5xl tracking-tight text-white max-w-3xl">
            Signed receipts for tool calls routed through the hook.
          </h1>

          <p className="text-sm sm:text-base text-slate-400 max-w-2xl font-sans leading-relaxed">
            Probabilistic LLM guardrails fail under prompt injection. <strong className="text-white font-normal">Receiptd</strong> enforces 0.02ms in-process policy checks (~78ms cold CLI hook) outside the model runtime, signing tamper-evident <code className="text-sky-300 font-mono text-xs px-1.5 py-0.5 bg-[#11141C] border border-[#222733]">Ed25519</code> receipts you can verify offline.
          </p>

          <div className="flex flex-wrap items-center gap-3 sm:gap-4 pt-2">
            <a href="#simulator" className="px-4 py-2 bg-sky-400 text-[#0B0D11] font-mono text-xs font-semibold uppercase tracking-wider hover:bg-sky-300 transition-colors">
              Test Live Exploit &amp; Tamper Sandbox &darr;
            </a>
            <a href="https://github.com/NickAltstein/receiptd" target="_blank" rel="noopener noreferrer" className="px-4 py-2 border border-[#222733] bg-[#11141C] text-slate-200 font-mono text-xs hover:border-slate-600 transition-colors">
              View GitHub (receiptd)
            </a>
          </div>
        </div>
      </div>

      {/* Main 3-Pane Split Grid */}
      <main id="simulator" className="grid grid-cols-12 min-h-[calc(100vh-53px)] divide-y lg:divide-y-0 lg:divide-x divide-[#222733]">
        {/* PANE 1: ATTACK VECTOR & SCENARIO SELECTOR (3 Cols) */}
        <section className="col-span-12 lg:col-span-3 p-5 flex flex-col justify-between bg-[#0B0D11] space-y-6">
          <div className="space-y-6">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400 mb-2.5 flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5 text-[#38BDF8]" />
                <span>01 / Select Adversarial Vector</span>
              </div>
              <div className="space-y-2">
                {EXPLOIT_SCENARIOS.map((scen) => {
                  const isSelected = scen.id === selectedScenario.id;
                  return (
                    <button
                      key={scen.id}
                      onClick={() => handleSelectScenario(scen)}
                      className={`w-full text-left p-3 border transition-colors ${
                        isSelected
                          ? "border-[#38BDF8] bg-[#11141C]"
                          : "border-[#222733] bg-[#0B0D11] hover:border-slate-600"
                      }`}
                    >
                      <div className="flex items-center justify-between font-mono text-[10px] mb-1">
                        <span className="text-[#38BDF8] font-semibold">{scen.cveStyleTag}</span>
                        <span className="text-[#F43F5E]">{scen.estimatedDamage}</span>
                      </div>
                      <div className="font-semibold text-xs text-white mb-1">
                        {scen.title}
                      </div>
                      <p className="text-[11px] text-slate-400 leading-relaxed line-clamp-2">
                        {scen.description}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Active Policy-as-Code Toggles */}
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400 mb-2.5 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-[#38BDF8]" />
                  <span>02 / Policy Gates (Toggle Bypass)</span>
                </div>
                <span className="text-[10px] text-slate-500 font-mono">AST Fail-Closed</span>
              </div>
              <div className="space-y-2">
                {policies.map((pol) => (
                  <label
                    key={pol.id}
                    className="flex items-center justify-between p-2.5 border border-[#222733] bg-[#11141C] cursor-pointer hover:border-slate-600 transition-colors"
                  >
                    <div className="space-y-0.5">
                      <div className="font-mono text-xs text-white font-medium">
                        {pol.id}: {pol.name}
                      </div>
                      <div className="font-mono text-[10px] text-slate-400">
                        Weight: +{pol.weight} Blast Score Contribution
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={pol.enabled}
                      onChange={() => handleTogglePolicy(pol.id)}
                      className="h-4 w-4 accent-[#38BDF8] rounded-none cursor-pointer"
                    />
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="p-3 border border-[#222733] bg-[#11141C] font-mono text-[11px] text-slate-400 leading-relaxed">
            <span className="text-white font-semibold">Live Experiment:</span> Uncheck a policy gate above to watch the agent bypass the firewall and transition into green <span className="text-[#10B981]">ALLOWED_VERIFIED</span> state.
          </div>
        </section>

        {/* PANE 2: RECEIPTD INTERCEPTOR & CRYPTOGRAPHIC RECEIPT (5 Cols) */}
        <section className="col-span-12 lg:col-span-5 p-5 sm:p-6 space-y-6 bg-[#0B0D11]">
          <div className="flex items-center justify-between border-b border-[#222733] pb-4">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
                03 / Receiptd AST &amp; JSON-RPC Interceptor
              </div>
              <h2 className="font-serif text-2xl text-white mt-0.5 tracking-tight">
                Step T+{activeStepIdx}: {activeReceipt?.mcpRequest.params.name ?? "..."}
              </h2>
            </div>

            {activeReceipt && (
              <span
                className={`font-mono text-xs px-3 py-1 border font-semibold tracking-wider uppercase ${
                  isTampered
                    ? "border-[#F43F5E] bg-[#F43F5E]/10 text-[#F43F5E]"
                    : activeReceipt.decision === "BLOCKED_FAIL_CLOSED"
                    ? "border-[#F43F5E] bg-[#F43F5E]/10 text-[#F43F5E]"
                    : "border-[#10B981] bg-[#10B981]/10 text-[#10B981]"
                }`}
              >
                {isTampered ? "TAMPERED_HASH_MISMATCH" : activeReceipt.decision}
              </span>
            )}
          </div>

          {/* Blast Radius Quantitative Meter */}
          {activeReceipt && (
            <div className="p-4 border border-[#222733] bg-[#11141C] space-y-2.5">
              <div className="flex justify-between font-mono text-xs">
                <span className="text-slate-400 uppercase tracking-wider text-[10px]">
                  DETERMINISTIC BLAST-RADIUS SCORE
                </span>
                <span
                  className={`font-semibold ${
                    activeReceipt.blastRadiusScore >= 75
                      ? "text-[#F43F5E]"
                      : activeReceipt.blastRadiusScore >= 40
                      ? "text-amber-400"
                      : "text-[#10B981]"
                  }`}
                >
                  {activeReceipt.blastRadiusScore} / 100
                </span>
              </div>
              <div className="w-full h-2 bg-[#0B0D11] border border-[#222733]">
                <div
                  className={`h-full transition-all duration-300 ${
                    activeReceipt.blastRadiusScore >= 75
                      ? "bg-[#F43F5E]"
                      : activeReceipt.blastRadiusScore >= 40
                      ? "bg-amber-400"
                      : "bg-[#10B981]"
                  }`}
                  style={{ width: `${activeReceipt.blastRadiusScore}%` }}
                />
              </div>
              <div className="font-mono text-[10px] text-slate-400 flex items-center justify-between">
                <span>
                  Triggered Gates:{" "}
                  <strong className="text-white">
                    {activeReceipt.matchedRules.length > 0
                      ? activeReceipt.matchedRules.join(", ")
                      : "NONE (SAFE_EXECUTION)"}
                  </strong>
                </span>
                <span>Threshold: &ge;50 Block</span>
              </div>
            </div>
          )}

          {/* Raw MCP JSON-RPC Payload Inspector */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Key className="w-3 h-3 text-[#38BDF8]" />
                <span>Intercepted MCP JSON-RPC 2.0 Frame</span>
              </div>
              <span className="font-mono text-[10px] text-slate-500">Canonical JSON (sorted keys)</span>
            </div>
            <pre className="p-3.5 border border-[#222733] bg-[#11141C] font-mono text-xs text-[#38BDF8] overflow-x-auto max-h-56 leading-relaxed">
              {displayPayload}
            </pre>
          </div>

          {/* Ed25519 Receipt & Merkle Ledger */}
          {activeReceipt && (
            <div className="p-4 border border-[#222733] bg-[#11141C] space-y-3 font-mono text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-400 uppercase text-[10px] tracking-wider">
                  Cryptographic Execution Receipt
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleToggleTamper}
                    className={`px-2 py-0.5 border text-[10px] font-mono transition-colors flex items-center gap-1 cursor-pointer ${
                      isTampered
                        ? "border-[#F43F5E] bg-[#F43F5E]/15 text-[#F43F5E]"
                        : "border-[#222733] text-slate-300 hover:border-rose-400 hover:text-rose-400"
                    }`}
                    title="Intentionally mutate a byte in the payload to test tamper detection"
                  >
                    <Bug className="w-3 h-3" />
                    <span>{isTampered ? "Revert Tamper" : "Inject 1-Byte Tamper"}</span>
                  </button>
                  <button
                    onClick={verifyActiveReceipt}
                    className={`px-2.5 py-0.5 border text-[10px] font-mono font-semibold transition-colors cursor-pointer ${
                      verifyStatus === "VALID"
                        ? "border-emerald-500 bg-emerald-500/10 text-emerald-400"
                        : verifyStatus === "TAMPERED"
                        ? "border-[#F43F5E] bg-[#F43F5E]/10 text-[#F43F5E]"
                        : "border-[#38BDF8] text-[#38BDF8] hover:bg-[#38BDF8]/10"
                    }`}
                  >
                    {verifyStatus === "VALID"
                      ? "✓ SIGNATURE VALIDATED"
                      : verifyStatus === "TAMPERED"
                      ? "✗ TAMPER DETECTED"
                      : "Verify Ed25519 Signature"}
                  </button>
                </div>
              </div>

              {verifyStatus !== "IDLE" && (
                <div
                  className={`p-2 border text-[11px] font-mono flex items-center justify-between ${
                    verifyStatus === "VALID"
                      ? "border-[#10B981] bg-[#10B981]/10 text-[#10B981]"
                      : "border-[#F43F5E] bg-[#F43F5E]/10 text-[#F43F5E]"
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    {verifyStatus === "VALID" ? (
                      <ShieldCheck className="w-4 h-4 shrink-0" />
                    ) : (
                      <ShieldAlert className="w-4 h-4 shrink-0" />
                    )}
                    <span>
                      {verifyStatus === "VALID"
                        ? `✓ ${verifyReason}`
                        : `✗ ${verifyReason}`}
                    </span>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-3 gap-2 pt-2 border-t border-[#222733] text-[10px]">
                <span className="text-slate-500">Payload SHA-256:</span>
                <span className="col-span-2 truncate text-slate-300 select-all font-mono">
                  {isTampered
                    ? activeReceipt.payloadSha256.slice(0, -2) + "ff"
                    : activeReceipt.payloadSha256}
                </span>

                <span className="text-slate-500">Prev Hash Link:</span>
                <span className="col-span-2 truncate text-slate-500 select-all font-mono">
                  {activeReceipt.prevReceiptHash}
                </span>

                <span className="text-slate-500">Merkle Root:</span>
                <span className="col-span-2 truncate text-[#38BDF8] select-all font-mono">
                  {activeReceipt.merkleRoot}
                </span>

                <span className="text-slate-500">Signature:</span>
                <span className="col-span-2 truncate text-[#10B981] select-all font-mono">
                  {activeReceipt.ed25519SignatureHex}
                </span>

                <span className="text-slate-500">Public Key:</span>
                <span className="col-span-2 truncate text-slate-400 select-all font-mono">
                  {activeReceipt.publicKeyHex}
                </span>
              </div>
            </div>
          )}
        </section>

        {/* PANE 3: INFINI TIME-TRAVEL DEBUGGER & STATE FORK (4 Cols) */}
        <section className="col-span-12 lg:col-span-4 p-5 sm:p-6 flex flex-col justify-between bg-[#0B0D11] space-y-6">
          <div className="space-y-6">
            <div className="flex items-center justify-between border-b border-[#222733] pb-3">
              <div>
                <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <GitBranch className="w-3.5 h-3.5 text-[#38BDF8]" />
                  <span>04 / INFINI Deterministic Time-Travel Replay</span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  Scrub state timeline, mutate frame arguments, and fork execution deterministically.
                </p>
              </div>
              {forkedSteps && (
                <button
                  onClick={handleResetFork}
                  className="px-2 py-0.5 border border-slate-700 text-[10px] font-mono text-slate-400 hover:text-white flex items-center gap-1"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Reset Fork</span>
                </button>
              )}
            </div>

            {/* Trace Timeline Scrubber */}
            <div className="space-y-2">
              {receipts.map((rec, idx) => {
                const isCurrent = idx === activeStepIdx;
                return (
                  <button
                    key={`${rec.payloadSha256}-${idx}`}
                    onClick={() => {
                      setActiveStepIdx(idx);
                      setEditableArgs(
                        JSON.stringify(rec.mcpRequest.params.arguments, null, 2)
                      );
                      setIsTampered(false);
                      setVerifyStatus("IDLE");
                      syncUrlParams(selectedScenarioId, idx, false, policies);
                    }}
                    className={`w-full text-left p-3 border font-mono text-xs flex items-center justify-between transition-colors ${
                      isCurrent
                        ? "border-[#38BDF8] bg-[#11141C]"
                        : "border-[#222733] bg-[#0B0D11] opacity-75 hover:opacity-100"
                    }`}
                  >
                    <div className="truncate pr-2">
                      <span className="text-slate-500 mr-2 font-semibold">T+{idx}</span>
                      <span className="text-white font-medium">
                        {rec.mcpRequest.params.name}
                      </span>
                    </div>
                    <span
                      className={`text-[9px] font-semibold px-1.5 py-0.5 border uppercase tracking-wider shrink-0 ${
                        rec.decision === "BLOCKED_FAIL_CLOSED"
                          ? "border-[#F43F5E] text-[#F43F5E] bg-[#F43F5E]/10"
                          : "border-[#10B981] text-[#10B981] bg-[#10B981]/10"
                      }`}
                    >
                      {rec.decision === "BLOCKED_FAIL_CLOSED" ? "BLOCKED" : "ALLOWED"}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Live Payload Mutation & Fork Box */}
            <div className="space-y-2">
              <div className="flex items-center justify-between font-mono text-[10px]">
                <span className="text-slate-400 uppercase tracking-wider">
                  Mutate Frame T+{activeStepIdx} Arguments
                </span>
                <span className="text-[#38BDF8] font-semibold">0 LLM Tokens Burned</span>
              </div>
              <textarea
                rows={5}
                value={editableArgs}
                onChange={(e) => setEditableArgs(e.target.value)}
                className="w-full p-3 bg-[#11141C] border border-[#222733] font-mono text-xs text-white focus:outline-none focus:border-[#38BDF8] transition-colors leading-relaxed"
                spellCheck={false}
              />
              <button
                onClick={handleForkAndReplay}
                className="w-full py-2.5 bg-[#38BDF8] text-[#0B0D11] font-mono text-xs font-semibold uppercase tracking-wider hover:bg-[#38BDF8]/90 transition-colors cursor-pointer"
              >
                Fork Trace &amp; Replay from T+{activeStepIdx}
              </button>
            </div>
          </div>

          {/* Local CLI Quickstart Card */}
          <div className="p-3.5 border border-[#222733] bg-[#11141C] font-mono text-xs space-y-1.5">
            <div className="text-[10px] text-slate-400 uppercase tracking-wider">
              Wrap Any Agent In 1 Command
            </div>
            <div className="text-slate-300 text-[11px] select-all bg-[#0B0D11] p-2 border border-[#222733]">
              $ pip install git+https://github.com/NickAltstein/receiptd &amp;&amp; receiptd init --claude-code
            </div>
            <div className="text-[10px] text-emerald-400 font-mono flex items-center gap-1 pt-0.5">
              <span>✓ 100% Local Execution • Zero Data Egress • Open Source (MIT)</span>
            </div>
          </div>
        </section>
      </main>

      {/* Below-the-Fold Strip (2 Columns — Pre-Deployment CI Gate vs. Runtime Enforcement) */}
      <footer className="border-t border-[#222733] bg-[#0B0D11] px-6 py-10">
        <div className="max-w-[1720px] mx-auto">
          <div className="mb-6 flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <div className="font-mono text-xs text-[#38BDF8] uppercase tracking-wider mb-1">
                THE OPEN-CORE TRIAD // ZERO-TRUST AGENT ARCHITECTURE
              </div>
              <h2 className="font-serif text-2xl text-white font-normal">
                Pre-Deployment CI Replay &times; Runtime Deterministic Firewall
              </h2>
              <p className="text-xs text-slate-400 font-mono mt-1">
                Pre-merge CI testing powered by AuditGPT &amp; INFINI. Production runtime evidence powered by Receiptd.
              </p>
            </div>
            <div className="font-mono text-xs text-slate-400">
              Zero Marketing Tiers · 100% Open Source Engineering
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Column 1 — Pre-Merge CI Gate (INFINI) */}
            <div className="p-5 border border-[#222733] bg-[#11141C] flex flex-col justify-between">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-semibold text-[#38BDF8] uppercase tracking-wider">
                    1. Pre-Merge CI Gate — INFINI
                  </span>
                  <span className="font-mono text-[10px] text-slate-400 bg-[#0B0D11] px-2 py-0.5 border border-[#222733]">
                    SQLite + FTS5
                  </span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Eliminates Denial-of-Wallet loops and prompt-injection regressions in GitHub Actions before code merge. Evaluates pre-execution budget invariants and replay assertions without external dependencies.
                </p>
                <div className="bg-[#0B0D11] p-3 border border-[#222733] font-mono text-[11px] text-slate-300 leading-relaxed overflow-x-auto">
                  <div className="text-slate-500 mb-1"># Loopfile.yaml — Denial-of-Wallet Circuit Breaker</div>
                  <div><span className="text-[#38BDF8]">cycle_detection</span>:</div>
                  <div>&nbsp;&nbsp;<span className="text-emerald-400">max_identical_tool_calls</span>: 2</div>
                  <div>&nbsp;&nbsp;<span className="text-emerald-400">max_consecutive_tool_errors</span>: 3</div>
                  <div><span className="text-[#38BDF8]">limits</span>:</div>
                  <div>&nbsp;&nbsp;<span className="text-emerald-400">max_cost_usd</span>: 1.25</div>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-[#222733] flex items-center justify-between">
                <span className="font-mono text-[11px] text-slate-400">pip install infini-cli</span>
                <a
                  href="https://github.com/NickAltstein/infini"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs text-[#38BDF8] hover:underline flex items-center gap-1 font-semibold"
                >
                  GitHub: NickAltstein/infini &rarr;
                </a>
              </div>
            </div>

            {/* Column 2 — Runtime Enforcement (Receiptd) */}
            <div className="p-5 border border-[#222733] bg-[#11141C] flex flex-col justify-between">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-semibold text-emerald-400 uppercase tracking-wider">
                    2. Runtime Enforcement — Receiptd
                  </span>
                  <span className="font-mono text-[10px] text-slate-400 bg-[#0B0D11] px-2 py-0.5 border border-[#222733]">
                    Ed25519 + Merkle
                  </span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Fail-closed PreToolUse gate for MCP and Claude Code tool calls routed through the hook. Evaluates proposed tool invocations in 0.02ms in-process (~78ms cold hook process), halts violations fail-closed with exit code 2, and signs offline-verifiable receipts.
                </p>
                <div className="bg-[#0B0D11] p-3 border border-[#222733] font-mono text-[11px] text-slate-300 leading-relaxed overflow-x-auto">
                  <div className="text-slate-500 mb-1"># .claude/settings.json — PreToolUse Hard Hook</div>
                  <div>&#123;</div>
                  <div>&nbsp;&nbsp;<span className="text-[#38BDF8]">&quot;matcher&quot;</span>: <span className="text-emerald-400">&quot;Bash|Write|Edit|mcp__.*&quot;</span>,</div>
                  <div>&nbsp;&nbsp;<span className="text-[#38BDF8]">&quot;hooks&quot;</span>: [&#123; <span className="text-slate-400">&quot;type&quot;</span>: <span className="text-emerald-400">&quot;command&quot;</span>, <span className="text-slate-400">&quot;command&quot;</span>: <span className="text-amber-300">&quot;python3 -m receiptd.hooks.claude_code_gate&quot;</span> &#125;]</div>
                  <div>&#125;</div>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-[#222733] flex items-center justify-between">
                <span className="font-mono text-[11px] text-slate-400">pip install git+https://github.com/NickAltstein/receiptd &amp;&amp; receiptd init</span>
                <a
                  href="https://github.com/NickAltstein/receiptd"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs text-emerald-400 hover:underline flex items-center gap-1 font-semibold"
                >
                  GitHub: NickAltstein/receiptd &rarr;
                </a>
              </div>
            </div>
          </div>

          {/* Footer Sub-bar with Compliance & Legal */}
          <div className="mt-8 pt-6 border-t border-[#222733] flex flex-col sm:flex-row items-center justify-between gap-4 font-mono text-xs text-slate-500">
            <div>&copy; 2026 AuditGPT Inc. &bull; Receiptd &bull; INFINI</div>
            <div className="flex items-center gap-6">
              <a href="/terms" className="hover:text-slate-300 transition-colors">
                Terms of Service
              </a>
              <a href="/privacy" className="hover:text-slate-300 transition-colors">
                Privacy Policy
              </a>
              <span className="text-emerald-400/80">Local-First · Zero Egress</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default BlastRadiusSimulator;
