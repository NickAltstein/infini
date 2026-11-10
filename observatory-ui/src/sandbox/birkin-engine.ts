/**
 * Browser-side interceptor primitives for the blast-radius sandbox.
 *
 * Canonical JSON sorts object keys by UTF-16 code unit and emits compact
 * JSON (RFC 8785 key order). Finite numbers use JSON number serialization,
 * with -0 written as 0. Strings, arrays, booleans, and null follow JSON.
 *
 * Receipts are SHA-256 over those bytes. The signer signs the raw digest.
 * Ed25519 is preferred; HMAC-SHA256 is the session fallback when WebCrypto
 * has no Ed25519 implementation. Merkle leaves are those digests. Odd nodes
 * are promoted unchanged, matching birkin.crypto.merkle_root.
 */

export type SignerScheme = "Ed25519" | "HMAC-SHA256";

export interface SignerContext {
  scheme: SignerScheme;
  keyId: string;
  sign(message: Uint8Array): Promise<Uint8Array>;
  verify(message: Uint8Array, signature: Uint8Array): Promise<boolean>;
}

export interface PolicyDecision {
  decision: "allow" | "deny";
  policy: string;
  rule: string;
  reason: string;
}

export interface SignedPayload {
  step: number;
  tool: string;
  args: Record<string, unknown>;
  decision: "allow" | "deny";
  policy: string;
  rule: string;
  disabledPolicies: string[];
}

export interface ByteFlip {
  value: Record<string, unknown>;
  path: string;
  before: string;
  after: string;
}

export interface LedgerFrame {
  index: number;
  title: string;
  tool: string;
  signedArgs: Record<string, unknown>;
  displayedArgs: Record<string, unknown>;
  tamper: ByteFlip | null;
  decision: PolicyDecision;
  reached: boolean;
  canonicalSigned: string;
  canonicalDisplayed: string;
  signedPayloadHash: string;
  displayedPayloadHash: string;
  signatureB64: string;
  signatureOk: boolean;
  effect: string;
}

export interface Ledger {
  scheme: SignerScheme;
  keyId: string;
  frames: LedgerFrame[];
  signedMerkleRoot: string;
  displayedMerkleRoot: string;
  checkpointSignatureB64: string;
  checkpointOk: boolean;
  intact: boolean;
}

export interface LedgerStep {
  title: string;
  tool: string;
  args: Record<string, unknown>;
  effectWhenAllowed: string;
  effectWhenDenied: string;
}

const DESTRUCTIVE_SQL =
  /\b(drop|truncate|delete|alter|insert|update|grant|revoke|create)\b/i;
