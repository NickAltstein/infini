export type SigningScheme = "Ed25519" | "HMAC-SHA256-FALLBACK";

export interface CryptoSignerContext {
  scheme: SigningScheme;
  signKey: CryptoKey;
  verifyKey: CryptoKey;
  publicKeyHex: string;
}

export interface MCPToolCall {
  jsonrpc: "2.0";
  id: string;
  method: "tools/call";
  params: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

export interface PolicyRule {
  id: string;
  name: string;
  enabled: boolean;
  pattern: RegExp;
  targetField: "name" | "arguments";
  weight: number; // Contribution to Blast-Radius Score (0-100)
  action: "BLOCK_FAIL_CLOSED" | "ALLOW_AUDITED";
}

export interface ExecutionReceipt {
  stepIndex: number;
  timestamp: string;
  latencyMs: number;
  mcpRequest: MCPToolCall;
  blastRadiusScore: number;
  matchedRules: string[];
  decision: "BLOCKED_FAIL_CLOSED" | "ALLOWED_VERIFIED";
  canonicalPayload: string;
  payloadSha256: string;
  prevReceiptHash: string;
  merkleRoot: string;
  ed25519SignatureHex: string;
  publicKeyHex: string;
  signingScheme: SigningScheme;
  isTampered?: boolean;
}

export const DEFAULT_POLICIES: PolicyRule[] = [
  {
    id: "POL-01",
    name: "NO_ENV_EXFILTRATION",
    enabled: true,
    pattern: /(\.env|AWS_SECRET|PRIVATE_KEY|curl\s+.*-d|wget)/i,
    targetField: "arguments",
    weight: 95,
    action: "BLOCK_FAIL_CLOSED",
  },
  {
    id: "POL-02",
    name: "NO_DESTRUCTIVE_DDL",
    enabled: true,
    pattern: /\b(DROP\s+TABLE|TRUNCATE|DELETE\s+FROM\s+\w+\s*;?\s*$)/i,
    targetField: "arguments",
    weight: 90,
    action: "BLOCK_FAIL_CLOSED",
  },
  {
    id: "POL-03",
    name: "NO_RECURSIVE_SUBAGENT_SPAWN",
    enabled: true,
    pattern: /\b(spawn_agent|fork_worker|max_retries.*[5-9]\d*)/i,
    targetField: "arguments",
    weight: 75,
    action: "BLOCK_FAIL_CLOSED",
  },
];

// 1. Canonical JSON: deterministic key sorting
export function canonicalizeJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalizeJson).join(",") + "]";
  }
  const sortedKeys = Object.keys(value as Record<string, unknown>).sort();
  const pairs = sortedKeys.map((k) => {
    const v = (value as Record<string, unknown>)[k];
    return `${JSON.stringify(k)}:${canonicalizeJson(v)}`;
  });
  return "{" + pairs.join(",") + "}";
}

export function bufToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function hexToBytes(hex: string): Uint8Array {
  const matches = hex.match(/.{1,2}/g) ?? [];
  return new Uint8Array(matches.map((byte) => parseInt(byte, 16)));
}

export async function sha256Hex(input: string): Promise<string> {
  const subtle = typeof window !== "undefined" && window.crypto?.subtle ? window.crypto.subtle : globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("WebCrypto SubtleCrypto API unavailable in runtime.");
  }
  const encoded = new TextEncoder().encode(input);
  const hashBuffer = await subtle.digest("SHA-256", encoded);
  return bufToHex(hashBuffer);
}

export async function computeMerkleRoot(hashes: string[]): Promise<string> {
  if (hashes.length === 0) return "0".repeat(64);
  let layer = [...hashes];
  while (layer.length > 1) {
    const nextLayer: string[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      const left = layer[i];
      const right = i + 1 < layer.length ? layer[i + 1] : left;
      nextLayer.push(await sha256Hex(left + right));
    }
    layer = nextLayer;
  }
  return layer[0];
}

// 2. Resilient WebCrypto Initializer (Ed25519 -> HMAC-SHA256 Fallback)
export async function initSignerContext(): Promise<CryptoSignerContext> {
  const subtle = typeof window !== "undefined" && window.crypto?.subtle ? window.crypto.subtle : globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("WebCrypto SubtleCrypto API unavailable.");
  }

  try {
    const kp = (await subtle.generateKey(
      { name: "Ed25519" },
      true,
      ["sign", "verify"]
    )) as CryptoKeyPair;
    const rawPub = await subtle.exportKey("raw", kp.publicKey);
    return {
      scheme: "Ed25519",
      signKey: kp.privateKey,
      verifyKey: kp.publicKey,
      publicKeyHex: bufToHex(rawPub),
    };
  } catch {
    const hmacKey = (await subtle.generateKey(
      { name: "HMAC", hash: "SHA-256" },
      true,
      ["sign", "verify"]
    )) as CryptoKey;
    const rawKey = await subtle.exportKey("raw", hmacKey);
    const pubDigest = await sha256Hex(bufToHex(rawKey));
    return {
      scheme: "HMAC-SHA256-FALLBACK",
      signKey: hmacKey,
      verifyKey: hmacKey,
      publicKeyHex: `hmac-fp:${pubDigest.slice(0, 32)}`,
    };
  }
}

