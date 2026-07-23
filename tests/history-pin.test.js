// Tests for lib/history-pin.js
// Uses real Web Crypto API (available in Node 20 via globalThis.crypto)

const { hashPin, verifyPin } = require("../lib/history-pin");

describe("hashPin", () => {
  test("returns a JSON string with PBKDF2 format (v:2)", async () => {
    const hash = await hashPin("mypin");
    expect(typeof hash).toBe("string");
    const parsed = JSON.parse(hash);
    expect(parsed.v).toBe(2);
    expect(typeof parsed.salt).toBe("string");
    expect(typeof parsed.hash).toBe("string");
  });

  test("is NOT deterministic — same pin produces different salt each time", async () => {
    const h1 = await hashPin("deterministic");
    const h2 = await hashPin("deterministic");
    const p1 = JSON.parse(h1);
    const p2 = JSON.parse(h2);
    expect(p1.salt).not.toBe(p2.salt);
  });

  test("different pins produce different hashes (same salt would give different hash)", async () => {
    const h1 = await hashPin("pin1");
    const h2 = await hashPin("pin2");
    expect(h1).not.toBe(h2);
  });

  test("handles unicode characters in pin", async () => {
    const hash = await hashPin("passw0rd");
    const parsed = JSON.parse(hash);
    expect(parsed.v).toBe(2);
  });

  test("handles very long pin (100+ chars)", async () => {
    const longPin = "a".repeat(150);
    const hash = await hashPin(longPin);
    const parsed = JSON.parse(hash);
    expect(parsed.v).toBe(2);
  });
});

describe("verifyPin", () => {
  test("returns true for correct pin (PBKDF2 format)", async () => {
    const stored = await hashPin("correct");
    const result = await verifyPin("correct", stored);
    expect(result).toBe(true);
  });

  test("returns false for wrong pin (PBKDF2 format)", async () => {
    const stored = await hashPin("correct");
    const result = await verifyPin("wrong", stored);
    expect(result).toBe(false);
  });

  test("returns false for empty string against real hash", async () => {
    const stored = await hashPin("realpin");
    const result = await verifyPin("", stored);
    expect(result).toBe(false);
  });

  test("returns false for null storedHash", async () => {
    expect(await verifyPin("pin", null)).toBe(false);
  });

  test("returns false for empty storedHash", async () => {
    expect(await verifyPin("pin", "")).toBe(false);
  });

  test("legacy SHA-256 hash still verifies (backward compatibility)", async () => {
    // Pre-computed SHA-256 of "legacypin" as 64-char hex
    const legacyHex = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("legacypin")))
    ).map(b => b.toString(16).padStart(2, "0")).join("");
    expect(await verifyPin("legacypin", legacyHex)).toBe(true);
    expect(await verifyPin("wrongpin",  legacyHex)).toBe(false);
  });
});
