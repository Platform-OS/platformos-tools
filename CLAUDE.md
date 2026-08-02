# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

platformOS Tools is a TypeScript monorepo providing developer tools for platformOS Liquid template development. The tools include syntax highlighting, code formatting (Prettier), linting, and Language Server Protocol (LSP) implementation. Originally forked from Shopify's Theme Tools.

## Common Commands

```bash
# Install dependencies
yarn

# Build all packages
yarn build

# Run all tests
yarn test

# Run tests for a specific package
yarn workspace @platformos/package-name test

# Type-check all packages
yarn type-check

# Format code
yarn format

# Check formatting
yarn format:check

# Start CodeMirror playground (browser-based editor)
yarn playground

# Start VS Code web extension dev server
yarn dev:web

# Run the linter CLI directly
yarn theme-check
```

### VS Code Extension Development

1. Open the repository in VS Code
2. Press F5 to launch the extension development host
3. Set breakpoints and debug as needed

For browser extension debugging, use the "Run Web Extension" launch configuration.

## Architecture

### Package Structure

The monorepo follows a layered architecture with environment-specific implementations:

```
packages/
├── Core
│   ├── liquid-html-parser/          # Two-stage parser: CST → AST (Ohm grammar)
│   ├── platformos-common/           # Shared utilities and types
│   └── platformos-graph/            # Dependency tracking for templates
│
├── Linting (platformos-check-*)
│   ├── platformos-check-common/     # Core linting engine and check definitions
│   ├── platformos-check-node/       # Node.js CLI runtime
│   └── platformos-check-browser/    # Browser-compatible runtime
│
├── Language Server (platformos-language-server-*)
│   ├── platformos-language-server-common/  # LSP implementation (completions, diagnostics, hover, etc.)
│   ├── platformos-language-server-node/    # Node.js runtime
│   └── platformos-language-server-browser/ # Browser runtime
│
├── Editor Integration
│   ├── vscode-extension/            # VS Code extension (webpack bundled)
│   └── codemirror-language-client/  # CodeMirror LSP client
│
└── Code Formatting
    └── prettier-plugin-liquid/      # Prettier plugin (supports v2.x and v3.x)
```

### Key Patterns

- **Multi-environment support**: Common packages contain the core logic, with `-node` and `-browser` variants providing environment-specific runtimes
- **Visitor pattern**: Used for AST traversal in checks and language server features
- **Plugin-based checks**: Linting rules are defined as individual check classes in `platformos-check-common`

### Parser (liquid-html-parser)

The parser uses a two-stage approach:
1. **Stage 1 (CST)**: Concrete Syntax Tree using Ohm.js grammar
2. **Stage 2 (AST)**: Abstract Syntax Tree with semantic information

### Test Setup

- Test framework: Vitest with single-fork isolation
- Setup files are in `packages/platformos-check-common/src/test/test-setup.ts` and `packages/platformos-language-server-common/src/test/test-setup.ts`
- Prettier plugin has separate test runs for v2.x and v3.x compatibility

## Cross-Platform Compatibility

### Path Handling

