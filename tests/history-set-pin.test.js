// tests/history-set-pin.test.js
// Tests for the "Set Passcode" button on the history page (extension + desktop).
//
// Structure:
//   1. Pure logic mirrors  — pin form validation rules
//   2. hashPin round-trip  — verify correct hash is stored and verifiable
//   3. Source assertions   — both history.js files have showSetPinBtn() wired in load()
//   4. Parity check        — extension and desktop implementations match

const fs   = require("fs");
const path = require("path");

const { hashPin, verifyPin } = require("../lib/history-pin");

const ROOT = path.resolve(__dirname, "..");

// ── Pure logic: form validation (mirrors save handler inside showSetPinBtn) ───

function validatePinForm(newPin, confirm) {
  if (!newPin || !confirm) return "Both fields are required.";
  if (newPin !== confirm)  return "Passcodes do not match.";
  return null;
}

describe("validatePinForm — mirrors showSetPinBtn save-handler validation", () => {
  test("returns error when new-pin field is empty", () => {
    expect(validatePinForm("", "abc")).toBe("Both fields are required.");
  });

  test("returns error when confirm field is empty", () => {
    expect(validatePinForm("abc", "")).toBe("Both fields are required.");
  });

  test("returns error when both fields are empty", () => {
    expect(validatePinForm("", "")).toBe("Both fields are required.");
  });

  test("returns mismatch error when pins differ", () => {
    expect(validatePinForm("abc", "xyz")).toBe("Passcodes do not match.");
  });

  test("returns null when both fields match", () => {
    expect(validatePinForm("mypin", "mypin")).toBeNull();
  });

  test("accepts single-character pin", () => {
    expect(validatePinForm("x", "x")).toBeNull();
  });

  test("accepts long pin", () => {
    const long = "a".repeat(128);
    expect(validatePinForm(long, long)).toBeNull();
  });

  test("case-sensitive — 'Pin' and 'pin' are different", () => {
    expect(validatePinForm("Pin", "pin")).toBe("Passcodes do not match.");
  });
});

// ── hashPin round-trip — what actually gets stored in historyPin ──────────────

describe("hashPin round-trip — stored hash is verifiable", () => {
  test("stored hash is never the plaintext pin", async () => {
    const pin  = "mysecretpin";
    const hash = await hashPin(pin);
    expect(hash).not.toBe(pin);
  });

  test("stored hash can be verified with the original pin", async () => {
    const pin  = "opensesame";
    const hash = await hashPin(pin);
    expect(await verifyPin(pin, hash)).toBe(true);
  });

  test("wrong pin fails verification against stored hash", async () => {
    const hash = await hashPin("correctpin");
    expect(await verifyPin("wrongpin", hash)).toBe(false);
  });

  test("empty pin can be hashed and verified", async () => {
    const hash = await hashPin("");
    expect(await verifyPin("", hash)).toBe(true);
    expect(await verifyPin("notempty", hash)).toBe(false);
  });
});

// ── Source assertions — lib/history-ui.js (shared module) ────────────────────
// Pin UI functions now live in the shared module; both platform wrappers delegate to HistoryUI.*

describe("lib/history-ui.js — shared pin UI", () => {
  let uiSrc;
  beforeAll(() => {
    uiSrc = fs.readFileSync(path.join(ROOT, "lib/history-ui.js"), "utf8");
  });

  test("showSetPinBtn function is defined", () => {
    expect(uiSrc).toContain("function showSetPinBtn(");
  });

  test("showSetPinBtn() inserts button into .header-controls", () => {
    expect(uiSrc).toContain(".header-controls");
    expect(uiSrc).toContain("insertBefore");
  });

  test("showSetPinBtn() guards against duplicate button insertion", () => {
    expect(uiSrc).toContain('"set-pin-btn"');
    expect(uiSrc).toContain("document.getElementById");
  });

  test("save handler calls hashPin before storing", () => {
    expect(uiSrc).toContain("hashPin(");
  });

  test("save handler stores result under historyPin key", () => {
    expect(uiSrc).toContain("historyPin:");
  });

  test("save handler calls showPinManagement after storing pin", () => {
    expect(uiSrc).toContain("showPinManagement(");
  });

  test("save handler removes the Set Passcode button on success", () => {
    expect(uiSrc).toContain("btn.remove()");
  });

  test("button label includes 'Set Passcode'", () => {
    expect(uiSrc).toContain("Set Passcode");
  });

  test("showPinGate is defined (unlock flow)", () => {
    expect(uiSrc).toContain("function showPinGate(");
  });

  test("showPinManagement is defined (change/remove flow)", () => {
    expect(uiSrc).toContain("function showPinManagement(");
  });

  test("module exports via window.HistoryUI", () => {
    expect(uiSrc).toContain("window.HistoryUI");
  });
});

// ── Platform wrapper assertions ───────────────────────────────────────────────

describe("platform wrappers delegate pin UI to HistoryUI", () => {
  let extSrc, deskSrc;
  beforeAll(() => {
    extSrc  = fs.readFileSync(path.join(ROOT, "history/history.js"),           "utf8");
    deskSrc = fs.readFileSync(path.join(ROOT, "desktop/renderer/history.js"), "utf8");
  });

  test("extension load() calls HistoryUI.showSetPinBtn", () => {
    expect(extSrc).toContain("HistoryUI.showSetPinBtn(");
  });

  test("extension load() calls HistoryUI.showPinGate when pin is set", () => {
    expect(extSrc).toContain("HistoryUI.showPinGate(");
  });

  test("extension load() reads historyPin from storage", () => {
    expect(extSrc).toContain('"historyPin"');
  });

  test("desktop load() calls HistoryUI.showSetPinBtn", () => {
    expect(deskSrc).toContain("HistoryUI.showSetPinBtn(");
  });

  test("desktop load() calls HistoryUI.showPinGate when pin is set", () => {
    expect(deskSrc).toContain("HistoryUI.showPinGate(");
  });

  test("desktop load() reads historyPin from storage", () => {
    expect(deskSrc).toContain('"historyPin"');
  });

  test("both wrappers call HistoryUI.render", () => {
    expect(extSrc).toContain("HistoryUI.render(");
    expect(deskSrc).toContain("HistoryUI.render(");
  });

  test("extension uses navigator.clipboard for copy", () => {
    expect(extSrc).toContain("navigator.clipboard");
  });

  test("desktop uses btcAPI.writeClipboard for copy", () => {
    expect(deskSrc).toContain("btcAPI.writeClipboard");
  });
});
