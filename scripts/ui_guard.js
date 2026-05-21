#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const VERSION = "0.1.0";
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_SCAN_FILES = 2500;
const CORE_COMPONENT_ORDER = [
  "button",
  "input",
  "card",
  "dialog",
  "modal",
  "select",
  "checkbox",
  "switch",
  "badge",
  "tabs",
  "table",
  "form",
  "dropdown",
  "menu",
  "toast",
  "alert",
];

const BASELINE_TOKENS = {
  colors: {
    background: { value: "oklch(1 0 0)", source: "generated-baseline" },
    foreground: { value: "oklch(0.145 0 0)", source: "generated-baseline" },
    card: { value: "oklch(1 0 0)", source: "generated-baseline" },
    "card-foreground": { value: "oklch(0.145 0 0)", source: "generated-baseline" },
    primary: { value: "oklch(0.205 0 0)", source: "generated-baseline" },
    "primary-foreground": { value: "oklch(0.985 0 0)", source: "generated-baseline" },
    secondary: { value: "oklch(0.97 0 0)", source: "generated-baseline" },
    "secondary-foreground": { value: "oklch(0.205 0 0)", source: "generated-baseline" },
    muted: { value: "oklch(0.97 0 0)", source: "generated-baseline" },
    "muted-foreground": { value: "oklch(0.556 0 0)", source: "generated-baseline" },
    accent: { value: "oklch(0.97 0 0)", source: "generated-baseline" },
    "accent-foreground": { value: "oklch(0.205 0 0)", source: "generated-baseline" },
    destructive: { value: "oklch(0.577 0.245 27.325)", source: "generated-baseline" },
    border: { value: "oklch(0.922 0 0)", source: "generated-baseline" },
    input: { value: "oklch(0.922 0 0)", source: "generated-baseline" },
    ring: { value: "oklch(0.708 0 0)", source: "generated-baseline" },
  },
  typography: {
    sans: { value: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", source: "generated-baseline" },
    xs: { value: "0.75rem", source: "generated-baseline" },
    sm: { value: "0.875rem", source: "generated-baseline" },
    base: { value: "1rem", source: "generated-baseline" },
    lg: { value: "1.125rem", source: "generated-baseline" },
    xl: { value: "1.25rem", source: "generated-baseline" },
    "2xl": { value: "1.5rem", source: "generated-baseline" },
  },
  spacing: {
    1: { value: "0.25rem", source: "generated-baseline" },
    2: { value: "0.5rem", source: "generated-baseline" },
    3: { value: "0.75rem", source: "generated-baseline" },
    4: { value: "1rem", source: "generated-baseline" },
    6: { value: "1.5rem", source: "generated-baseline" },
    8: { value: "2rem", source: "generated-baseline" },
    12: { value: "3rem", source: "generated-baseline" },
  },
  radius: {
    sm: { value: "calc(var(--radius) - 4px)", source: "generated-baseline" },
    md: { value: "calc(var(--radius) - 2px)", source: "generated-baseline" },
    lg: { value: "var(--radius)", source: "generated-baseline" },
    xl: { value: "calc(var(--radius) + 4px)", source: "generated-baseline" },
    base: { value: "0.5rem", source: "generated-baseline" },
  },
  shadows: {
    sm: { value: "0 1px 2px rgb(0 0 0 / 0.06)", source: "generated-baseline" },
    md: { value: "0 8px 24px rgb(0 0 0 / 0.08)", source: "generated-baseline" },
  },
};

function main() {
  const targetRoot = path.resolve(process.argv[2] || process.cwd());
  if (!fs.existsSync(targetRoot) || !fs.statSync(targetRoot).isDirectory()) {
    fail(`Target path is not a directory: ${targetRoot}`);
  }

  const startedAt = new Date().toISOString();
  const files = walkProject(targetRoot);
  const detection = detectProject(targetRoot, files);
  const tokens = detectTokens(targetRoot, files, detection);
  const components = detectComponents(targetRoot, files);
  const views = detectViews(targetRoot, files);
  const violations = detectViolations(targetRoot, files);
  const baseline = !detection.hasTailwind && !detection.hasShadcn && !tokens.hasDetectedTokens;

  const data = {
    meta: {
      version: VERSION,
      generatedAt: startedAt,
      targetRoot,
      readOnly: true,
      baseline,
    },
    detection,
    tokens: baseline ? clone(BASELINE_TOKENS) : tokens.groups,
    components,
    views: views.length ? views : generatedViews(),
    violations,
    rules: buildRules(detection, baseline, tokens.groups, components),
  };

  const outDir = path.join(targetRoot, ".ui-guard");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "ui-guard-data.json"), `${JSON.stringify(data, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, "ai-rules.md"), renderAiRules(data));
  fs.writeFileSync(path.join(outDir, "report.md"), renderReport(data));
  fs.writeFileSync(path.join(outDir, "index.html"), renderHtml(data));

  console.log(`UI Guard generated read-only sandbox: ${path.join(outDir, "index.html")}`);
  console.log(`Report: ${path.join(outDir, "report.md")}`);
  console.log(`AI rules: ${path.join(outDir, "ai-rules.md")}`);
  console.log(`Guardrail findings: ${violations.length}`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function walkProject(root) {
  const ignoredDirs = new Set([
    ".git",
    ".ui-guard",
    "node_modules",
    ".next",
    ".nuxt",
    ".svelte-kit",
    "dist",
    "build",
    "coverage",
    ".turbo",
    ".vercel",
  ]);
  const files = [];
  const stack = [root];

  while (stack.length && files.length < MAX_SCAN_FILES) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirs.has(entry.name)) stack.push(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const rel = path.relative(root, fullPath);
      if (isRelevantFile(rel)) files.push(rel);
    }
  }
  return files.sort();
}

function isRelevantFile(file) {
  const ext = path.extname(file).toLowerCase();
  const base = path.basename(file);
  return (
    [".js", ".jsx", ".ts", ".tsx", ".css", ".scss", ".html", ".json", ".mjs", ".cjs"].includes(ext) ||
    /^tailwind\.config\./.test(base) ||
    base === "components.json"
  );
}

function readText(root, file) {
  const fullPath = path.join(root, file);
  try {
    const stat = fs.statSync(fullPath);
    if (stat.size > MAX_FILE_BYTES) return "";
    return fs.readFileSync(fullPath, "utf8");
  } catch {
    return "";
  }
}

function detectProject(root, files) {
  const tailwindFiles = files.filter((file) => /^tailwind\.config\.(js|ts|cjs|mjs)$/.test(path.basename(file)));
  const cssFiles = files.filter((file) => /\.(css|scss)$/.test(file));
  const componentsJson = files.find((file) => path.basename(file) === "components.json");
  const shadcnUiFiles = files.filter((file) => /(^|\/)components\/ui\/.+\.(tsx|jsx|ts|js)$/.test(file));
  const packageJson = files.includes("package.json") ? safeJson(readText(root, "package.json")) : null;
  const deps = Object.assign({}, packageJson && packageJson.dependencies, packageJson && packageJson.devDependencies);
  const hasShadcn = Boolean(componentsJson || shadcnUiFiles.length || deps["@radix-ui/react-slot"] || deps["class-variance-authority"]);

  return {
    hasTailwind: tailwindFiles.length > 0 || Boolean(deps.tailwindcss),
    hasShadcn,
    hasCssVariables: cssFiles.some((file) => /--[a-zA-Z0-9-]+\s*:/.test(readText(root, file))),
    packageManager: detectPackageManager(files),
    framework: detectFramework(deps, files),
    files: {
      tailwind: tailwindFiles,
      css: cssFiles.slice(0, 30),
      componentsJson: componentsJson || null,
      shadcnUi: shadcnUiFiles.slice(0, 50),
    },
  };
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function detectPackageManager(files) {
  if (files.includes("pnpm-lock.yaml")) return "pnpm";
  if (files.includes("yarn.lock")) return "yarn";
  if (files.includes("bun.lockb") || files.includes("bun.lock")) return "bun";
  if (files.includes("package-lock.json")) return "npm";
  return "unknown";
}

function detectFramework(deps, files) {
  if (deps.next || files.some((file) => file.startsWith("app/") || file.startsWith("pages/"))) return "next";
  if (deps.vite) return "vite";
  if (deps["@remix-run/react"]) return "remix";
  if (deps.astro) return "astro";
  if (deps.react) return "react";
  return "unknown";
}

function detectTokens(root, files, detection) {
  const groups = emptyTokenGroups();
  for (const file of files) {
    if (/\.(css|scss)$/.test(file)) {
      extractCssVariables(root, file, groups);
      extractTailwindThemeAtRules(root, file, groups);
    }
    if (/^tailwind\.config\.(js|ts|cjs|mjs)$/.test(path.basename(file))) {
      extractTailwindConfigTokens(root, file, groups);
    }
  }

  if (detection.hasShadcn && !groups.radius.base) {
    groups.radius.base = { value: "var(--radius)", source: "shadcn-convention" };
  }

  return {
    groups,
    hasDetectedTokens: countTokens(groups) > 0,
  };
}

function emptyTokenGroups() {
  return { colors: {}, typography: {}, spacing: {}, radius: {}, shadows: {}, other: {} };
}

function extractCssVariables(root, file, groups) {
  const text = readText(root, file);
  const regex = /--([a-zA-Z0-9-_]+)\s*:\s*([^;{}]+);/g;
  let match;
  while ((match = regex.exec(text))) {
    const name = match[1].trim();
    const value = match[2].trim();
    const category = categorizeToken(name, value);
    if (!groups[category][name]) {
      groups[category][name] = { value, source: file };
    }
  }
}

function extractTailwindThemeAtRules(root, file, groups) {
  const text = readText(root, file);
  const regex = /--(color|spacing|radius|shadow|font)-([a-zA-Z0-9-_]+)\s*:\s*([^;{}]+);/g;
  let match;
  while ((match = regex.exec(text))) {
    const family = match[1];
    const name = match[2];
    const value = match[3].trim();
    const category = family === "color" ? "colors" : family === "font" ? "typography" : family === "shadow" ? "shadows" : family;
    if (groups[category] && !groups[category][name]) {
      groups[category][name] = { value, source: file };
    }
  }
}

function extractTailwindConfigTokens(root, file, groups) {
  const text = readText(root, file);
  const tokenLine = /([a-zA-Z0-9-_]+)\s*:\s*["'`]([^"'`]+)["'`]/g;
  let match;
  while ((match = tokenLine.exec(text))) {
    const name = match[1];
    const value = match[2].trim();
    const category = categorizeConfigToken(name, value);
    if (category && !groups[category][name]) {
      groups[category][name] = { value, source: file };
    }
  }
}

function categorizeToken(name, value) {
  const lower = name.toLowerCase();
  if (/(color|background|foreground|primary|secondary|accent|muted|destructive|border|input|ring|card|popover|sidebar|chart)/.test(lower) || isColorValue(value)) return "colors";
  if (/(font|text|leading|tracking|type)/.test(lower)) return "typography";
  if (/(space|spacing|gap|size|width|height|padding|margin)/.test(lower)) return "spacing";
  if (/(radius|rounded|corner)/.test(lower)) return "radius";
  if (/(shadow|elevation)/.test(lower)) return "shadows";
  return "other";
}

function categorizeConfigToken(name, value) {
  if (isColorValue(value) || /var\(--(color-|primary|secondary|accent|background|foreground|border|ring|card)/.test(value)) return "colors";
  if (/rem|px|em|clamp/.test(value) && /(font|text|xs|sm|base|lg|xl)/.test(name)) return "typography";
  if (/rem|px|em|%|vh|vw/.test(value) && /(space|spacing|gap|size|width|height|padding|margin|^\d)/.test(name)) return "spacing";
  if (/radius|rounded|calc\(var\(--radius|rem|px/.test(value) && /(radius|rounded|sm|md|lg|xl|full)/.test(name)) return "radius";
  if (/shadow|rgb|rgba|0\s+\d+px/.test(value)) return "shadows";
  return null;
}

function isColorValue(value) {
  return /^(#|rgb|rgba|hsl|hsla|oklch|oklab|color-mix)/.test(value.trim()) || /var\(--.*(color|primary|secondary|background|foreground|border|ring|card|accent|muted)/.test(value);
}

function countTokens(groups) {
  return Object.values(groups).reduce((sum, group) => sum + Object.keys(group).length, 0);
}

function detectComponents(root, files) {
  const componentFiles = files.filter((file) => {
    if (!/\.(tsx|jsx|ts|js)$/.test(file)) return false;
    return /(^|\/)(components|ui|app\/components|src\/components)\//.test(file);
  });

  const inventory = componentFiles.map((file) => {
    const text = readText(root, file);
    const name = inferComponentName(file, text);
    const kind = classifyComponent(file, text, name);
    return {
      name,
      kind,
      file,
      classNames: extractClassNames(text).slice(0, 16),
      variants: extractVariants(text).slice(0, 16),
      shadcnLike: /components\/ui\//.test(file) || /cva\(|Slot|@radix-ui|class-variance-authority/.test(text),
    };
  });

  const featured = inventory
    .slice()
    .sort((a, b) => componentScore(a) - componentScore(b))
    .slice(0, 12);

  return {
    featured,
    inventory,
    counts: {
      total: inventory.length,
      featured: featured.length,
      shadcnLike: inventory.filter((component) => component.shadcnLike).length,
    },
  };
}

function inferComponentName(file, text) {
  const exportMatch = text.match(/export\s+(?:function|const)\s+([A-Z][A-Za-z0-9_]*)/);
  if (exportMatch) return exportMatch[1];
  return toPascal(path.basename(file).replace(/\.(tsx|jsx|ts|js)$/, ""));
}

function toPascal(value) {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function classifyComponent(file, text, name) {
  const haystack = `${file} ${text.slice(0, 3000)} ${name}`.toLowerCase();
  for (const kind of CORE_COMPONENT_ORDER) {
    if (haystack.includes(kind)) return kind === "modal" ? "dialog" : kind;
  }
  return "component";
}

function componentScore(component) {
  const index = CORE_COMPONENT_ORDER.indexOf(component.kind);
  const coreScore = index === -1 ? 100 : index;
  const shadcnBonus = component.shadcnLike ? -5 : 0;
  return coreScore + shadcnBonus;
}

function extractClassNames(text) {
  const classes = new Set();
  const patterns = [
    /className\s*=\s*["'`]([^"'`]+)["'`]/g,
    /class\s*=\s*["'`]([^"'`]+)["'`]/g,
    /cva\(\s*["'`]([^"'`]+)["'`]/g,
    /cn\(\s*["'`]([^"'`]+)["'`]/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text))) {
      const value = match[1].replace(/\s+/g, " ").trim();
      if (value) classes.add(value);
    }
  }
  return Array.from(classes);
}

function extractVariants(text) {
  const variants = new Set();
  const regex = /(variant|size|intent|tone)\s*:\s*\{([\s\S]{0,1200}?)\}/g;
  let match;
  while ((match = regex.exec(text))) {
    const body = match[2];
    const keyRegex = /([a-zA-Z0-9-_]+)\s*:\s*["'`]([^"'`]+)["'`]/g;
    let keyMatch;
    while ((keyMatch = keyRegex.exec(body))) {
      variants.add(`${match[1]}.${keyMatch[1]}: ${keyMatch[2]}`);
    }
  }
  return Array.from(variants);
}

function detectViews(root, files) {
  const candidates = files
    .filter((file) => /\.(tsx|jsx|ts|js|html)$/.test(file))
    .filter((file) => isViewFile(file))
    .map((file) => {
      const text = readText(root, file);
      return {
        name: inferViewName(file),
        file,
        source: "detected-page",
        classNames: extractClassNames(text).slice(0, 20),
        textSnippets: extractTextSnippets(text).slice(0, 8),
        score: viewScore(file),
      };
    })
    .sort((a, b) => a.score - b.score)
    .slice(0, 3);
  return candidates;
}

function isViewFile(file) {
  const normalized = file.replace(/\\/g, "/");
  if (/^(app|src\/app)\/.*(page|layout)\.(tsx|jsx|ts|js)$/.test(normalized)) return true;
  if (/^(pages|src\/pages)\/.*\.(tsx|jsx|ts|js)$/.test(normalized)) return true;
  if (/^(src\/routes|routes)\/.*\.(tsx|jsx|ts|js)$/.test(normalized)) return true;
  if (/^(src\/)?App\.(tsx|jsx|ts|js)$/.test(normalized)) return true;
  if (/index\.html$/.test(normalized)) return true;
  return false;
}

function inferViewName(file) {
  const normalized = file.replace(/\\/g, "/");
  if (/\/?page\./.test(normalized) && /(\/|^)app\/page\./.test(normalized)) return "Home";
  if (/index\./.test(normalized)) return "Home";
  if (/App\./.test(normalized)) return "App";
  const parts = normalized.split("/");
  const meaningful = parts.filter((part) => !["app", "src", "pages", "routes", "page.tsx", "page.jsx", "index.tsx", "index.jsx"].includes(part));
  return toPascal((meaningful[meaningful.length - 2] || meaningful[meaningful.length - 1] || "Page").replace(/\..+$/, ""));
}

function viewScore(file) {
  const lower = file.toLowerCase();
  if (/app\/page|pages\/index|src\/app\/page|src\/app\./.test(lower)) return 0;
  if (/login|signin|signup|auth|settings/.test(lower)) return 1;
  if (/dashboard|admin|table|project|overview/.test(lower)) return 2;
  return 10;
}

function extractTextSnippets(text) {
  const snippets = new Set();
  const regex = />\s*([^<>{}\n][^<>{}]{2,80})\s*</g;
  let match;
  while ((match = regex.exec(text))) {
    const value = match[1].replace(/\s+/g, " ").trim();
    if (value && !/^[);,\]}]+$/.test(value)) snippets.add(value);
  }
  return Array.from(snippets);
}

function generatedViews() {
  return [
    { name: "Login", source: "generated-example", file: null, classNames: [], textSnippets: ["Welcome back", "Email", "Password", "Sign in"] },
    { name: "Dashboard", source: "generated-example", file: null, classNames: [], textSnippets: ["Revenue", "Active users", "Conversion", "Recent activity"] },
    { name: "Settings", source: "generated-example", file: null, classNames: [], textSnippets: ["Profile", "Notifications", "Workspace", "Save changes"] },
  ];
}

function detectViolations(root, files) {
  const targetFiles = files.filter((file) => /\.(tsx|jsx|ts|js|html|css|scss)$/.test(file));
  const findings = [];
  for (const file of targetFiles) {
    const text = readText(root, file);
    if (!text) continue;
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      const lineNumber = index + 1;
      if (/\bstyle\s*=\s*(\{\{|["'])/.test(line)) {
        findings.push(finding(file, lineNumber, "inline-style", "Avoid inline styles; use detected tokens and component classes.", line));
      }
      if (/(?:className|class)\s*=\s*[{`"'][^`"'}]*\[[^\]]+\]/.test(line) || /\b[a-z-]+-\[[^\]]+\]/.test(line)) {
        findings.push(finding(file, lineNumber, "tailwind-arbitrary-value", "Avoid arbitrary Tailwind values unless explicitly approved.", line));
      }
      if (/(?:className|class)\s*=\s*[{`"'][^`"'}]*(?:text|bg|border|ring|from|to|via)-\[#(?:[0-9a-fA-F]{3,8})\]/.test(line)) {
        findings.push(finding(file, lineNumber, "hardcoded-tailwind-color", "Use semantic color tokens such as primary, foreground, border, or muted.", line));
      }
      if (/\b(?:#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\(|oklch\()/.test(line) && !/--[a-zA-Z0-9-_]+\s*:/.test(line)) {
        findings.push(finding(file, lineNumber, "raw-color-literal", "Prefer project design tokens over raw color literals.", line));
      }
    });
  }
  return findings.slice(0, 500);
}

function finding(file, line, rule, message, source) {
  return {
    file,
    line,
    rule,
    message,
    source: source.trim().slice(0, 220),
  };
}

function buildRules(detection, baseline, tokens, components) {
  const colorNames = Object.keys(tokens.colors || {}).slice(0, 24);
  const radiusNames = Object.keys(tokens.radius || {}).slice(0, 12);
  const componentNames = components.featured.map((component) => `${component.name} (${component.file})`);
  return {
    summary: baseline
      ? "No project design system was detected. Use the generated neutral shadcn-style baseline as a suggestion only."
      : "Use the detected project tokens and components. Do not introduce hardcoded visual values.",
    must: [
      "Prefer existing components before creating new primitives.",
      "Use semantic Tailwind classes and CSS variables from the detected design system.",
      "Keep spacing on the detected scale or the 8pt baseline when no scale exists.",
      "Use project radius and shadow tokens for surfaces.",
    ],
    avoid: [
      "Do not use inline style attributes for visual styling.",
      "Do not use Tailwind arbitrary values such as mt-[15px] or text-[#333] unless the user explicitly approves.",
      "Do not introduce raw hex, rgb, hsl, or oklch literals in component code.",
      "Do not write files as part of ui-guard unless the user explicitly asks for a write action.",
    ],
    tokenHints: {
      colors: colorNames,
      radius: radiusNames,
    },
    componentHints: componentNames,
    detectedStack: {
      tailwind: detection.hasTailwind,
      shadcn: detection.hasShadcn,
      cssVariables: detection.hasCssVariables,
      framework: detection.framework,
    },
  };
}

function renderAiRules(data) {
  const rules = data.rules;
  return `# UI Guard AI Rules

Generated: ${data.meta.generatedAt}
Target: ${data.meta.targetRoot}
Mode: read-only

## Summary

${rules.summary}

## Detected Stack

- Tailwind: ${yesNo(rules.detectedStack.tailwind)}
- shadcn/ui: ${yesNo(rules.detectedStack.shadcn)}
- CSS variables: ${yesNo(rules.detectedStack.cssVariables)}
- Framework: ${rules.detectedStack.framework}

## Must

${rules.must.map((item) => `- ${item}`).join("\n")}

## Avoid

${rules.avoid.map((item) => `- ${item}`).join("\n")}

## Token Hints

- Colors: ${rules.tokenHints.colors.length ? rules.tokenHints.colors.join(", ") : "none detected"}
- Radius: ${rules.tokenHints.radius.length ? rules.tokenHints.radius.join(", ") : "none detected"}

## Component Hints

${rules.componentHints.length ? rules.componentHints.map((item) => `- ${item}`).join("\n") : "- No project components detected; use baseline components as suggestions only."}

## Examples

Recommended:

\`\`\`tsx
<Button className="bg-primary text-primary-foreground rounded-md">Save</Button>
\`\`\`

Avoid:

\`\`\`tsx
<button style={{ color: "#333" }} className="mt-[15px] rounded-[13px]">Save</button>
\`\`\`
`;
}

function renderReport(data) {
  const tokenCount = countTokens(data.tokens);
  const byRule = groupBy(data.violations, "rule");
  return `# UI Guard Report

Generated: ${data.meta.generatedAt}
Target: ${data.meta.targetRoot}
Read-only: yes

## Summary

- Baseline mode: ${yesNo(data.meta.baseline)}
- Framework: ${data.detection.framework}
- Tailwind: ${yesNo(data.detection.hasTailwind)}
- shadcn/ui: ${yesNo(data.detection.hasShadcn)}
- CSS variables: ${yesNo(data.detection.hasCssVariables)}
- Tokens: ${tokenCount}
- Components detected: ${data.components.counts.total}
- Featured components: ${data.components.counts.featured}
- Views: ${data.views.length}
- Guardrail findings: ${data.violations.length}

## Key Files

- Tailwind config: ${data.detection.files.tailwind.length ? data.detection.files.tailwind.join(", ") : "none"}
- components.json: ${data.detection.files.componentsJson || "none"}
- CSS files scanned: ${data.detection.files.css.length}
- shadcn/ui files: ${data.detection.files.shadcnUi.length}

## Guardrails

${Object.keys(byRule).length ? Object.entries(byRule).map(([rule, items]) => `- ${rule}: ${items.length}`).join("\n") : "- No guardrail findings detected."}

## Representative Views

${data.views.map((view) => `- ${view.name}: ${view.source}${view.file ? ` (${view.file})` : ""}`).join("\n")}

## Next Steps

- Open .ui-guard/index.html when you want to inspect the sandbox.
- Use .ui-guard/ai-rules.md as the design-system context for follow-up UI work.
- Ask explicitly before injecting baseline tokens, components, hooks, or config into the project.
`;
}

function yesNo(value) {
  return value ? "yes" : "no";
}

function groupBy(items, key) {
  return items.reduce((acc, item) => {
    const value = item[key] || "unknown";
    if (!acc[value]) acc[value] = [];
    acc[value].push(item);
    return acc;
  }, {});
}

function renderHtml(data) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  const rootVars = cssVarsFromTokens(data.tokens);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>UI Guard Sandbox</title>
  <style>
    :root {
${rootVars}
      --preview-radius: ${resolveRadius(data.tokens)};
      --preview-density: 1;
      --preview-shadow-strength: 1;
    }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      margin: 0;
      color: var(--ui-foreground, #111827);
      background: var(--ui-background, #f8fafc);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 14px;
      line-height: 1.5;
    }
    body.dark {
      --ui-background: #0a0a0a;
      --ui-foreground: #fafafa;
      --ui-card: #111;
      --ui-card-foreground: #fafafa;
      --ui-muted: #1f2937;
      --ui-muted-foreground: #a1a1aa;
      --ui-border: #27272a;
    }
    button, input, select { font: inherit; }
    .app { min-height: 100vh; display: grid; grid-template-columns: 248px 1fr; }
    .sidebar {
      position: sticky;
      top: 0;
      height: 100vh;
      border-right: 1px solid var(--ui-border, #e5e7eb);
      background: color-mix(in oklab, var(--ui-card, #fff) 92%, transparent);
      padding: 20px;
      overflow: auto;
    }
    .brand { display: grid; gap: 4px; margin-bottom: 24px; }
    .brand strong { font-size: 16px; }
    .brand span { color: var(--ui-muted-foreground, #64748b); font-size: 12px; overflow-wrap: anywhere; }
    .nav { display: grid; gap: 6px; }
    .nav a {
      color: inherit;
      text-decoration: none;
      padding: 8px 10px;
      border-radius: 6px;
      border: 1px solid transparent;
    }
    .nav a:hover { background: var(--ui-muted, #f1f5f9); border-color: var(--ui-border, #e5e7eb); }
    .main { padding: 24px; min-width: 0; }
    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 20px;
    }
    h1 { font-size: 24px; line-height: 1.2; margin: 0; letter-spacing: 0; }
    h2 { font-size: 18px; line-height: 1.3; margin: 0 0 12px; letter-spacing: 0; }
    h3 { font-size: 14px; margin: 0 0 8px; letter-spacing: 0; }
    .muted { color: var(--ui-muted-foreground, #64748b); }
    .panel {
      border: 1px solid var(--ui-border, #e5e7eb);
      background: var(--ui-card, #fff);
      color: var(--ui-card-foreground, #111827);
      border-radius: 8px;
      padding: 16px;
      box-shadow: 0 calc(4px * var(--preview-shadow-strength)) calc(18px * var(--preview-shadow-strength)) rgb(15 23 42 / 0.06);
    }
    .section { margin-bottom: 24px; scroll-margin-top: 18px; }
    .grid { display: grid; gap: 12px; }
    .stats { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .stat strong { display: block; font-size: 22px; line-height: 1.1; }
    .stat span { color: var(--ui-muted-foreground, #64748b); font-size: 12px; }
    .controls {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
      justify-content: flex-end;
    }
    .control {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      border: 1px solid var(--ui-border, #e5e7eb);
      border-radius: 7px;
      background: var(--ui-card, #fff);
      padding: 7px 9px;
      min-height: 36px;
    }
    .control label { font-size: 12px; color: var(--ui-muted-foreground, #64748b); }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      min-height: 36px;
      padding: 0 calc(12px * var(--preview-density));
      border-radius: var(--preview-radius);
      border: 1px solid var(--ui-border, #e5e7eb);
      background: var(--ui-card, #fff);
      color: var(--ui-foreground, #111827);
      cursor: pointer;
      white-space: nowrap;
    }
    .btn.primary { background: var(--ui-primary, #111827); color: var(--ui-primary-foreground, #fff); border-color: var(--ui-primary, #111827); }
    .btn.secondary { background: var(--ui-secondary, #f1f5f9); color: var(--ui-secondary-foreground, #111827); }
    .btn:disabled { opacity: 0.52; cursor: not-allowed; }
    .input {
      width: 100%;
      min-height: 38px;
      border: 1px solid var(--ui-input, var(--ui-border, #e5e7eb));
      border-radius: var(--preview-radius);
      padding: 0 10px;
      background: var(--ui-background, #fff);
      color: var(--ui-foreground, #111827);
    }
    .tokens { grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); }
    .swatch {
      display: grid;
      grid-template-columns: 42px 1fr;
      gap: 10px;
      align-items: center;
      min-width: 0;
    }
    .swatch-chip { width: 42px; height: 42px; border-radius: 7px; border: 1px solid var(--ui-border, #e5e7eb); background: var(--swatch); }
    .swatch code, .file code { display: block; overflow-wrap: anywhere; font-size: 11px; color: var(--ui-muted-foreground, #64748b); }
    .component-grid { grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
    .component-preview { display: grid; gap: 10px; }
    .component-surface {
      border: 1px dashed var(--ui-border, #e5e7eb);
      border-radius: 8px;
      padding: calc(16px * var(--preview-density));
      background: var(--ui-background, #f8fafc);
      min-height: 120px;
    }
    .tag {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      padding: 0 8px;
      border-radius: 999px;
      background: var(--ui-muted, #f1f5f9);
      color: var(--ui-muted-foreground, #64748b);
      font-size: 12px;
      border: 1px solid var(--ui-border, #e5e7eb);
    }
    .view-tabs { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
    .view-tab[aria-selected="true"] { background: var(--ui-primary, #111827); color: var(--ui-primary-foreground, #fff); border-color: var(--ui-primary, #111827); }
    .view-stage {
      min-height: 360px;
      border: 1px solid var(--ui-border, #e5e7eb);
      border-radius: 8px;
      background: linear-gradient(180deg, var(--ui-background, #f8fafc), var(--ui-muted, #f1f5f9));
      padding: 18px;
      overflow: hidden;
    }
    .view-shell {
      background: var(--ui-card, #fff);
      color: var(--ui-card-foreground, #111827);
      border: 1px solid var(--ui-border, #e5e7eb);
      border-radius: 8px;
      min-height: 320px;
      padding: 18px;
      display: grid;
      gap: 14px;
      align-content: start;
    }
    .metric-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
    .metric { border: 1px solid var(--ui-border, #e5e7eb); border-radius: 8px; padding: 12px; background: var(--ui-background, #fff); }
    .table { width: 100%; border-collapse: collapse; overflow: hidden; border-radius: 8px; }
    .table th, .table td { border-bottom: 1px solid var(--ui-border, #e5e7eb); padding: 10px; text-align: left; }
    .violations { display: grid; gap: 8px; max-height: 520px; overflow: auto; }
    .violation { border: 1px solid var(--ui-border, #e5e7eb); border-radius: 8px; padding: 10px; background: var(--ui-card, #fff); }
    .violation-header { display: flex; justify-content: space-between; gap: 10px; margin-bottom: 5px; }
    pre {
      margin: 0;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      background: var(--ui-muted, #f1f5f9);
      border: 1px solid var(--ui-border, #e5e7eb);
      border-radius: 8px;
      padding: 12px;
      font-size: 12px;
    }
    @media (max-width: 860px) {
      .app { grid-template-columns: 1fr; }
      .sidebar { position: relative; height: auto; border-right: 0; border-bottom: 1px solid var(--ui-border, #e5e7eb); }
      .main { padding: 16px; }
      .topbar { align-items: stretch; flex-direction: column; }
      .controls { justify-content: flex-start; }
      .stats, .metric-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="app">
    <aside class="sidebar">
      <div class="brand">
        <strong>UI Guard</strong>
        <span id="targetRoot"></span>
      </div>
      <nav class="nav" aria-label="Sections">
        <a href="#overview">Overview</a>
        <a href="#tokens">Tokens</a>
        <a href="#components">Components</a>
        <a href="#views">Views</a>
        <a href="#guardrails">Guardrails</a>
        <a href="#rules">AI Rules</a>
      </nav>
    </aside>
    <main class="main">
      <div class="topbar">
        <div>
          <h1>Living UI Sandbox</h1>
          <div class="muted">Read-only snapshot. Runtime controls do not write to project files.</div>
        </div>
        <div class="controls">
          <div class="control"><label for="primaryPicker">Primary</label><input id="primaryPicker" type="color" value="#111827"></div>
          <div class="control"><label for="radiusRange">Radius</label><input id="radiusRange" type="range" min="0" max="24" value="8"></div>
          <div class="control"><label for="densitySelect">Density</label><select id="densitySelect"><option value="0.82">Compact</option><option value="1" selected>Default</option><option value="1.2">Relaxed</option></select></div>
          <div class="control"><label for="shadowRange">Shadow</label><input id="shadowRange" type="range" min="0" max="2" step="0.1" value="1"></div>
          <button id="themeToggle" class="btn" type="button">Toggle theme</button>
          <button id="resetButton" class="btn" type="button">Reset</button>
        </div>
      </div>
      <section id="overview" class="section"></section>
      <section id="tokens" class="section"></section>
      <section id="components" class="section"></section>
      <section id="views" class="section"></section>
      <section id="guardrails" class="section"></section>
      <section id="rules" class="section"></section>
    </main>
  </div>
  <script id="uiGuardData" type="application/json">${json}</script>
  <script>
    const data = JSON.parse(document.getElementById("uiGuardData").textContent);
    const root = document.documentElement;
    const originalVars = new Map();
    for (const name of root.style) originalVars.set(name, root.style.getPropertyValue(name));

    function cssVarName(name) {
      return "--ui-" + String(name).replace(/[^a-zA-Z0-9-_]/g, "-");
    }

    function tokenValue(token) {
      if (!token) return "";
      return typeof token === "string" ? token : token.value;
    }

    function colorCss(value) {
      if (!value) return "transparent";
      if (/^\\d+(\\.\\d+)?\\s+\\d/.test(value)) return "hsl(" + value + ")";
      return value;
    }

    function setPrimary(value) {
      root.style.setProperty("--ui-primary", value);
    }

    function resetVars() {
      root.removeAttribute("style");
      document.getElementById("primaryPicker").value = "#111827";
      document.getElementById("radiusRange").value = 8;
      document.getElementById("densitySelect").value = 1;
      document.getElementById("shadowRange").value = 1;
      root.style.setProperty("--preview-radius", "${escapeJs(resolveRadius(data.tokens))}");
      root.style.setProperty("--preview-density", "1");
      root.style.setProperty("--preview-shadow-strength", "1");
    }

    function renderOverview() {
      const tokenCount = Object.values(data.tokens).reduce((sum, group) => sum + Object.keys(group || {}).length, 0);
      const stats = [
        ["Tokens", tokenCount],
        ["Components", data.components.counts.total],
        ["Views", data.views.length],
        ["Findings", data.violations.length],
      ];
      document.getElementById("targetRoot").textContent = data.meta.targetRoot;
      document.getElementById("overview").innerHTML = \`
        <h2>Overview</h2>
        <div class="grid stats">
          \${stats.map(([label, value]) => \`<div class="panel stat"><strong>\${value}</strong><span>\${label}</span></div>\`).join("")}
        </div>
        <div class="panel" style="margin-top:12px">
          <div class="grid" style="grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));">
            <div><span class="tag">Tailwind: \${data.detection.hasTailwind ? "yes" : "no"}</span></div>
            <div><span class="tag">shadcn/ui: \${data.detection.hasShadcn ? "yes" : "no"}</span></div>
            <div><span class="tag">CSS variables: \${data.detection.hasCssVariables ? "yes" : "no"}</span></div>
            <div><span class="tag">Framework: \${escapeHtml(data.detection.framework)}</span></div>
          </div>
        </div>\`;
    }

    function renderTokens() {
      const sections = Object.entries(data.tokens).map(([group, tokens]) => {
        const entries = Object.entries(tokens || {});
        if (!entries.length) return "";
        return \`<div class="panel"><h3>\${escapeHtml(group)}</h3><div class="grid tokens">\${entries.map(([name, token]) => {
          const value = tokenValue(token);
          const swatch = group === "colors" ? \`<div class="swatch-chip" style="--swatch:\${escapeAttr(colorCss(value))}"></div>\` : \`<div class="swatch-chip" style="--swatch:var(--ui-muted,#f1f5f9)"></div>\`;
          return \`<div class="swatch">\${swatch}<div><strong>\${escapeHtml(name)}</strong><code>\${escapeHtml(value)}</code><code>\${escapeHtml(token.source || "")}</code></div></div>\`;
        }).join("")}</div></div>\`;
      }).join("");
      document.getElementById("tokens").innerHTML = \`<h2>Tokens</h2><div class="grid">\${sections || '<div class="panel muted">No tokens detected.</div>'}</div>\`;
    }

    function renderComponents() {
      const items = data.components.featured.length ? data.components.featured : [
        { name: "Button", kind: "button", file: "generated-baseline", classNames: [], variants: [] },
        { name: "Input", kind: "input", file: "generated-baseline", classNames: [], variants: [] },
        { name: "Card", kind: "card", file: "generated-baseline", classNames: [], variants: [] },
        { name: "Dialog", kind: "dialog", file: "generated-baseline", classNames: [], variants: [] },
      ];
      document.getElementById("components").innerHTML = \`
        <h2>Components</h2>
        <div class="grid component-grid">
          \${items.map(renderComponentCard).join("")}
        </div>\`;
    }

    function renderComponentCard(component) {
      return \`<div class="panel component-preview">
        <div><h3>\${escapeHtml(component.name)}</h3><div class="muted file"><code>\${escapeHtml(component.file)}</code></div></div>
        <div class="component-surface">\${componentMarkup(component.kind)}</div>
        <div class="muted">\${component.variants && component.variants.length ? escapeHtml(component.variants.slice(0, 2).join(" | ")) : "Static preview"}</div>
      </div>\`;
    }

    function componentMarkup(kind) {
      if (kind === "input" || kind === "form") return '<input class="input" value="hello@example.com" aria-label="Example input">';
      if (kind === "card") return '<div class="metric"><strong>Plan usage</strong><p class="muted">72% of monthly quota</p><button class="btn secondary">Manage</button></div>';
      if (kind === "dialog" || kind === "modal") return '<div class="panel"><strong>Confirm action</strong><p class="muted">This static dialog uses project surface tokens.</p><button class="btn primary">Continue</button></div>';
      if (kind === "badge" || kind === "alert" || kind === "toast") return '<span class="tag">Active</span>';
      if (kind === "table") return '<table class="table"><tr><th>Name</th><th>Status</th></tr><tr><td>Acme</td><td><span class="tag">Live</span></td></tr></table>';
      if (kind === "tabs") return '<div class="view-tabs"><button class="btn primary">Overview</button><button class="btn">Details</button></div>';
      return '<div style="display:flex; gap:8px; flex-wrap:wrap"><button class="btn primary">Primary</button><button class="btn secondary">Secondary</button><button class="btn" disabled>Disabled</button></div>';
    }

    function renderViews() {
      const tabs = data.views.map((view, index) => \`<button class="btn view-tab" type="button" aria-selected="\${index === 0}" data-view-index="\${index}">\${escapeHtml(view.name)}</button>\`).join("");
      document.getElementById("views").innerHTML = \`
        <h2>Views</h2>
        <div class="panel">
          <div class="view-tabs">\${tabs}</div>
          <div class="view-stage"><div id="viewContent"></div></div>
        </div>\`;
      document.querySelectorAll(".view-tab").forEach((button) => {
        button.addEventListener("click", () => selectView(Number(button.dataset.viewIndex)));
      });
      selectView(0);
    }

    function selectView(index) {
      document.querySelectorAll(".view-tab").forEach((button, buttonIndex) => button.setAttribute("aria-selected", String(buttonIndex === index)));
      const view = data.views[index];
      document.getElementById("viewContent").innerHTML = renderView(view);
    }

    function renderView(view) {
      if (/login/i.test(view.name)) {
        return '<div class="view-shell" style="max-width:420px;margin:auto"><h2>Welcome back</h2><p class="muted">Sign in with your workspace account.</p><input class="input" value="name@example.com"><input class="input" value="••••••••"><button class="btn primary">Sign in</button></div>';
      }
      const snippets = (view.textSnippets || []).slice(0, 5).map((text) => \`<span class="tag">\${escapeHtml(text)}</span>\`).join("");
      return \`<div class="view-shell">
        <div><h2>\${escapeHtml(view.name)}</h2><p class="muted">\${escapeHtml(view.source)}\${view.file ? " · " + escapeHtml(view.file) : ""}</p></div>
        <div class="metric-grid"><div class="metric"><strong>Revenue</strong><p class="muted">$48.2k</p></div><div class="metric"><strong>Users</strong><p class="muted">12,840</p></div><div class="metric"><strong>Conversion</strong><p class="muted">8.4%</p></div></div>
        <div class="panel"><h3>Detected content</h3><div style="display:flex;gap:8px;flex-wrap:wrap">\${snippets || '<span class="tag">No text snippets</span>'}</div></div>
        <table class="table"><tr><th>Item</th><th>Status</th><th>Owner</th></tr><tr><td>Design tokens</td><td><span class="tag">Synced</span></td><td>System</td></tr><tr><td>Components</td><td><span class="tag">Detected</span></td><td>Project</td></tr></table>
      </div>\`;
    }

    function renderGuardrails() {
      const items = data.violations.slice(0, 100);
      document.getElementById("guardrails").innerHTML = \`
        <h2>Guardrails</h2>
        <div class="panel">
          <div class="violations">
            \${items.length ? items.map((item) => \`<div class="violation"><div class="violation-header"><strong>\${escapeHtml(item.rule)}</strong><span class="muted">\${escapeHtml(item.file)}:\${item.line}</span></div><div class="muted">\${escapeHtml(item.message)}</div><pre>\${escapeHtml(item.source)}</pre></div>\`).join("") : '<div class="muted">No guardrail findings detected.</div>'}
          </div>
        </div>\`;
    }

    function renderRules() {
      const rules = data.rules;
      document.getElementById("rules").innerHTML = \`
        <h2>AI Rules</h2>
        <div class="panel">
          <h3>Must</h3>
          <ul>\${rules.must.map((item) => \`<li>\${escapeHtml(item)}</li>\`).join("")}</ul>
          <h3>Avoid</h3>
          <ul>\${rules.avoid.map((item) => \`<li>\${escapeHtml(item)}</li>\`).join("")}</ul>
          <pre>\${escapeHtml(JSON.stringify(rules.tokenHints, null, 2))}</pre>
        </div>\`;
    }

    function escapeHtml(value) {
      return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
    }

    function escapeAttr(value) {
      return escapeHtml(value).replace(/;/g, "");
    }

    document.getElementById("primaryPicker").addEventListener("input", (event) => setPrimary(event.target.value));
    document.getElementById("radiusRange").addEventListener("input", (event) => root.style.setProperty("--preview-radius", event.target.value + "px"));
    document.getElementById("densitySelect").addEventListener("change", (event) => root.style.setProperty("--preview-density", event.target.value));
    document.getElementById("shadowRange").addEventListener("input", (event) => root.style.setProperty("--preview-shadow-strength", event.target.value));
    document.getElementById("themeToggle").addEventListener("click", () => document.body.classList.toggle("dark"));
    document.getElementById("resetButton").addEventListener("click", resetVars);

    renderOverview();
    renderTokens();
    renderComponents();
    renderViews();
    renderGuardrails();
    renderRules();
  </script>
</body>
</html>`;
}

function cssVarsFromTokens(tokens) {
  const lines = [];
  const colorTokens = tokens.colors || {};
  const defaults = {
    background: "#f8fafc",
    foreground: "#111827",
    card: "#ffffff",
    "card-foreground": "#111827",
    primary: "#111827",
    "primary-foreground": "#ffffff",
    secondary: "#f1f5f9",
    "secondary-foreground": "#111827",
    muted: "#f1f5f9",
    "muted-foreground": "#64748b",
    border: "#e5e7eb",
    input: "#e5e7eb",
    ring: "#94a3b8",
  };
  for (const [name, fallback] of Object.entries(defaults)) {
    const token = colorTokens[name];
    const value = token ? colorToCss(token.value) : fallback;
    lines.push(`      --ui-${name}: ${value};`);
  }
  for (const [name, token] of Object.entries(colorTokens)) {
    lines.push(`      --ui-${safeCssName(name)}: ${colorToCss(token.value)};`);
  }
  return Array.from(new Set(lines)).join("\n");
}

function colorToCss(value) {
  const trimmed = String(value || "").trim();
  if (/^\d+(\.\d+)?\s+\d/.test(trimmed)) return `hsl(${trimmed})`;
  return trimmed || "transparent";
}

function safeCssName(value) {
  return String(value).replace(/[^a-zA-Z0-9-_]/g, "-");
}

function resolveRadius(tokens) {
  const radius = tokens.radius || {};
  const token = radius.base || radius.lg || radius.md || radius.radius || null;
  const value = tokenValueServer(token);
  if (!value || /var\(|calc\(/.test(value)) return "8px";
  return value;
}

function tokenValueServer(token) {
  if (!token) return "";
  return typeof token === "string" ? token : token.value;
}

function escapeJs(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

main();
