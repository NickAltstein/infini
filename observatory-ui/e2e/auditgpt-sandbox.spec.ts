import { test, expect } from "@playwright/test";

test.describe("AuditGPT.ai — Blast-Radius Simulator E2E Contract Suite", () => {
  test("1. URL Deep-Linking: Loads directly into halted DROP TABLE exploit frame", async ({ page }) => {
    // Navigate directly using shareable query parameters
    await page.goto("/?scenario=prod-drop-table&step=1");

    // Verify active scenario header and telemetry state
    await expect(page.locator("h2")).toContainText("postgres.execute_sql");
    await expect(page.locator("text=BLOCKED_FAIL_CLOSED")).toBeVisible();
    await expect(page.locator("text=90 / 100")).toBeVisible(); // High blast-radius score

    // Verify JSON-RPC frame inspects the destructive DDL
    const payloadInspector = page.locator("pre");
    await expect(payloadInspector).toContainText("DROP TABLE customer_settlements CASCADE;");
  });

  test("2. Cryptographic Integrity: Validates Ed25519 signature successfully", async ({ page }) => {
    await page.goto("/?scenario=poisoned-pr&step=2");

    // Click the Ed25519 signature verification button
    const verifyButton = page.locator("button", { hasText: "Verify Ed25519 Signature" });
    await verifyButton.click();

    // Assert successful cryptographic validation badge appears
    await expect(verifyButton).toContainText("✓ SIGNATURE VALIDATED");
  });

  test("3. Tamper Detection: 1-byte ledger mutation trips fail-closed verification", async ({ page }) => {
    await page.goto("/?scenario=poisoned-pr&step=2");

    // Trigger the 1-byte tamper simulation toggle/button
    const tamperButton = page.locator("button", { hasText: "Inject 1-Byte Tamper" });
    await tamperButton.click();

    // Verify signature verification now trips tamper detection in #F43F5E fail-closed rose-red
    const verifyButton = page.locator("button", { hasText: "Verify" });
    await verifyButton.click();

    await expect(verifyButton).toContainText("✗ TAMPER DETECTED");
    await expect(page.locator("text=PAYLOAD_HASH_MISMATCH")).toBeVisible();
  });

  test("4. INFINI Time-Travel Replay: Mutates payload and forks deterministic trace", async ({ page }) => {
    await page.goto("/?scenario=poisoned-pr&step=2");

    // Locate the editable JSON arguments textarea in the INFINI time-travel panel
    const argTextArea = page.locator("textarea");
    await expect(argTextArea).toBeVisible();

    // Mutate argument to a safe path
    await argTextArea.fill(JSON.stringify({ path: "./src/config/safe-read.ts" }, null, 2));

    // Click fork and replay
    const forkButton = page.locator("button", { hasText: "Fork Trace & Replay" });
    await forkButton.click();

    // Verify decision shifts from blocked to allowed after argument sanitation
    await expect(page.locator("text=ALLOWED_VERIFIED")).toBeVisible();
  });
});