export async function signPayloadHash(
  ctx: CryptoSignerContext,
  payloadSha256: string
): Promise<string> {
  const subtle = typeof window !== "undefined" && window.crypto?.subtle ? window.crypto.subtle : globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("WebCrypto SubtleCrypto API unavailable.");
  }
  const data = new TextEncoder().encode(payloadSha256);
  const algorithm = ctx.scheme === "Ed25519" ? { name: "Ed25519" } : { name: "HMAC" };
  const sigBuf = await subtle.sign(algorithm, ctx.signKey, data);
  return bufToHex(sigBuf);
}

// 3. Tamper-Aware Cryptographic Verification
export async function verifyReceiptIntegrity(
  ctx: CryptoSignerContext,
  recomputedCanonicalPayload: string,
  storedPayloadSha256: string,
  signatureHex: string
): Promise<{ valid: boolean; reason: string }> {
  const currentHash = await sha256Hex(recomputedCanonicalPayload);
  if (currentHash !== storedPayloadSha256) {
    return {
      valid: false,
      reason: "PAYLOAD_HASH_MISMATCH (1-Byte Ledger Mutation Detected)",
    };
  }

  const subtle = typeof window !== "undefined" && window.crypto?.subtle ? window.crypto.subtle : globalThis.crypto?.subtle;
  if (!subtle) {
    return { valid: false, reason: "CRYPTO_SUBTLE_UNAVAILABLE" };
  }

  try {
    const algorithm = ctx.scheme === "Ed25519" ? { name: "Ed25519" } : { name: "HMAC" };
    const isSigValid = await subtle.verify(
      algorithm,
      ctx.verifyKey,
      hexToBytes(signatureHex) as unknown as BufferSource,
      new TextEncoder().encode(currentHash) as unknown as BufferSource
    );

    return {
      valid: isSigValid,
      reason: isSigValid
        ? `VERIFIED (${ctx.scheme})`
        : "SIGNATURE_VERIFICATION_FAILED (Tampered Signature)",
    };
  } catch (err) {
    return {
      valid: false,
      reason: `VERIFICATION_EXCEPTION: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export async function evaluateAndSignMCPCall(
  mcpRequest: MCPToolCall,
  policies: PolicyRule[],
  stepIndex: number,
  prevReceiptHash: string,
  priorLeafHashes: string[],
  ctx: CryptoSignerContext
): Promise<ExecutionReceipt> {
  const t0 = performance.now();
  const serializedArgs = JSON.stringify(mcpRequest.params.arguments);

  let score = 10; // Base operational risk for external tool invocation
  const matchedRules: string[] = [];
  let blocked = false;

  for (const rule of policies) {
    if (!rule.enabled) continue;
    const target =
      rule.targetField === "name" ? mcpRequest.params.name : serializedArgs;
    if (rule.pattern.test(target)) {
      score = Math.min(100, score + rule.weight);
      matchedRules.push(rule.id);
      if (rule.action === "BLOCK_FAIL_CLOSED") {
        blocked = true;
      }
    }
  }

  const decision = blocked ? "BLOCKED_FAIL_CLOSED" : "ALLOWED_VERIFIED";
  
  // Canonical JSON (sorted keys) serialization
  const canonicalPayload = canonicalizeJson({
    decision,
    matchedRules,
    mcpRequest,
    prevReceiptHash,
    stepIndex,
  });

  const payloadSha256 = await sha256Hex(canonicalPayload);
  const merkleRoot = await computeMerkleRoot([...priorLeafHashes, payloadSha256]);
  const ed25519SignatureHex = await signPayloadHash(ctx, payloadSha256);
  const elapsed = performance.now() - t0;
  const latencyMs = Number(Math.max(elapsed, 0.01).toFixed(2));

  return {
    stepIndex,
    timestamp: new Date().toISOString(),
    latencyMs,
    mcpRequest,
    blastRadiusScore: score,
    matchedRules,
    decision,
    canonicalPayload,
    payloadSha256,
    prevReceiptHash,
    merkleRoot,
    ed25519SignatureHex,
    publicKeyHex: ctx.publicKeyHex,
    signingScheme: ctx.scheme,
  };
}
