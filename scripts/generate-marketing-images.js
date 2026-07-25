// Generates Gumroad marketing images:
//   plans/images/thumbnail-600x600.png
//   plans/images/cover-1280x720.png
// Run from repo root: node scripts/generate-marketing-images.js

const fs   = require("fs");
const path = require("path");

let Resvg;
try {
  ({ Resvg } = require("../desktop/node_modules/@resvg/resvg-js"));
} catch {
  console.error("Could not load @resvg/resvg-js. Run: cd desktop && npm install");
  process.exit(1);
}

const outDir = path.join(__dirname, "..", "plans", "images");
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

function render(svgStr, outPath) {
  const resvg = new Resvg(svgStr, { fitTo: { mode: "original" }, font: { loadSystemFonts: true } });
  fs.writeFileSync(outPath, resvg.render().asPng());
  console.log("Written:", path.relative(process.cwd(), outPath));
}

// ── Thumbnail 600×600 ──────────────────────────────────────────────────────────

const thumbnail = `<svg width="600" height="600" xmlns="http://www.w3.org/2000/svg">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="600" y2="600" gradientUnits="userSpaceOnUse">
    <stop offset="0%" stop-color="#7c3aed"/>
    <stop offset="100%" stop-color="#4f46e5"/>
  </linearGradient>
  <linearGradient id="ac" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0%" stop-color="#7c3aed"/>
    <stop offset="100%" stop-color="#4f46e5"/>
  </linearGradient>
</defs>

<!-- Gradient background -->
<rect width="600" height="600" fill="url(#bg)"/>
<rect width="600" height="600" fill="#0a0a12" opacity="0.35"/>

<!-- Card -->
<rect x="36" y="36" width="528" height="528" rx="24" fill="#181825"/>
<rect x="36" y="36" width="528" height="5" rx="2" fill="url(#ac)"/>

<!-- Logo mark — two overlapping squares -->
<rect x="248" y="96" width="72" height="72" rx="10" fill="none" stroke="#7c3aed" stroke-width="3.5"/>
<rect x="260" y="108" width="72" height="72" rx="10" fill="none" stroke="#4f46e5" stroke-width="3.5" opacity="0.55"/>

<!-- App name -->
<text x="300" y="258"
  font-family="'Segoe UI', system-ui, sans-serif"
  font-size="48" font-weight="700" fill="#ffffff" text-anchor="middle">Thought Tidy</text>

<!-- Divider -->
<rect x="210" y="274" width="180" height="2" rx="1" fill="#313244"/>

<!-- Subtitle -->
<text x="300" y="316"
  font-family="'Segoe UI', system-ui, sans-serif"
  font-size="20" fill="#a6adc8" text-anchor="middle">AI Writing Assistant</text>

<!-- Tagline -->
<text x="300" y="356"
  font-family="'Segoe UI', system-ui, sans-serif"
  font-size="15" fill="#6c7086" text-anchor="middle">Your words. Just clearer.</text>

<!-- Pill: Free -->
<rect x="72" y="406" width="130" height="30" rx="15" fill="#1e1e2e" stroke="#313244" stroke-width="1"/>
<text x="137" y="425"
  font-family="'Segoe UI', system-ui, sans-serif"
  font-size="12" fill="#9399b2" text-anchor="middle">9 Free Actions</text>

<!-- Pill: Pro -->
<rect x="222" y="406" width="156" height="30" rx="15" fill="#7c3aed" opacity="0.9"/>
<text x="300" y="425"
  font-family="'Segoe UI', system-ui, sans-serif"
  font-size="12" font-weight="600" fill="#ffffff" text-anchor="middle">Pro — $10 one time</text>

<!-- Pill: Platforms -->
<rect x="398" y="406" width="130" height="30" rx="15" fill="#1e1e2e" stroke="#313244" stroke-width="1"/>
<text x="463" y="425"
  font-family="'Segoe UI', system-ui, sans-serif"
  font-size="12" fill="#9399b2" text-anchor="middle">Win / Mac / Linux</text>

<!-- Bottom note -->
<text x="300" y="500"
  font-family="'Segoe UI', system-ui, sans-serif"
  font-size="13" fill="#45475a" text-anchor="middle">Open source · Bring your own API key</text>

<!-- Chrome + Firefox badges -->
<rect x="192" y="518" width="80" height="24" rx="12" fill="#1e1e2e" stroke="#313244" stroke-width="1"/>
<text x="232" y="534"
  font-family="'Segoe UI', system-ui, sans-serif"
  font-size="11" fill="#6c7086" text-anchor="middle">Chrome</text>

<rect x="284" y="518" width="80" height="24" rx="12" fill="#1e1e2e" stroke="#313244" stroke-width="1"/>
<text x="324" y="534"
  font-family="'Segoe UI', system-ui, sans-serif"
  font-size="11" fill="#6c7086" text-anchor="middle">Firefox</text>
</svg>`;

