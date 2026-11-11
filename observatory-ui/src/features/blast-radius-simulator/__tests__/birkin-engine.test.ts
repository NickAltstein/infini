import { describe, test, expect } from "bun:test";
import {
  canonicalizeJson,
  initSignerContext,
  sha256Hex,
  computeMerkleRoot,
  signPayloadHash,
  verifyReceiptIntegrity,
  evaluateAndSignMCPCall,
  formatLatency,
  DEFAULT_POLICIES,
  type MCPToolCall,
} from "../lib/birkin-engine";

describe("Birkin Deterministic Crypto Engine & Policy Firewall", () => {
  test("Canonical JSON: Canonicalizes JSON with deterministic key sorting", () => {
    const objA = { z: 1, a: 2, m: { nested_b: "foo", nested_a: "bar" } };
    const objB = { m: { nested_a: "bar", nested_b: "foo" }, a: 2, z: 1 };

    const canonA = canonicalizeJson(objA);
    const canonB = canonicalizeJson(objB);

    expect(canonA).toBe(canonB);
    expect(canonA).toBe('{"a":2,"m":{"nested_a":"bar","nested_b":"foo"},"z":1}');
  });

  test("Canonical JSON: Canonicalizes arrays and primitive types deterministically", () => {
    expect(canonicalizeJson(null)).toBe("null");
    expect(canonicalizeJson(123)).toBe("123");
    expect(canonicalizeJson("test")).toBe('"test"');
    expect(canonicalizeJson([3, 2, 1])).toBe("[3,2,1]");
    expect(canonicalizeJson([{ b: 1, a: 2 }])).toBe('[{"a":2,"b":1}]');
  });

  test("WebCrypto: Generates signer context and signs payload hash", async () => {
    const ctx = await initSignerContext();
    expect(["Ed25519", "HMAC-SHA256-FALLBACK"]).toContain(ctx.scheme);
    expect(ctx.publicKeyHex.length).toBeGreaterThan(10);

    const testHash = await sha256Hex("mcp-payload-content");
    const sig = await signPayloadHash(ctx, testHash);
    expect(sig.length).toBeGreaterThan(32);
  });

  test("Integrity Verification: Validates uncorrupted payload and signature", async () => {
    const ctx = await initSignerContext();
    const payload = canonicalizeJson({
      decision: "BLOCKED_FAIL_CLOSED",
      step: 1,
      target: "rm -rf /",
    });
    const hash = await sha256Hex(payload);
    const sig = await signPayloadHash(ctx, hash);

    const result = await verifyReceiptIntegrity(ctx, payload, hash, sig);
    expect(result.valid).toBe(true);
    expect(result.reason).toContain("VERIFIED");
  });

  test("Tamper Detection: Trips fail-closed on 1-byte payload corruption", async () => {
    const ctx = await initSignerContext();
    const originalPayload = canonicalizeJson({
      query: "DROP TABLE users;",
      status: "BLOCKED",
    });
    const hash = await sha256Hex(originalPayload);
    const sig = await signPayloadHash(ctx, hash);

    // Corrupt single byte in payload
    const corruptedPayload = originalPayload.replace("DROP TABLE", "SELECT ALL");

    const result = await verifyReceiptIntegrity(ctx, corruptedPayload, hash, sig);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("PAYLOAD_HASH_MISMATCH");
    expect(result.reason).toContain("1-Byte Ledger Mutation Detected");
  });

  test("Tamper Detection: Trips fail-closed on tampered signature", async () => {
    const ctx = await initSignerContext();
    const payload = canonicalizeJson({ test: "data" });
    const hash = await sha256Hex(payload);
    const validSig = await signPayloadHash(ctx, hash);

    // Mutate signature hex
    const flippedNibble = validSig[0] === "a" ? "b" : "a";
    const corruptedSig = flippedNibble + validSig.slice(1);

    const result = await verifyReceiptIntegrity(ctx, payload, hash, corruptedSig);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("SIGNATURE_VERIFICATION_FAILED");
  });

  test("Merkle Tree: Generates deterministic root hash", async () => {
    const rootEmpty = await computeMerkleRoot([]);
    expect(rootEmpty).toBe("0".repeat(64));

    const leaf1 = await sha256Hex("leaf-1");
    const leaf2 = await sha256Hex("leaf-2");

    const rootSingle = await computeMerkleRoot([leaf1]);
    expect(rootSingle).toBe(leaf1);

    const rootPair = await computeMerkleRoot([leaf1, leaf2]);
    const expectedPair = await sha256Hex(leaf1 + leaf2);
    expect(rootPair).toBe(expectedPair);
  });

  test("Policy Gate: Fail-closed intercept on destructive SQL (POL-02)", async () => {
    const ctx = await initSignerContext();
    const mcpCall: MCPToolCall = {
      jsonrpc: "2.0",
      id: "call-1",
      method: "tools/call",
      params: {
        name: "postgres.execute_sql",
        arguments: {
          query: "DROP TABLE customer_settlements CASCADE;",
        },
      },
    };

    const receipt = await evaluateAndSignMCPCall(
      mcpCall,
      DEFAULT_POLICIES,
      1,
      "0".repeat(64),
      [],
      ctx
    );

    expect(receipt.decision).toBe("BLOCKED_FAIL_CLOSED");
    expect(receipt.blastRadiusScore).toBeGreaterThanOrEqual(90);
    expect(receipt.matchedRules).toContain("POL-02");
    expect(receipt.ed25519SignatureHex.length).toBeGreaterThan(0);
    expect(receipt.canonicalPayload).toContain("DROP TABLE customer_settlements CASCADE;");
  });

  test("Policy Gate: Allows safe audited read call", async () => {
    const ctx = await initSignerContext();
    const mcpCall: MCPToolCall = {
      jsonrpc: "2.0",
      id: "call-2",
      method: "tools/call",
      params: {
        name: "postgres.read_schema",
        arguments: {
          table: "users",
        },
      },
    };

    const receipt = await evaluateAndSignMCPCall(
      mcpCall,
      DEFAULT_POLICIES,
      2,
      "0".repeat(64),
      [],
      ctx
    );

    expect(receipt.decision).toBe("ALLOWED_VERIFIED");
    expect(receipt.blastRadiusScore).toBe(10);
    expect(receipt.matchedRules.length).toBe(0);
    expect(receipt.latencyMs).toBeGreaterThan(0);
  });

  test("Latency formatting: handles sub-0.01ms, measured floats, and idle", () => {
    expect(formatLatency(null)).toBe("—");
    expect(formatLatency(undefined)).toBe("—");
    expect(formatLatency(0)).toBe("<0.01ms");
    expect(formatLatency(0.004)).toBe("<0.01ms");
    expect(formatLatency(0.01)).toBe("0.01ms");
    expect(formatLatency(0.123)).toBe("0.12ms");
    expect(formatLatency(1.4)).toBe("1.40ms");
  });
});

