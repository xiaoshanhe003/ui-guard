---
name: ui-guard
description: Use when a user wants to inspect, preview, document, or enforce a project's UI design system. Generates a read-only living sandbox for Tailwind, CSS variables, and shadcn/ui projects, including detected tokens, core components, representative page views, AI rules, and static guardrail findings.
---

# UI Guard

Create a read-only design-system snapshot for the current project. The skill discovers Tailwind tokens, CSS variables, shadcn/ui conventions, component inventory, representative page views, and hardcoded-style violations, then writes a local sandbox report under `.ui-guard/`.

## Hard Boundaries

- Default to read-only inspection of the target project.
- Never modify source files, `tailwind.config.*`, component files, `.gitignore`, or project rules unless the user explicitly asks for a write action.
- Saving theme changes back to code is out of scope for V1.
- Do not start a local server or open a browser unless the user asks to preview/open the sandbox.
- Treat generated baseline tokens/components as suggestions only when no project design system is detected.

## Quick Start

From the target project root, run:

```bash
node /path/to/ui-guard/scripts/ui_guard.js
```

Or pass an explicit target:

```bash
node /path/to/ui-guard/scripts/ui_guard.js /path/to/project
```

The script creates:

```text
.ui-guard/
  index.html
  ui-guard-data.json
  ai-rules.md
  report.md
```

## Workflow

1. Run `scripts/ui_guard.js` against the current project or the project path requested by the user.
2. Read `.ui-guard/report.md` for the short human summary.
3. Use `.ui-guard/ai-rules.md` as the local design-system rule source for follow-up UI work in the same conversation.
4. If the user asks to preview, open `.ui-guard/index.html` directly or serve `.ui-guard/` with a lightweight local server.
5. If the user asks to inject tokens/components or save edits back to source, confirm the target files and exact write scope before modifying project code.

## What V1 Detects

- Tailwind config files: `tailwind.config.js`, `.ts`, `.cjs`, `.mjs`
- CSS variables in common global CSS files and other project CSS files
- shadcn/ui signals: `components.json`, `components/ui/*`, `lib/utils.*`, common shadcn CSS variables
- Component inventory from `components/`, `src/components/`, `app/components/`, and `components/ui/`
- Up to 12 core preview components, prioritized toward Button, Input, Card, Dialog/Modal, Select, Checkbox/Switch, Badge, Tabs, Table, Form, Dropdown/Menu, Toast/Alert
- Up to 3 representative page views from `app/`, `pages/`, `src/app/`, `src/pages/`, `src/routes/`, and `src/App.*`
- Guardrail findings for inline styles, Tailwind arbitrary values, hardcoded color classes, and raw color literals in JSX/TSX/HTML/CSS

## Sandbox Behavior

The generated HTML is a single-page living sandbox with:

- Overview, Tokens, Components, Views, Guardrails, and AI Rules sections
- Light/dark toggle
- Runtime-only color controls inspired by shadcn theme editors
- Runtime-only radius, density, and shadow controls
- Reset to detected/baseline tokens

Runtime controls only affect the open browser page. They do not persist and do not write back to the project.

## Baseline Mode

If no Tailwind, shadcn, or CSS variables are detected, generate a neutral shadcn-style SaaS baseline for preview only:

- System font stack
- 8pt spacing scale
- `0.5rem` default radius
- restrained neutral palette
- lightweight shadows
- static Button, Input, Card, and Dialog-style previews

Mark baseline tokens as generated suggestions in all outputs.