// ── Cover 1280×720 ─────────────────────────────────────────────────────────────

const cover = `<svg width="1280" height="720" xmlns="http://www.w3.org/2000/svg">
<defs>
  <linearGradient id="glow" x1="0" y1="0" x2="640" y2="720" gradientUnits="userSpaceOnUse">
    <stop offset="0%" stop-color="#7c3aed" stop-opacity="0.28"/>
    <stop offset="100%" stop-color="#4f46e5" stop-opacity="0"/>
  </linearGradient>
  <linearGradient id="ac" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0%" stop-color="#7c3aed"/>
    <stop offset="100%" stop-color="#4f46e5"/>
  </linearGradient>
  <linearGradient id="popbg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#1e1e2e"/>
    <stop offset="100%" stop-color="#181825"/>
  </linearGradient>
  <clipPath id="popclip">
    <rect x="710" y="48" width="516" height="626" rx="14"/>
  </clipPath>
</defs>

<!-- Background -->
<rect width="1280" height="720" fill="#181825"/>
<rect width="700" height="720" fill="url(#glow)"/>

<!-- Top accent bar -->
<rect width="1280" height="4" fill="url(#ac)"/>

<!-- ── LEFT SIDE ── -->

<!-- Logo mark -->
<rect x="58" y="76" width="46" height="46" rx="8" fill="none" stroke="#7c3aed" stroke-width="3"/>
<rect x="68" y="86" width="46" height="46" rx="8" fill="none" stroke="#4f46e5" stroke-width="3" opacity="0.55"/>

<!-- App name -->
<text x="58" y="205"
  font-family="'Segoe UI', system-ui, sans-serif"
  font-size="64" font-weight="700" fill="#ffffff">Thought Tidy</text>

<!-- Tagline -->
<text x="58" y="250"
  font-family="'Segoe UI', system-ui, sans-serif"
  font-size="23" fill="#a6adc8">Your words. Just clearer.</text>

<!-- Accent divider -->
<rect x="58" y="278" width="180" height="3" rx="2" fill="url(#ac)"/>

<!-- FREE section label -->
<text x="58" y="322"
  font-family="'Segoe UI', system-ui, sans-serif"
  font-size="11" font-weight="700" fill="#7c3aed" letter-spacing="2">FREE</text>

<circle cx="65" cy="348" r="3" fill="#45475a"/>
<text x="80" y="353"
  font-family="'Segoe UI', system-ui, sans-serif"
  font-size="15" fill="#cdd6f4">Fix Spelling, Improve, Shorten, Expand and 5 more actions</text>

<circle cx="65" cy="378" r="3" fill="#45475a"/>
<text x="80" y="383"
  font-family="'Segoe UI', system-ui, sans-serif"
  font-size="15" fill="#cdd6f4">Works from any app on your computer or browser</text>

<circle cx="65" cy="408" r="3" fill="#45475a"/>
<text x="80" y="413"
  font-family="'Segoe UI', system-ui, sans-serif"
  font-size="15" fill="#cdd6f4">OpenAI, Claude, Gemini, GitHub Copilot, local AI</text>

<!-- PRO section label -->
<text x="58" y="458"
  font-family="'Segoe UI', system-ui, sans-serif"
  font-size="11" font-weight="700" fill="#7c3aed" letter-spacing="2">PRO — $10 ONE TIME</text>

<circle cx="65" cy="484" r="3" fill="#7c3aed"/>
<text x="80" y="489"
  font-family="'Segoe UI', system-ui, sans-serif"
  font-size="15" fill="#cdd6f4">Sound Like Me — rewrites in your actual voice</text>

<circle cx="65" cy="514" r="3" fill="#7c3aed"/>
<text x="80" y="519"
  font-family="'Segoe UI', system-ui, sans-serif"
  font-size="15" fill="#cdd6f4">Custom Prompts, Multiple Suggestions, Action Editor</text>

<!-- Platform pills -->
<rect x="58" y="572" width="82" height="26" rx="13" fill="#1e1e2e" stroke="#313244" stroke-width="1"/>
<text x="99" y="589" font-family="'Segoe UI', system-ui, sans-serif" font-size="11" fill="#9399b2" text-anchor="middle">Windows</text>

<rect x="150" y="572" width="68" height="26" rx="13" fill="#1e1e2e" stroke="#313244" stroke-width="1"/>
<text x="184" y="589" font-family="'Segoe UI', system-ui, sans-serif" font-size="11" fill="#9399b2" text-anchor="middle">macOS</text>

<rect x="228" y="572" width="60" height="26" rx="13" fill="#1e1e2e" stroke="#313244" stroke-width="1"/>
<text x="258" y="589" font-family="'Segoe UI', system-ui, sans-serif" font-size="11" fill="#9399b2" text-anchor="middle">Linux</text>

<rect x="298" y="572" width="70" height="26" rx="13" fill="#1e1e2e" stroke="#313244" stroke-width="1"/>
<text x="333" y="589" font-family="'Segoe UI', system-ui, sans-serif" font-size="11" fill="#9399b2" text-anchor="middle">Chrome</text>

<rect x="378" y="572" width="72" height="26" rx="13" fill="#1e1e2e" stroke="#313244" stroke-width="1"/>
<text x="414" y="589" font-family="'Segoe UI', system-ui, sans-serif" font-size="11" fill="#9399b2" text-anchor="middle">Firefox</text>

<!-- ── RIGHT SIDE — Popup mockup ── -->

<!-- Drop shadow -->
<rect x="726" y="66" width="516" height="626" rx="16" fill="#000000" opacity="0.5"/>

<!-- Popup window bg (clipped) -->
<g clip-path="url(#popclip)">
  <rect x="710" y="48" width="516" height="626" fill="url(#popbg)"/>

  <!-- Titlebar -->
  <rect x="710" y="48" width="516" height="52" fill="#11111b"/>
  <rect x="710" y="99" width="516" height="1" fill="#313244"/>

  <!-- Logo in titlebar -->
  <rect x="728" y="63" width="15" height="15" rx="3" fill="none" stroke="#7c3aed" stroke-width="1.5"/>
  <rect x="734" y="69" width="15" height="15" rx="3" fill="none" stroke="#4f46e5" stroke-width="1.5" opacity="0.55"/>
  <text x="756" y="79" font-family="'Segoe UI', system-ui, sans-serif" font-size="13" font-weight="600" fill="#a6adc8">Thought Tidy</text>

  <!-- Close btn -->
  <rect x="1176" y="60" width="32" height="28" rx="6" fill="#1e1e2e"/>
  <text x="1192" y="78" font-family="'Segoe UI', system-ui, sans-serif" font-size="13" fill="#6c7086" text-anchor="middle">x</text>

  <!-- Tip -->
  <text x="726" y="126" font-family="'Segoe UI', system-ui, sans-serif" font-size="10" fill="#6c7086">Ctrl+C text  -&gt;  Ctrl+Shift+Space  -&gt;  Ctrl+V to paste</text>

  <!-- TEXT TO PROCESS label + paste btn -->
  <text x="726" y="158" font-family="'Segoe UI', system-ui, sans-serif" font-size="10" font-weight="700" fill="#6c7086">TEXT TO PROCESS</text>
  <rect x="1118" y="145" width="90" height="22" rx="5" fill="#1e1e2e" stroke="#313244" stroke-width="1"/>
  <text x="1163" y="160" font-family="'Segoe UI', system-ui, sans-serif" font-size="10" fill="#6c7086" text-anchor="middle">Paste clipboard</text>

  <!-- Textarea -->
  <rect x="726" y="168" width="490" height="122" rx="8" fill="#11111b" stroke="#313244" stroke-width="1"/>
  <text x="742" y="190" font-family="'Segoe UI', system-ui, sans-serif" font-size="13" fill="#cdd6f4">hey can u help me write this email to my boss</text>
  <text x="742" y="210" font-family="'Segoe UI', system-ui, sans-serif" font-size="13" fill="#cdd6f4">about taking friday off i need it for a thing</text>
  <text x="742" y="230" font-family="'Segoe UI', system-ui, sans-serif" font-size="13" fill="#cdd6f4">but idk how to say it without sounding dumb lol</text>

  <!-- Action row -->
  <rect x="726" y="304" width="376" height="38" rx="8" fill="#11111b" stroke="#313244" stroke-width="1"/>
  <text x="744" y="327" font-family="'Segoe UI', system-ui, sans-serif" font-size="13" fill="#cdd6f4">Make Professional</text>
  <rect x="1114" y="304" width="102" height="38" rx="8" fill="#89b4fa"/>
  <text x="1165" y="327" font-family="'Segoe UI', system-ui, sans-serif" font-size="13" font-weight="700" fill="#181825" text-anchor="middle">Run</text>

  <!-- Result area -->
  <rect x="726" y="358" width="490" height="182" rx="8" fill="#11111b" stroke="#89b4fa" stroke-width="1"/>
  <text x="742" y="382" font-family="'Segoe UI', system-ui, sans-serif" font-size="13" fill="#cdd6f4">Hi [Name],</text>
  <text x="742" y="404" font-family="'Segoe UI', system-ui, sans-serif" font-size="13" fill="#cdd6f4">I wanted to reach out regarding taking this Friday</text>
  <text x="742" y="424" font-family="'Segoe UI', system-ui, sans-serif" font-size="13" fill="#cdd6f4">off. I have a prior commitment that requires my</text>
  <text x="742" y="444" font-family="'Segoe UI', system-ui, sans-serif" font-size="13" fill="#cdd6f4">attention and I wanted to give you advance notice.</text>
  <text x="742" y="464" font-family="'Segoe UI', system-ui, sans-serif" font-size="13" fill="#cdd6f4">I will ensure all my work is completed before then.</text>
  <text x="742" y="500" font-family="'Segoe UI', system-ui, sans-serif" font-size="13" fill="#6c7086">Thank you for your understanding.</text>

  <!-- Result actions -->
  <rect x="1042" y="552" width="60" height="28" rx="6" fill="#1e1e2e" stroke="#313244" stroke-width="1"/>
  <text x="1072" y="570" font-family="'Segoe UI', system-ui, sans-serif" font-size="11" fill="#cdd6f4" text-anchor="middle">Copy</text>
  <rect x="1112" y="552" width="100" height="28" rx="6" fill="#89b4fa"/>
  <text x="1162" y="570" font-family="'Segoe UI', system-ui, sans-serif" font-size="11" font-weight="600" fill="#181825" text-anchor="middle">Copy &amp; Close</text>

  <!-- Footer -->
  <rect x="710" y="618" width="516" height="56" fill="#11111b"/>
  <rect x="710" y="618" width="516" height="1" fill="#313244"/>
  <text x="726" y="648" font-family="'Segoe UI', system-ui, sans-serif" font-size="11" fill="#6c7086">OpenAI · gpt-4o-mini</text>
  <rect x="1104" y="626" width="100" height="28" rx="6" fill="#1e1e2e" stroke="#313244" stroke-width="1"/>
  <text x="1154" y="644" font-family="'Segoe UI', system-ui, sans-serif" font-size="11" fill="#9399b2" text-anchor="middle">Settings</text>
</g>

<!-- Popup border on top of clip -->
<rect x="710" y="48" width="516" height="626" rx="14" fill="none" stroke="#313244" stroke-width="1"/>
</svg>`;

render(thumbnail, path.join(outDir, "thumbnail-600x600.png"));
render(cover,     path.join(outDir, "cover-1280x720.png"));
