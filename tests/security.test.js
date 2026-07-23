const fs   = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

const SCAN_EXTENSIONS = new Set([".js", ".json", ".html", ".css", ".md"]);
const EXCLUDE_DIRS    = new Set(["node_modules", "coverage", ".git", "tests", "scripts", "ETC", "dist"]);

// ── file collection ────────────────────────────────────────────────────────────

function collectFiles(dir, results = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!EXCLUDE_DIRS.has(entry.name)) collectFiles(path.join(dir, entry.name), results);
    } else if (SCAN_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      results.push(path.join(dir, entry.name));
    }
  }
  return results;
}

function jsFiles(dir) {
  return collectFiles(dir).filter(f => f.endsWith(".js"));
}

function scanLines(files, pattern) {
  const hits = [];
  for (const file of files) {
    const rel   = path.relative(ROOT, file);
    const lines = fs.readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      pattern.lastIndex = 0;
      if (pattern.test(line)) hits.push(`${rel}:${i + 1}  →  ${line.trim()}`);
    });
  }
  return hits;
}

function failWithHits(label, hits) {
  if (hits.length > 0) {
    throw new Error(
      `${label} in ${hits.length} location(s):\n` +
      hits.map(h => `  ${h}`).join("\n")
    );
  }
}

// ── credential scan ────────────────────────────────────────────────────────────

