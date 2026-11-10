"use client";

import { useEffect, useMemo, useState } from "react";
import {
  buildLedger,
  initSignerContext,
  POL_SHELL,
  POL_SQL,
  type Ledger,
  type SignerContext,
} from "./birkin-engine";
import { getScenario, SCENARIOS } from "./scenarios";
import styles from "./sandbox.module.css";

const POLICIES = [POL_SHELL, POL_SQL];

export default function SandboxView({ homeHref }: { homeHref?: string }) {
  const [hydrated, setHydrated] = useState(false);
  const [scenarioId, setScenarioId] = useState(SCENARIOS[0].id);
  const [step, setStep] = useState(0);
  const [tamper, setTamper] = useState(false);
  const [disabled, setDisabled] = useState<string[]>([]);
  const [signer, setSigner] = useState<SignerContext | null>(null);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("scenario");
    const scenario = getScenario(requested ?? SCENARIOS[0].id);
    const parsedStep = Number.parseInt(params.get("step") ?? "0", 10);
    setScenarioId(scenario.id);
    setStep(
      Number.isFinite(parsedStep)
        ? clamp(parsedStep, 0, scenario.steps.length - 1)
        : 0,
    );
    setTamper(params.get("tamper") === "1");
    setDisabled(
      (params.get("disabledPolicies") ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter((item) => POLICIES.includes(item))
        .sort(),
    );
    setHydrated(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    initSignerContext().then(
      (context) => {
        if (!cancelled) setSigner(context);
      },
      () => {
        if (!cancelled) setSigner(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const scenario = getScenario(scenarioId);
  const safeStep = clamp(step, 0, scenario.steps.length - 1);
  const disabledKey = disabled.join(",");

  const query = useMemo(() => {
    const params = new URLSearchParams();
    params.set("scenario", scenario.id);
    params.set("step", String(safeStep));
    params.set("tamper", tamper ? "1" : "0");
    if (disabledKey) params.set("disabledPolicies", disabledKey);
    return params.toString();
  }, [disabledKey, safeStep, scenario.id, tamper]);

  useEffect(() => {
    if (!hydrated) return;
    const next = `${window.location.pathname}?${query}`;
    if (`${window.location.pathname}${window.location.search}` !== next) {
      window.history.replaceState(null, "", next);
    }
  }, [hydrated, query]);

  useEffect(() => {
    if (!signer) return;
    let cancelled = false;
    buildLedger({
      steps: scenario.steps,
      signer,
      tamperStep: tamper ? safeStep : null,
      disabledPolicies: disabled,
    }).then((next) => {
      if (!cancelled) setLedger(next);
    });
    return () => {
      cancelled = true;
    };
  }, [disabled, safeStep, scenario, signer, tamper]);

  const frame = ledger?.frames[safeStep];
  const halted = Boolean(frame && frame.reached && frame.decision.decision === "deny");

  async function copyLink() {
    const url = `${window.location.origin}${window.location.pathname}?${query}`;
    try {
      await navigator.clipboard.writeText(url);
      setShareUrl(null);
      setCopyState("copied");
    } catch {
      const area = document.createElement("textarea");
      area.value = url;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.focus();
      area.select();
      let copied = false;
      try {
        copied = document.execCommand("copy");
      } catch {
        copied = false;
      }
      area.remove();
      if (copied) {
        setShareUrl(null);
        setCopyState("copied");
      } else {
        setShareUrl(url);
        setCopyState("failed");
      }
    }
    window.setTimeout(() => setCopyState("idle"), 1600);
  }

  function togglePolicy(policy: string) {
    setDisabled((current) =>
      current.includes(policy)
        ? current.filter((item) => item !== policy)
        : [...current, policy].sort(),
    );
  }

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div>
            <p className={styles.kicker}>TELEMETRY / LOCAL INTERCEPTOR</p>
            <h1 className={styles.title}>Birkin blast-radius sandbox</h1>
            <p className={styles.lede}>
              Each tool call is canonicalized, hashed, and signed in this
              browser. Nothing is sent to a database or a shell. Flip one byte
              after signing, or disable a policy, and the receipt tells you
              which one you did.
            </p>
            <div className={styles.actions}>
              <button type="button" className={styles.action} onClick={copyLink}>
                {copyState === "copied"
                  ? "Copied"
                  : copyState === "failed"
                    ? "Copy failed"
                    : "Copy Exploit Deep-Link"}
              </button>
              <button
                type="button"
                className={styles.action}
                aria-pressed={tamper}
                onClick={() => setTamper((current) => !current)}
              >
                Inject 1-Byte Tamper
              </button>
              {homeHref ? (
                <a className={styles.link} href={homeHref}>
                  Observatory
                </a>
              ) : null}
            </div>
            {shareUrl ? (
              <input
                className={styles.share}
                readOnly
                value={shareUrl}
                aria-label="Exploit deep link"
                onFocus={(event) => event.currentTarget.select()}
              />
            ) : null}
          </div>
          <div className={styles.headerMeta}>
            <div className={styles.badgeRow}>
              <span className={styles.badge}>
                {signer ? signer.scheme : "SIGNER…"}
              </span>
              <span
                className={`${styles.badge} ${ledger ? (ledger.intact ? styles.ok : styles.bad) : ""}`}
              >
                {ledger ? (ledger.intact ? "VERIFIED" : "TAMPERED") : "VERIFYING"}
              </span>
            </div>
            <span className={styles.hash}>
              {signer ? `key ${signer.keyId}` : "waiting for WebCrypto"}
            </span>
          </div>
        </header>

        {ledger && !ledger.intact ? (
          <p className={styles.banner} role="status">
            ✗ TAMPER DETECTED — MERKLE ROOT & SIGNATURE MISMATCH
          </p>
        ) : null}

        <div className={styles.layout}>
          <aside className={styles.panel}>
            <h2>Scenario</h2>
            {SCENARIOS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={styles.scenario}
                aria-pressed={item.id === scenario.id}
                onClick={() => {
                  setScenarioId(item.id);
                  setStep(0);
                }}
              >
                <strong>{item.title}</strong>
                <span>{item.summary}</span>
              </button>
            ))}
            <p className={styles.label}>STEP</p>
            <div className={styles.stepRail}>
              {scenario.steps.map((item, index) => (
                <button
                  key={item.title}
                  type="button"
                  className={styles.stepButton}
                  aria-pressed={index === safeStep}
                  onClick={() => setStep(index)}
                >
                  {String(index).padStart(2, "0")} {item.title}
                </button>
              ))}
            </div>
            <p className={styles.label}>POLICIES</p>
            <div className={styles.chips}>
              {POLICIES.map((policy) => (
                <button
                  key={policy}
                  type="button"
                  className={styles.chip}
                  aria-pressed={disabled.includes(policy)}
                  onClick={() => togglePolicy(policy)}
                >
                  {disabled.includes(policy) ? `${policy} OFF` : `${policy} ON`}
                </button>
              ))}
            </div>
            <p className={styles.note}>?{query}</p>
          </aside>

          <section className={styles.panel}>
            {frame && ledger ? (
              <>
                <h2>
                  {frame.title} · {frame.tool}
                </h2>
                <div className={styles.badgeRow}>
                  <span
                    className={`${styles.badge} ${frame.decision.decision === "allow" ? styles.ok : styles.bad}`}
                  >
                    {frame.decision.decision === "allow" ? "ALLOWED" : "BLOCKED"} {frame.decision.policy}
                  </span>
                  <span className={styles.badge}>
                    {frame.reached ? "REACHED" : "NOT REACHED"}
                  </span>
                  {halted && ledger.intact ? (
                    <span className={`${styles.badge} ${styles.bad}`}>HALTED</span>
                  ) : null}
                </div>
                <p className={styles.effect}>{frame.decision.reason}</p>
                <p className={styles.effect}>{frame.effect}</p>
                {frame.tamper ? (
                  <p className={styles.effect}>
                    1-byte flip at {frame.tamper.path}: "{frame.tamper.before}" → "{frame.tamper.after}". The receipt was not re-signed.
                  </p>
                ) : null}
                <div className={styles.grid}>
                  <div className={styles.block}>
                    <h3>Execution parameters</h3>
                    <pre className={styles.canonical}>
                      {JSON.stringify(frame.displayedArgs, null, 2)}
                    </pre>
                  </div>
                  <div className={styles.block}>
                    <h3>Canonical payload</h3>
                    <pre className={`${styles.canonical} ${styles.canonicalLine}`}>
                      {frame.canonicalDisplayed}
                    </pre>
                  </div>
                  <div className={styles.block}>
                    <h3>Payload hash</h3>
                    <p className={styles.hash}>signed {frame.signedPayloadHash}</p>
                    <p className={`${styles.hash} ${frame.signatureOk ? "" : styles.mismatch}`}>
                      displayed {frame.displayedPayloadHash}
                    </p>
                    <p className={styles.hash}>sig {frame.signatureB64}</p>
                  </div>
                  <div className={styles.block}>
                    <h3>Merkle checkpoint</h3>
                    <p className={styles.hash}>signed {ledger.signedMerkleRoot}</p>
                    <p className={`${styles.hash} ${ledger.checkpointOk ? "" : styles.mismatch}`}>
                      recomputed {ledger.displayedMerkleRoot}
                    </p>
                    <p className={styles.hash}>checkpoint {ledger.checkpointSignatureB64}</p>
                  </div>
                </div>
              </>
            ) : (
              <p className={styles.lede}>Acquiring the signer context.</p>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