const DESTRUCTIVE_SHELL = /\brm\b|\bmkfs\b|\bdd\b|chmod\s+-R|:\(\)\s*\{/;

export const POL_SHELL = "POL-01";
export const POL_SQL = "POL-02";

export function canonicalizeJson(value: unknown): string {
  return encode(value);
}

export function evaluatePolicy(
  tool: string,
  args: Record<string, unknown>,
  disabledPolicies: readonly string[],
): PolicyDecision {
  const disabled = new Set(disabledPolicies);

  if (tool === "db.query" || tool === "sql.exec") {
    const sql = String(args.sql ?? args.query ?? "");
    if (DESTRUCTIVE_SQL.test(sql)) {
      if (disabled.has(POL_SQL)) {
        return {
          decision: "allow",
          policy: POL_SQL,
          rule: "destructive-sql",
          reason: "POL-02 disabled by operator. Destructive SQL is not intercepted.",
        };
      }
      return {
        decision: "deny",
        policy: POL_SQL,
        rule: "destructive-sql",
        reason: "Fail-closed: destructive SQL is intercepted.",
      };
    }
    return {
      decision: "allow",
      policy: "POL-00",
      rule: "audited-read",
      reason: "Read query is allowed and written to the audit ledger.",
    };
  }

  if (tool === "shell.exec") {
    const cmd = String(args.cmd ?? args.command ?? "");
    if (DESTRUCTIVE_SHELL.test(cmd)) {
      if (disabled.has(POL_SHELL)) {
        return {
          decision: "allow",
          policy: POL_SHELL,
          rule: "destructive-shell",
          reason: "POL-01 disabled by operator. Destructive shell is not intercepted.",
        };
      }
      return {
        decision: "deny",
        policy: POL_SHELL,
        rule: "destructive-shell",
        reason: "Fail-closed: destructive shell is intercepted.",
      };
    }
  }

  if (tool === "fs.read" || tool === "audit.append") {
    return {
      decision: "allow",
      policy: "POL-00",
      rule: "audited-read",
      reason: "Read-only audited call is allowed.",
    };
  }

  return {
    decision: "deny",
    policy: "POL-99",
    rule: "default-deny",
    reason: "Fail-closed: tool is not on the allow list.",
  };
}

export function flipOneByte(args: Record<string, unknown>): ByteFlip {
  const clone = structuredClone(args);
  const hit = flipIn(clone, "");
  if (!hit) {
    throw new Error("execution parameters contain no string byte to flip");
  }
  return { value: clone, path: hit.path, before: hit.before, after: hit.after };
}

export async function initSignerContext(
  subtle: SubtleCrypto = globalThis.crypto.subtle,
): Promise<SignerContext> {
  try {
    const generated = await subtle.generateKey({ name: "Ed25519" }, true, [
      "sign",
      "verify",
    ]);
    if (!isKeyPair(generated)) {
      throw new Error("Ed25519 generateKey did not return a key pair");
    }
    const probe = new Uint8Array([0]);
    await subtle.sign({ name: "Ed25519" }, generated.privateKey, probe);
    const rawPublic = new Uint8Array(
      await subtle.exportKey("raw", generated.publicKey),
    );
    return {
      scheme: "Ed25519",
      keyId: await fingerprint(subtle, rawPublic),
      sign: (message) =>
        signBytes(subtle, { name: "Ed25519" }, generated.privateKey, message),
      verify: (message, signature) =>
        verifyBytes(
          subtle,
          { name: "Ed25519" },
          generated.publicKey,
          message,
          signature,
        ),
    };
  } catch {
    const hmacKey = await subtle.generateKey(
      { name: "HMAC", hash: "SHA-256" },
      true,
      ["sign", "verify"],
    );
    if (isKeyPair(hmacKey)) {
      throw new Error("HMAC generateKey returned a key pair");
    }
    const raw = new Uint8Array(await subtle.exportKey("raw", hmacKey));
    return {
      scheme: "HMAC-SHA256",
      keyId: await fingerprint(subtle, raw),
      sign: (message) =>
        signBytes(subtle, { name: "HMAC" }, hmacKey, message),
      verify: (message, signature) =>
        verifyBytes(subtle, { name: "HMAC" }, hmacKey, message, signature),
    };
  }
}

export async function signPayload(
  signer: SignerContext,
  payload: unknown,
): Promise<{ canonical: string; hashHex: string; signature: Uint8Array }> {
  const canonical = canonicalizeJson(payload);
  const hashHex = await sha256Hex(utf8(canonical));
  const signature = await signer.sign(hexToBytes(hashHex));
  return { canonical, hashHex, signature };
}

export async function verifyPayload(
  signer: SignerContext,
  payload: unknown,
  signature: Uint8Array,
): Promise<boolean> {
  const canonical = canonicalizeJson(payload);
  const hashHex = await sha256Hex(utf8(canonical));
  return signer.verify(hexToBytes(hashHex), signature);
}

export async function merkleRoot(leafHashes: readonly string[]): Promise<string> {
  if (leafHashes.length === 0) {
    return sha256Hex(new Uint8Array());
  }
  let level = leafHashes.map((hex) => hexToBytes(hex));
  while (level.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      if (i + 1 < level.length) {
        const right = level[i + 1];
        const combined = new Uint8Array(left.length + right.length);
        combined.set(left, 0);
        combined.set(right, left.length);
        next.push(new Uint8Array(await digestSha256(combined)));
      } else {
        next.push(left);
      }
    }
    level = next;
  }
  return bytesToHex(level[0]);
}

export async function buildLedger(input: {
  steps: readonly LedgerStep[];
  signer: SignerContext;
  tamperStep: number | null;
  disabledPolicies: readonly string[];
}): Promise<Ledger> {
  const disabledPolicies = [...input.disabledPolicies].sort();
  const signedFrames: Array<{
    step: LedgerStep;
    index: number;
    decision: PolicyDecision;
    canonical: string;
    hashHex: string;
    signature: Uint8Array;
  }> = [];

  for (let index = 0; index < input.steps.length; index += 1) {
    const step = input.steps[index];
    const decision = evaluatePolicy(step.tool, step.args, disabledPolicies);
    const payload: SignedPayload = {
      step: index,
      tool: step.tool,
      args: step.args,
      decision: decision.decision,
      policy: decision.policy,
      rule: decision.rule,
      disabledPolicies,
    };
    const signed = await signPayload(input.signer, payload);
    signedFrames.push({
      step,
      index,
      decision,
      canonical: signed.canonical,
      hashHex: signed.hashHex,
      signature: signed.signature,
    });
  }

  const firstDeny = signedFrames.findIndex(
    (frame) => frame.decision.decision === "deny",
  );
  const frames: LedgerFrame[] = [];

  for (const signed of signedFrames) {
    const tamper =
      input.tamperStep === signed.index ? flipOneByte(signed.step.args) : null;
    const displayedArgs = tamper ? tamper.value : signed.step.args;
    const displayedPayload: SignedPayload = {
      step: signed.index,
      tool: signed.step.tool,
      args: displayedArgs,
      decision: signed.decision.decision,
      policy: signed.decision.policy,
      rule: signed.decision.rule,
      disabledPolicies,
    };
    const canonicalDisplayed = canonicalizeJson(displayedPayload);
    const displayedPayloadHash = await sha256Hex(utf8(canonicalDisplayed));
    const signatureOk = await input.signer.verify(
      hexToBytes(displayedPayloadHash),
      signed.signature,
    );
    const reached = firstDeny === -1 || signed.index <= firstDeny;
    frames.push({
      index: signed.index,
      title: signed.step.title,
      tool: signed.step.tool,
      signedArgs: signed.step.args,
      displayedArgs,
      tamper,
      decision: signed.decision,
      reached,
      canonicalSigned: signed.canonical,
      canonicalDisplayed,
      signedPayloadHash: signed.hashHex,
      displayedPayloadHash,
      signatureB64: bytesToBase64(signed.signature),
      signatureOk,
      effect:
        signed.decision.decision === "allow"
          ? signed.step.effectWhenAllowed
          : signed.step.effectWhenDenied,
    });
  }

  const signedMerkleRoot = await merkleRoot(
    frames.map((frame) => frame.signedPayloadHash),
  );
  const displayedMerkleRoot = await merkleRoot(
    frames.map((frame) => frame.displayedPayloadHash),
  );
  const checkpointSignature = await input.signer.sign(
    hexToBytes(signedMerkleRoot),
  );
  const checkpointOk = await input.signer.verify(
    hexToBytes(displayedMerkleRoot),
    checkpointSignature,
  );
  const intact =
    checkpointOk && frames.every((frame) => frame.signatureOk);

  return {
    scheme: input.signer.scheme,
    keyId: input.signer.keyId,
    frames,
    signedMerkleRoot,
    displayedMerkleRoot,
    checkpointSignatureB64: bytesToBase64(checkpointSignature),
    checkpointOk,
    intact,
  };
}

