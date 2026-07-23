const {
  MENU_PROMPTS, buildPromptWithProfile, buildClarifyPrompt,
  DEFAULT_ACTION_SETTINGS, LOCKED_ACTIONS, resolveActionSettings,
} = require("../lib/prompts");

// ── MENU_PROMPTS ──────────────────────────────────────────────────────────────

describe("MENU_PROMPTS", () => {
  const EXPECTED_KEYS = [
    "fix-spelling", "sound-like-me", "professional", "sound-human",
    "brain-dump", "improve", "formal", "casual", "shorten", "expand"
  ];

  test("contains all expected menu item keys", () => {
    EXPECTED_KEYS.forEach(key => {
      expect(MENU_PROMPTS).toHaveProperty(key);
    });
  });

  test("every prompt is a non-empty string", () => {
    Object.entries(MENU_PROMPTS).forEach(([key, prompt]) => {
      expect(typeof prompt).toBe("string");
      expect(prompt.length).toBeGreaterThan(10);
    });
  });

  test("every prompt ends with a colon (instruction separator convention)", () => {
    const STRUCTURED_PROMPTS = new Set(["brain-to-prompt", "clarity-check"]);
    Object.entries(MENU_PROMPTS).forEach(([key, prompt]) => {
      if (STRUCTURED_PROMPTS.has(key)) return; // structured-output format; no trailing colon by design
      expect(prompt.trimEnd()).toMatch(/:$/);
    });
  });

  test("every prompt contains 'Return ONLY' (prevents AI from adding commentary)", () => {
    const STRUCTURED_PROMPTS = new Set(["brain-to-prompt", "clarity-check"]);
    Object.entries(MENU_PROMPTS).forEach(([key, prompt]) => {
      if (STRUCTURED_PROMPTS.has(key)) return; // structured-output format; uses explicit response schema
      expect(prompt).toContain("Return ONLY");
    });
  });

  test("sound-like-me prompt references authenticity to the person", () => {
    expect(MENU_PROMPTS["sound-like-me"]).toContain("voice");
  });

  test("brain-dump prompt mentions not losing information", () => {
    const p = MENU_PROMPTS["brain-dump"].toLowerCase();
    expect(p).toMatch(/lose|losing|lost/);
  });
});

// ── buildPromptWithProfile ────────────────────────────────────────────────────

describe("buildPromptWithProfile", () => {
  const BASE = "Fix spelling errors. Return ONLY the corrected text:";

  test("returns base prompt unchanged when profileEnabled is false", () => {
    expect(buildPromptWithProfile(BASE, { profileEnabled: false, profileName: "Bailey" })).toBe(BASE);
  });

  test("returns base prompt unchanged when profileEnabled is missing", () => {
    expect(buildPromptWithProfile(BASE, { profileName: "Bailey" })).toBe(BASE);
  });

  test("returns base prompt unchanged when settings is null", () => {
    expect(buildPromptWithProfile(BASE, null)).toBe(BASE);
  });

  test("returns base prompt unchanged when profileEnabled is true but all fields empty", () => {
    expect(buildPromptWithProfile(BASE, { profileEnabled: true })).toBe(BASE);
  });

  test("injects name when profileEnabled and name is set", () => {
    const result = buildPromptWithProfile(BASE, { profileEnabled: true, profileName: "Bailey" });
    expect(result).toContain("Bailey");
    expect(result).toContain(BASE);
  });

  test("injects role when provided", () => {
    const result = buildPromptWithProfile(BASE, { profileEnabled: true, profileRole: "Roofer" });
    expect(result).toContain("Roofer");
  });

  test("injects writing style when provided", () => {
    const result = buildPromptWithProfile(BASE, { profileEnabled: true, profileStyle: "Short sentences" });
    expect(result).toContain("Short sentences");
  });

  test("injects personal context when provided", () => {
    const ctx = "Runs a roofing company in Texas";
    const result = buildPromptWithProfile(BASE, { profileEnabled: true, profileContext: ctx });
    expect(result).toContain(ctx);
  });

  test("includes all four profile fields when all are set", () => {
    const s = {
      profileEnabled: true,
      profileName: "Bailey",
      profileRole: "Developer",
      profileStyle: "Casual, em-dashes",
      profileContext: "Builds Firefox extensions"
    };
    const result = buildPromptWithProfile(BASE, s);
    expect(result).toContain("Bailey");
    expect(result).toContain("Developer");
    expect(result).toContain("Casual, em-dashes");
    expect(result).toContain("Builds Firefox extensions");
  });

  test("base prompt appears after the profile block (profile first)", () => {
    const s = { profileEnabled: true, profileName: "Bailey" };
    const result = buildPromptWithProfile(BASE, s);
    const profileIdx = result.indexOf("Bailey");
    const baseIdx    = result.indexOf(BASE);
    expect(profileIdx).toBeLessThan(baseIdx);
  });

  test("uses a separator between profile and base prompt", () => {
    const s = { profileEnabled: true, profileName: "Bailey" };
    const result = buildPromptWithProfile(BASE, s);
    expect(result).toContain("</user_profile>");
  });

  test("only name provided — does not include empty role/style/context lines", () => {
    const s = { profileEnabled: true, profileName: "Bailey" };
    const result = buildPromptWithProfile(BASE, s);
    expect(result).not.toContain("Role:");
    expect(result).not.toContain("Writing style");
    expect(result).not.toContain("Personal context");
  });
});