const SENSITIVE_PATTERNS = [
  { name: "OpenAI API key",    pattern: /sk-[a-zA-Z0-9]{20,}/g },
  { name: "Anthropic API key", pattern: /sk-ant-[a-zA-Z0-9\-]{20,}/g },
  { name: "Google API key",    pattern: /AIza[a-zA-Z0-9_\-]{35}/g },
  { name: "AWS access key",    pattern: /AKIA[A-Z0-9]{16}/g },
  { name: "Private key block", pattern: /-----BEGIN .* PRIVATE KEY-----/g },
  { name: "Generic secret",    pattern: /['"](?:secret|password|passwd|token)['"]\s*:\s*['"][^'"]{8,}['"]/gi },
];

describe("sensitive data scan", () => {
  const files = collectFiles(ROOT);

  test("source files were found to scan", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const { name, pattern } of SENSITIVE_PATTERNS) {
    test(`no hardcoded ${name} found`, () => {
      const hits = [];
      for (const file of files) {
        const rel     = path.relative(ROOT, file);
        const content = fs.readFileSync(file, "utf8");
        const lines   = content.split("\n");
        lines.forEach((line, i) => {
          const matches = line.match(pattern);
          if (matches) hits.push(`${rel}:${i + 1}  →  ${line.trim()}`);
        });
        pattern.lastIndex = 0;
      }
      failWithHits(`Found possible ${name}`, hits);
    });
  }
});

// ── browser extension security principles ──────────────────────────────────────

describe("browser extension security principles", () => {
  const src = jsFiles(ROOT);

  // ── dangerous code execution ────────────────────────────────────────────────

  test("no eval() — arbitrary code execution", () => {
    // eval() runs any string as code; a single XSS or rogue message can hijack the extension
    failWithHits("eval() found", scanLines(src, /\beval\s*\(/g));
  });

  test("no new Function() — runtime code generation", () => {
    // new Function() is eval in disguise; same risk, same ban
    failWithHits("new Function() found", scanLines(src, /new\s+Function\s*\(/g));
  });

  test("no document.write() — overwrites the page", () => {
    // document.write() called after load replaces the entire DOM; XSS and data-loss risk
    failWithHits("document.write() found", scanLines(src, /document\.write\s*\(/g));
  });

  test("no string-argument setTimeout/setInterval — eval equivalent", () => {
    // setTimeout("code()") evaluates a string like eval(); always pass a function instead
    failWithHits(
      "String-based setTimeout/setInterval found",
      scanLines(src, /(?:setTimeout|setInterval)\s*\(\s*['"`]/g)
    );
  });

  // ── network security ────────────────────────────────────────────────────────

  test("all fetch() calls use HTTPS — no plaintext HTTP", () => {
    // HTTP requests can be intercepted and modified in transit (MITM); API keys sent over
    // HTTP are exposed. All three provider base URLs must be HTTPS-only.
    failWithHits(
      "Insecure HTTP fetch found",
      scanLines(src, /fetch\s*\(\s*['"]http:\/\//g)
    );
  });

  test("no hardcoded HTTP API base URLs", () => {
    // Catch base-URL constants that might be swapped into fetch calls later.
    // 127.0.0.1:47391 is the local extension↔desktop sync server — loopback only, intentional.
    failWithHits(
      "HTTP base URL found",
      scanLines(src, /(?:const|let|var|=)\s*[^=]*['"]http:\/\/(?!localhost)(?!127\.)[^'"]+['"]/g)
    );
  });

  test("fetch() only calls permitted external hosts", () => {
    // Any new external host must be explicitly reviewed and added to ALLOWED_HOSTS.
    // 127.0.0.1 is the local sync server; no port restriction enforced here.
    const ALLOWED_HOSTS = [
      "api.openai.com",
      "api.anthropic.com",
      "generativelanguage.googleapis.com",
      "models.inference.ai.azure.com",
      "api.gumroad.com",
      "127.0.0.1",
      "localhost",
    ];
    const hits = [];
    for (const file of src) {
      const rel   = path.relative(ROOT, file);
      const lines = fs.readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        const m = line.match(/fetch\s*\(\s*['"`]https?:\/\/([^/'"` ]+)/);
        if (!m) return;
        const host = m[1].split(":")[0]; // strip optional port
        if (!ALLOWED_HOSTS.includes(host)) {
          hits.push(`${rel}:${i + 1}  →  ${line.trim()}`);
        }
      });
    }
    failWithHits("fetch() to unlisted host found", hits);
  });

  test("console.log/error do not log API key values", () => {
    // Logging key field names alongside their values would expose secrets in DevTools.
    // Pattern: console.log( ... keyFieldName ... ) on the same line as the value variable.
    const KEY_FIELDS = /(?:openaiKey|claudeKey|geminiKey|licenseKey|apiKey|api_key)/i;
    const hits = [];
    for (const file of src) {
      const rel   = path.relative(ROOT, file);
      const lines = fs.readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (/console\.(log|error|warn)\s*\(/.test(line) && KEY_FIELDS.test(line)) {
          hits.push(`${rel}:${i + 1}  →  ${line.trim()}`);
        }
      });
    }
    failWithHits("Possible API key logged to console found", hits);
  });

  // ── storage security ────────────────────────────────────────────────────────

  test("API keys stored in storage.local, not storage.sync", () => {
    // storage.sync replicates data to Mozilla/Google cloud servers.
    // API keys must stay local-only.
    const keyFields = /(?:openaiKey|claudeKey|geminiKey)/;
    const hits = [];
    for (const file of src) {
      const rel   = path.relative(ROOT, file);
      const lines = fs.readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (/storage\.sync/.test(line) && keyFields.test(line)) {
          hits.push(`${rel}:${i + 1}  →  ${line.trim()}`);
        }
      });
    }
    failWithHits("API key written to storage.sync found", hits);
  });

  test("storage.sync is not used at all (prefer storage.local)", () => {
    // Even non-key data sent to sync leaks usage patterns to cloud; keep everything local
    failWithHits(
      "storage.sync usage found",
      scanLines(src, /storage\.sync\b/g)
    );
  });

  // ── DOM security ────────────────────────────────────────────────────────────

  test("innerHTML is not assigned a bare variable (XSS risk)", () => {
    // Direct `el.innerHTML = someVar` injects unescaped content into the DOM.
    // Template literals that call esc() are fine; raw variable assignment is not.
    // Pattern catches: `.innerHTML = variable` but not `.innerHTML = \`...\`` or `= ""`
    failWithHits(
      "Bare-variable innerHTML assignment found",
      scanLines(src, /\.innerHTML\s*=\s*[a-zA-Z_$][a-zA-Z0-9_$.[\]'"]*\s*[;,)]/g)
    );
  });

  test("outerHTML is not assigned user-controlled content", () => {
    failWithHits(
      "outerHTML assignment found",
      scanLines(src, /\.outerHTML\s*=/g)
    );
  });

  test("insertAdjacentHTML is not used with user content", () => {
    // insertAdjacentHTML bypasses textContent safety; flag any usage for review
    failWithHits(
      "insertAdjacentHTML usage found",
      scanLines(src, /\.insertAdjacentHTML\s*\(/g)
    );
  });

  // ── manifest security ───────────────────────────────────────────────────────

  describe("manifest.json", () => {
    let manifest;

    beforeAll(() => {
      manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
    });

    test("manifest_version is 2 or higher", () => {
      expect(manifest.manifest_version).toBeGreaterThanOrEqual(2);
    });

    test("permissions do not include broad <all_urls>", () => {
      const perms = manifest.permissions || [];
      expect(perms).not.toContain("<all_urls>");
    });

    test("permissions do not include the broad 'tabs' permission", () => {
      // 'tabs' exposes every open tab's URL and title; activeTab is the least-privilege alternative
      const perms = manifest.permissions || [];
      expect(perms).not.toContain("tabs");
    });

    test("all host permissions use HTTPS, not HTTP (loopback exceptions allowed)", () => {
      // MV3 splits host permissions into their own key; check both.
      // http://127.0.0.1:47391/* is the loopback sync server — intentional exception.
      // http://localhost:11434/* and http://127.0.0.1:11434/* are the Ollama local AI endpoint — intentional exception.
      const perms      = manifest.permissions      || [];
      const hostPerms  = manifest.host_permissions || [];
      const httpHosts  = [...perms, ...hostPerms].filter(
        p => p.startsWith("http://") &&
             !p.startsWith("http://127.0.0.1") &&
             !p.startsWith("http://localhost:")
      );
      expect(httpHosts).toHaveLength(0);
    });

    test("content_scripts match patterns do not include file:// scheme without justification", () => {
      // file:// access lets the extension read local files; only allow if explicitly needed
      const scripts = manifest.content_scripts || [];
      const fileMatches = scripts.flatMap(s => s.matches || []).filter(m => m.startsWith("file://"));
      expect(fileMatches).toHaveLength(0);
    });

    test("no unsafe-eval in content_security_policy", () => {
      const raw = manifest.content_security_policy || "";
      // MV3 allows an object with { extension_pages: "..." }
      const csp = typeof raw === "object" ? Object.values(raw).join(" ") : String(raw);
      expect(csp).not.toContain("unsafe-eval");
    });

    test("no unsafe-inline scripts in content_security_policy", () => {
      // unsafe-inline in script-src negates XSS protection entirely
      const raw = manifest.content_security_policy || "";
      const csp = typeof raw === "object" ? Object.values(raw).join(" ") : String(raw);
      const scriptSrc = (csp.match(/script-src([^;]*)/) || [])[1] || "";
      expect(scriptSrc).not.toContain("unsafe-inline");
    });
  });
});