On Windows, filesystem paths use backslashes (`\`), but glob patterns, regex matchers, minimatch, and URI-based APIs all expect forward slashes (`/`). Always normalize paths before pattern matching or filtering

**Use `normalize-path`** (already a dependency of `platformos-check-node`) for consistent forward-slash conversion:

```typescript
import normalize from 'normalize-path';

// Normalize glob results before filtering
const paths = await glob(pattern, { absolute: true });
const normalized = paths.map(normalize);

// Normalize before constructing glob patterns
const globPattern = normalize(path.join(root, '**/*.liquid'));
```

**Do NOT** use manual `.replace(/\\/g, '/')` — use `normalize-path` instead for readability and consistency with pos-cli.

**Key rule**: Any path coming from the filesystem (`glob()`, `path.join()`, `__dirname`, etc.) must be normalized before being passed to:
- Regex pattern matching (e.g., `isKnownLiquidFile()`, `getFileType()`)
- minimatch / ignore patterns (e.g., `isIgnored()`)
- Glob pattern strings
- URI comparison or construction

**Important: `normalize-path` is for filesystem paths only, NOT URIs.** It collapses multiple slashes (e.g., `file:///` becomes `file:/`), which breaks URI semantics. For URI strings (`file://...`), use the `normalize()` function from `platformos-check-common/src/path.ts` which works with `vscode-uri`. For raw backslash replacement in URIs where you can't use the common normalize, use `.replace(/\\/g, '/')`.

## Test Assertion Guidelines

**Assert whole values, exactly.** 99% of the time we want something to *be*
exactly something, not merely to *contain* or *resemble* it. Prefer one
whole-value equality assertion over several partial ones.

- Assert the **entire object/array** in a single equality, not a field at a
  time and not membership/threshold checks:
  - Vitest: `expect(result).toEqual({ ...allFields })` and
    `expect(offenses).toEqual([ ...allElements ])`.
  - Chai: `.to.deep.equal({...})` / `.to.deep.equal([...])`.
- Do **not** assert with `length` + per-property reads. Replace
  `expect(arr).toHaveLength(1); expect(arr[0].check).toBe('X')` with
  `expect(arr).toEqual([{ check: 'X', /* every field */ }])`.
- Do **not** use membership or threshold assertions when an exact value is
  knowable: avoid `.toContain(x)`, `.some(...)`, `.toBeGreaterThanOrEqual(n)`,
  `typeof x === 'number'`, `.to.include(...)`. Assert the exact element/array
  and the exact number.
- Always use `.to.equal()` / `toEqual()` for message assertions, never
  `.to.include()` / `.toContain()` — assert the entire expected string.
- When several assertions check parts of the same value, collapse them into one
  whole-value equality.
- Do not use regex for matching in tests unless absolutely necessary.
- Narrow exception: when the contract under test is genuinely
  presence-or-absence (e.g. a detector that returns a match object or `null`),
  asserting the boolean/`null` outcome is fine — don't over-pin an internal
  payload consumers don't depend on.

### Silence needs a test, and a control

A check that must **not** report is making a promise exactly as strong as one
that must. Four evaluation rounds found the same failure repeatedly: prose said
"duplicates are not reported", no test asserted it, and the code did the
opposite for a whole release while the suite stayed green. **Prose cannot fail.**

- Every "must stay silent" case is paired with a **control that must still
  fire**. A suppression wide enough to hide a real defect passes every
  "nothing was reported" assertion ever written.
- Make sure the silence is caused by the code under test, not by the fixture.
  A "we ignore unparseable files" test whose fixture contains nothing to report
  passes with the guard deleted — assert that the thing *is* findable by other
  means, so neither half is vacuous.

### Sabotage before you trust a test

Break the code deliberately and confirm the test fails. If nothing fails, the
test is decorative. This has caught three vacuous tests and a rule that no real
input could exercise — when precedence between two tables could not be
distinguished by any real data, the ordering had to be asserted directly.

### Measure; don't infer, and keep claims separate

- Prefer a runtime oracle over reasoning about what a library or platform
  "obviously" does. `1` and `"1"` are one key in a JS object and two in a Ruby
  Hash; guessing either way produces a false report.
- **Two claims must not ride in one sentence.** "The converter accepts a
  duplicate key and resolves it last-wins" was written from a measurement of
  *acceptance* only, and the resolution half went unmeasured in three files
  until someone deployed a probe. If a sentence asserts two things, either
  measure both or attribute each separately.
- When a benchmark surprises you, suspect the benchmark. Include a control that
  **cannot** be affected by what you're measuring — a JSON-typed check timed
  against a Liquid buffer should cost nothing, and if it doesn't, the number is
  the method's error bar.

### Generated files

`src/filter-arity.ts`, `src/undocumented-filters.ts` and the
`*-oracle.ts` fixtures are produced by `scripts/verify-*.mjs` against a live
instance and committed. When touching them:

- Regenerating an unchanged instance must produce a **byte-identical** file —
  format the output inside the generator, not afterwards.
- A generator that parses another generated file must **fail loudly** when it
  extracts nothing; a silently-empty list drops data no test will miss.
- Never hand-edit. `data/filters.json` in particular is re-downloaded by the
  docs-updater's `postbuild`, so edits there are reverted by the next build.
- Test-only fixtures (`*-oracle.ts`) are excluded from `tsconfig.build.json` —
  they must not ship in `dist`.

### Adding a check

- Register it in `src/checks/index.ts`, then **regenerate the factory configs**
  (`node packages/platformos-check-node/scripts/generate-factory-configs.js`) or
  `all.yml` / `recommended.yml` will not list it.
- Blocking is not severity. `blocksWrite` requires severity `error` **and**
  membership of `BLOCKING_CHECKS`, so a new check is non-blocking by default —
  keep it that way unless the platform genuinely rejects the file.
- If the check changes what the MCP server reports, update
  `transport/instructions.ts` in the **same** change; its claims are pinned by
  `validate-code.spec.ts` precisely so they cannot rot.

## Development Workflows

### Online Store Web Integration

For testing with online-store-web:
```bash
yarn admin:init  # Set up package links
yarn admin:build # Rebuild after changes (no hot-reload)
```

### JSON Schema Testing

To test with local theme-liquid-docs changes:
```bash
export SHOPIFY_TLD_ROOT=/path/to/theme-liquid-docs
theme-docs download
code .
```

<!-- BACKLOG.MD MCP GUIDELINES START -->

<CRITICAL_INSTRUCTION>

## BACKLOG WORKFLOW INSTRUCTIONS

This project uses Backlog.md MCP for all task and project management activities.

**CRITICAL GUIDANCE**

- If your client supports MCP resources, read `backlog://workflow/overview` to understand when and how to use Backlog for this project.
- If your client only supports tools or the above request fails, call `backlog.get_backlog_instructions()` to load the tool-oriented overview. Use the `instruction` selector when you need `task-creation`, `task-execution`, or `task-finalization`.

- **First time working here?** Read the overview resource IMMEDIATELY to learn the workflow
- **Already familiar?** You should have the overview cached ("## Backlog.md Overview (MCP)")
- **When to read it**: BEFORE creating tasks, or when you're unsure whether to track work

These guides cover:
- Decision framework for when to create tasks
- Search-first workflow to avoid duplicates
- Links to detailed guides for task creation, execution, and finalization
- MCP tools reference

You MUST read the overview resource to understand the complete workflow. The information is NOT summarized here.

</CRITICAL_INSTRUCTION>

<!-- BACKLOG.MD MCP GUIDELINES END -->
