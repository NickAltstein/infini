import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  buildLedger,
  canonicalizeJson,
  evaluatePolicy,
  initSignerContext,
  merkleRoot,
  signPayload,
  tamperSignature,
  verifyPayload,
  POL_SQL,
} from "./birkin-engine.ts";
import { getScenario } from "./scenarios.ts";

test("RFC-8785: Canonicalizes JSON with deterministic key sorting", () => {
  const left = { b: 1, a: { d: true, c: "x" } };
  const right = { a: { c: "x", d: true }, b: 1 };
  const canonical = '{"a":{"c":"x","d":true},"b":1}';
  assert.equal(canonicalizeJson(left), canonical);
  assert.equal(canonicalizeJson(right), canonical);
  assert.equal(
    canonicalizeJson({ b: 1, a: 1, B: 1 }),
    '{"B":1,"a":1,"b":1}',
  );
});

test("RFC-8785: Canonicalizes arrays and primitive types deterministically", () => {
  assert.equal(
    canonicalizeJson(["b", 1, false, null, { z: 1, a: 2 }]),
    '["b",1,false,null,{"a":2,"z":1}]',
  );
  assert.equal(canonicalizeJson({ a: 1, b: undefined }), '{"a":1}');
  assert.equal(canonicalizeJson(-0), "0");
  assert.throws(() => canonicalizeJson(Number.NaN));
});

test("WebCrypto: Generates signer context and signs payload hash", async () => {
  const signer = await initSignerContext();
  assert.equal(signer.scheme, "Ed25519");
  assert.match(signer.keyId, /^[0-9a-f]{16}$/);
  const signed = await signPayload(signer, { tool: "db.query", n: 1 });
  assert.equal(signed.signature.length, 64);
  assert.equal(signed.hashHex.length, 64);

  const fallbackSubtle = {
    async generateKey(algorithm: { name?: string }, extractable: boolean, usages: KeyUsage[]) {
      if (algorithm?.name === "Ed25519") {
        throw new Error("Ed25519 unavailable");
      }
      return globalThis.crypto.subtle.generateKey(
        algorithm as AlgorithmIdentifier,
        extractable,
        usages,
      );
    },
    sign: globalThis.crypto.subtle.sign.bind(globalThis.crypto.subtle),
    verify: globalThis.crypto.subtle.verify.bind(globalThis.crypto.subtle),
    digest: globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle),
    exportKey: globalThis.crypto.subtle.exportKey.bind(globalThis.crypto.subtle),
  } as SubtleCrypto;
  const hmac = await initSignerContext(fallbackSubtle);
  assert.equal(hmac.scheme, "HMAC-SHA256");
  const hmacSigned = await signPayload(hmac, { ok: true });
  assert.equal(hmacSigned.signature.length, 32);
});

test("Integrity Verification: Validates uncorrupted payload and signature", async () => {
  const signer = await initSignerContext();
  const payload = { tool: "db.query", sql: "SELECT 1" };
  const signed = await signPayload(signer, payload);
  assert.equal(await verifyPayload(signer, payload, signed.signature), true);
});

test("Tamper Detection: Trips fail-closed on 1-byte payload corruption", async () => {
  const signer = await initSignerContext();
  const payload = { sql: "DROP TABLE users" };
  const signed = await signPayload(signer, payload);
  const corrupted = { sql: "EROP TABLE users" };
  assert.notEqual(canonicalizeJson(payload), canonicalizeJson(corrupted));
  assert.equal(await verifyPayload(signer, corrupted, signed.signature), false);
});

test("Tamper Detection: Trips fail-closed on tampered signature", async () => {
  const signer = await initSignerContext();
  const payload = { sql: "SELECT id FROM users WHERE id = $1" };
  const signed = await signPayload(signer, payload);
  const broken = tamperSignature(signed.signature);
  assert.equal(await verifyPayload(signer, payload, broken), false);
});

test("Merkle Tree: Generates deterministic root hash", async () => {
  const leaves = [
    createHash("sha256").update("left").digest("hex"),
    createHash("sha256").update("right").digest("hex"),
    createHash("sha256").update("odd").digest("hex"),
  ];
  const first = await merkleRoot(leaves);
  const second = await merkleRoot(leaves);
  assert.equal(first, second);
  assert.equal(first, referenceMerkle(leaves));
  assert.equal(
    await merkleRoot([]),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
});

test("Policy Gate: Fail-closed intercept on destructive SQL (POL-02)", () => {
  const decision = evaluatePolicy(
    "db.query",
    { sql: "DROP TABLE users" },
    [],
  );
  assert.equal(decision.decision, "deny");
  assert.equal(decision.policy, POL_SQL);
  const bypassed = evaluatePolicy(
    "db.query",
    { sql: "DROP TABLE users" },
    [POL_SQL],
  );
  assert.equal(bypassed.decision, "allow");
});

test("Policy Gate: Allows safe audited read call", () => {
  const decision = evaluatePolicy(
    "db.query",
    { sql: "SELECT id FROM users WHERE id = $1", params: [42] },
    [],
  );
  assert.equal(decision.decision, "allow");
  assert.equal(decision.rule, "audited-read");
});

test("Ledger: 1-byte parameter flip fails merkle root and signature", async () => {
  const signer = await initSignerContext();
  const scenario = getScenario("sql-blast");
  const clean = await buildLedger({
    steps: scenario.steps,
    signer,
    tamperStep: null,
    disabledPolicies: [],
  });
  assert.equal(clean.intact, true);
  assert.equal(clean.signedMerkleRoot, clean.displayedMerkleRoot);
  const dirty = await buildLedger({
    steps: scenario.steps,
    signer,
    tamperStep: 1,
    disabledPolicies: [],
  });
  assert.equal(dirty.frames[1].signatureOk, false);
  assert.equal(dirty.checkpointOk, false);
  assert.notEqual(dirty.signedMerkleRoot, dirty.displayedMerkleRoot);
  assert.equal(dirty.intact, false);
  assert.equal(dirty.frames[0].signatureOk, true);
});

function referenceMerkle(leaves: string[]): string {
  if (leaves.length === 0) {
    return createHash("sha256").update(Buffer.alloc(0)).digest("hex");
  }
  let level = leaves.map((hex) => Buffer.from(hex, "hex"));
  while (level.length > 1) {
    const next: Array<(typeof level)[number]> = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 < level.length) {
        next.push(
          createHash("sha256").update(Buffer.concat([level[i], level[i + 1]])).digest(),
        );
      } else {
        next.push(level[i]);
      }
    }
    level = next;
  }
  return level[0].toString("hex");
}