export function tamperSignature(signature: Uint8Array): Uint8Array {
  const copy = new Uint8Array(signature);
  if (copy.length === 0) {
    throw new Error("empty signature");
  }
  copy[0] = copy[0] ^ 0x01;
  return copy;
}

export function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error("hex digest must have even length");
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) {
      throw new Error("invalid hex digest");
    }
    out[i] = byte;
  }
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function encode(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("non-finite numbers are not canonical JSON");
    }
    if (Object.is(value, -0)) return "0";
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => encode(item === undefined ? null : item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${encode(record[key])}`)
      .join(",")}}`;
  }
  throw new TypeError(`cannot canonicalize ${typeof value}`);
}

function flipIn(
  value: unknown,
  path: string,
): { path: string; before: string; after: string } | null {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const childPath = `${path}[${i}]`;
      if (typeof value[i] === "string" && value[i].length > 0) {
        const flipped = flipChar(value[i]);
        value[i] = flipped.next;
        return { path: childPath, before: flipped.before, after: flipped.after };
      }
      const nested = flipIn(value[i], childPath);
      if (nested) return nested;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const childPath = path ? `${path}.${key}` : key;
    const child = record[key];
    if (typeof child === "string" && child.length > 0) {
      const flipped = flipChar(child);
      record[key] = flipped.next;
      return { path: childPath, before: flipped.before, after: flipped.after };
    }
    const nested = flipIn(child, childPath);
    if (nested) return nested;
  }
  return null;
}

function flipChar(input: string): { next: string; before: string; after: string } {
  const chars = Array.from(input);
  const before = chars[0];
  const code = before.codePointAt(0) ?? 0;
  let after = String.fromCodePoint(code ^ 0x01);
  if (after === before) after = "X";
  chars[0] = after;
  return { next: chars.join(""), before, after };
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  return bytesToHex(new Uint8Array(await digestSha256(data)));
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function digestSha256(data: Uint8Array): Promise<ArrayBuffer> {
  return globalThis.crypto.subtle.digest("SHA-256", data as BufferSource);
}

async function fingerprint(
  subtle: SubtleCrypto,
  material: Uint8Array,
): Promise<string> {
  const digest = new Uint8Array(
    await subtle.digest("SHA-256", material as BufferSource),
  );
  return bytesToHex(digest).slice(0, 16);
}

function isKeyPair(value: CryptoKey | CryptoKeyPair): value is CryptoKeyPair {
  return (
    typeof value === "object" &&
    value !== null &&
    "privateKey" in value &&
    "publicKey" in value
  );
}

async function signBytes(
  subtle: SubtleCrypto,
  algorithm: AlgorithmIdentifier,
  key: CryptoKey,
  message: Uint8Array,
): Promise<Uint8Array> {
  return new Uint8Array(
    await subtle.sign(algorithm, key, message as BufferSource),
  );
}

async function verifyBytes(
  subtle: SubtleCrypto,
  algorithm: AlgorithmIdentifier,
  key: CryptoKey,
  message: Uint8Array,
  signature: Uint8Array,
): Promise<boolean> {
  try {
    return await subtle.verify(
      algorithm,
      key,
      signature as BufferSource,
      message as BufferSource,
    );
  } catch {
    return false;
  }
}