// ── buildClarifyPrompt ────────────────────────────────────────────────────────

describe("buildClarifyPrompt", () => {
  const BASE = "Translate the following text to French. Return ONLY the translation:";

  test("returns a string", () => {
    expect(typeof buildClarifyPrompt(BASE)).toBe("string");
  });

  test("output contains the original base prompt verbatim", () => {
    expect(buildClarifyPrompt(BASE)).toContain(BASE);
  });

  test("output contains the CLARIFY: block format marker", () => {
    expect(buildClarifyPrompt(BASE)).toContain("CLARIFY:");
  });

  test("output instructs returning result OR CLARIFY block, never both", () => {
    expect(buildClarifyPrompt(BASE)).toContain("Never both");
  });

  test("base prompt appears before the clarify instructions", () => {
    const result = buildClarifyPrompt(BASE);
    expect(result.indexOf(BASE)).toBeLessThan(result.indexOf("CLARIFY:"));
  });

  test("output contains bullet placeholder for clarifying questions", () => {
    expect(buildClarifyPrompt(BASE)).toContain("•");
  });

  test("works with a multi-line base prompt", () => {
    const multi = "Rewrite this.\n\nKeep the tone casual. Return ONLY the result:";
    const result = buildClarifyPrompt(multi);
    expect(result).toContain(multi);
    expect(result).toContain("CLARIFY:");
  });
});

// ── DEFAULT_ACTION_SETTINGS ───────────────────────────────────────────────────

describe("DEFAULT_ACTION_SETTINGS", () => {
  test("contains exactly 12 actions", () => {
    expect(DEFAULT_ACTION_SETTINGS).toHaveLength(12);
  });

  test("every action has id (string), label (string), and enabled (boolean)", () => {
    for (const action of DEFAULT_ACTION_SETTINGS) {
      expect(typeof action.id).toBe("string");
      expect(typeof action.label).toBe("string");
      expect(typeof action.enabled).toBe("boolean");
    }
  });

  test("all actions are enabled by default", () => {
    DEFAULT_ACTION_SETTINGS.forEach(a => expect(a.enabled).toBe(true));
  });

  test("brain-to-prompt is the only action with clarify:true", () => {
    const clarify = DEFAULT_ACTION_SETTINGS.filter(a => a.clarify === true);
    expect(clarify).toHaveLength(1);
    expect(clarify[0].id).toBe("brain-to-prompt");
  });

  test("no duplicate action IDs", () => {
    const ids = DEFAULT_ACTION_SETTINGS.map(a => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("fix-spelling is the first action (default selected)", () => {
    expect(DEFAULT_ACTION_SETTINGS[0].id).toBe("fix-spelling");
  });
});

// ── LOCKED_ACTIONS membership ─────────────────────────────────────────────────

describe("LOCKED_ACTIONS membership", () => {
  const SHOULD_BE_LOCKED = [
    "fix-spelling", "sound-like-me", "professional",
    "sound-human", "brain-dump", "improve", "brain-to-prompt",
  ];
  const SHOULD_NOT_BE_LOCKED = ["formal", "casual", "shorten", "expand"];

  test("all core built-in action IDs are locked", () => {
    SHOULD_BE_LOCKED.forEach(id => expect(LOCKED_ACTIONS.has(id)).toBe(true));
  });

  test("style and length actions are not locked (user can rename them)", () => {
    SHOULD_NOT_BE_LOCKED.forEach(id => expect(LOCKED_ACTIONS.has(id)).toBe(false));
  });

  test("custom action IDs are not locked", () => {
    ["custom-0", "custom-1", "my-custom-thing"].forEach(id => {
      expect(LOCKED_ACTIONS.has(id)).toBe(false);
    });
  });
});

// ── resolveActionSettings (deep coverage) ────────────────────────────────────

describe("resolveActionSettings — deep coverage", () => {
  test("result contains all 12 default IDs when called with an empty array", () => {
    const result = resolveActionSettings([]);
    const ids = result.map(a => a.id);
    DEFAULT_ACTION_SETTINGS.forEach(def => expect(ids).toContain(def.id));
  });

  test("result is a copy — mutating it does not change DEFAULT_ACTION_SETTINGS", () => {
    const result = resolveActionSettings([]);
    result[0].label = "MUTATED";
    expect(DEFAULT_ACTION_SETTINGS[0].label).not.toBe("MUTATED");
  });

  test("missing action is inserted directly after its closest preceding default neighbor", () => {
    // Remove 'improve' (default index 1). It should land right after 'fix-spelling' (index 0).
    const stored = DEFAULT_ACTION_SETTINGS.filter(a => a.id !== "improve").map(a => ({ ...a }));
    const result = resolveActionSettings(stored);
    const fixIdx     = result.findIndex(a => a.id === "fix-spelling");
    const improveIdx = result.findIndex(a => a.id === "improve");
    expect(improveIdx).toBe(fixIdx + 1);
  });

  test("missing action with no preceding neighbor is inserted at the front", () => {
    // Only 'expand' (the last default) is stored — 'fix-spelling' has no preceding neighbor.
    const stored = [{ id: "expand", label: "Expand", enabled: true }];
    const result = resolveActionSettings(stored);
    expect(result[0].id).toBe("fix-spelling");
  });

  test("always returns all 11 defaults regardless of what is in stored", () => {
    const stored = [{ id: "formal", label: "Formal", enabled: false }];
    const result = resolveActionSettings(stored);
    expect(result).toHaveLength(DEFAULT_ACTION_SETTINGS.length);
  });

  test("preserves user-set enabled:false for a stored action", () => {
    const stored = DEFAULT_ACTION_SETTINGS.map(a => ({
      ...a,
      enabled: a.id === "shorten" ? false : a.enabled,
    }));
    const result = resolveActionSettings(stored);
    expect(result.find(a => a.id === "shorten").enabled).toBe(false);
  });

  test("null stored argument returns full defaults", () => {
    const result = resolveActionSettings(null);
    expect(result).toHaveLength(DEFAULT_ACTION_SETTINGS.length);
  });
});

// ── clarity-check action ──────────────────────────────────────────────────────

describe("clarity-check action", () => {
  test("clarity-check exists in DEFAULT_ACTION_SETTINGS", () => {
    expect(DEFAULT_ACTION_SETTINGS.some(a => a.id === "clarity-check")).toBe(true);
  });

  test("clarity-check exists in MENU_PROMPTS", () => {
    expect(MENU_PROMPTS["clarity-check"]).toBeTruthy();
  });

  test("clarity-check prompt references clarity scoring", () => {
    expect(MENU_PROMPTS["clarity-check"]).toMatch(/1.?10|scale/i);
  });

  test("clarity-check prompt asks What are you trying to say when unclear", () => {
    expect(MENU_PROMPTS["clarity-check"]).toContain("What are you trying to say");
  });

  test("clarity-check is in LOCKED_ACTIONS (built-in, cannot be renamed)", () => {
    expect(LOCKED_ACTIONS.has("clarity-check")).toBe(true);
  });
});

// ── buildPromptWithProfile — vocab injection ──────────────────────────────────

describe("buildPromptWithProfile — vocab injection", () => {
  const BASE = "Rewrite this. Return ONLY the rewritten text:";

  test("injects preferred words when profileVocab.prefer is set", () => {
    const s = { profileEnabled: true, profileName: "Bailey", profileVocab: { prefer: ["gonna", "hey"] } };
    const result = buildPromptWithProfile(BASE, s);
    expect(result).toContain("gonna");
    expect(result).toContain("hey");
  });

  test("injects avoided words when profileVocab.avoid is set", () => {
    const s = { profileEnabled: true, profileName: "Bailey", profileVocab: { avoid: ["leverage", "synergy"] } };
    const result = buildPromptWithProfile(BASE, s);
    expect(result).toContain("leverage");
    expect(result).toContain("synergy");
  });

  test("no vocab injected when profileVocab lists are empty", () => {
    const s = { profileEnabled: true, profileName: "Bailey", profileVocab: { prefer: [], avoid: [] } };
    const result = buildPromptWithProfile(BASE, s);
    expect(result).not.toContain("Preferred words");
    expect(result).not.toContain("Avoided words");
  });

  test("no vocab injected when profileVocab is absent", () => {
    const s = { profileEnabled: true, profileName: "Bailey" };
    const result = buildPromptWithProfile(BASE, s);
    expect(result).not.toContain("vocab");
  });

  test("vocab not injected when profileEnabled is false", () => {
    const s = { profileEnabled: false, profileVocab: { prefer: ["gonna"] } };
    expect(buildPromptWithProfile(BASE, s)).toBe(BASE);
  });

  test("vocab appears in the profile block before the base prompt", () => {
    const s = { profileEnabled: true, profileName: "Bailey", profileVocab: { prefer: ["gonna"], avoid: ["leverage"] } };
    const result = buildPromptWithProfile(BASE, s);
    const vocabIdx = result.indexOf("gonna");
    const baseIdx  = result.indexOf(BASE);
    expect(vocabIdx).toBeLessThan(baseIdx);
  });
});
