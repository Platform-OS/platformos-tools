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

**The parser is TOLERANT, so a failed rule is not a rejection.** When a known tag's
strict markup rule does not match, nothing throws — the markup is kept as a raw
**string** and a check (`InvalidTagSyntax`) reports it. Absence of a throw is
therefore not evidence the grammar accepts something; inspect `typeof node.markup`.
Conversely, a grammar that starts accepting a construct stage 2 does not model does
not degrade gracefully: `toExpression` hits `assertNever` and **throws**.

### Changing the grammar

A grammar change is never only a grammar change. Five layers move together, and
skipping the last one loses the author's code:

1. `grammar/liquid-html.ohm` — the ONLY grammar file under version control.
   `grammar/liquid-html.ohm.js` is **gitignored and generated** by `build/shims.js`
   on `prebuild:ts`. Never hand-edit or hand-regenerate it.
2. `stage-1-cst.ts` — new rules need a mapping; positional child indices shift.
3. `stage-2-ast.ts` — widen the narrowest thing that works. Widening a shared helper
   such as `toExpression` cascades into ~20 consumers; a dedicated
   `toFilteredExpression` applied to the operands that actually changed does not.
4. `prettier-plugin-liquid` — **the data-loss trap.** The printer REGENERATES source
   from the AST, so anything the AST does not carry is deleted from the author's file
   on the next format, silently. A construct whose markup is a raw string survives
   formatting today precisely because the printer emits raw strings verbatim; the
   moment it parses, the printer must know how to print it. Prefer reusing a node the
   printer already handles over inventing one.
5. The language server must not regress. Widened types are accepted where narrower
   ones were required, so a widening is safe by construction — verify, do not assume.

Prefer `+` over `*` for an optional-looking suffix in an alternation. `liquidFilter*`
matches the filterless form too, so every operand gets wrapped in a needless node and
dozens of existing fixtures change; `liquidFilter+` falls through to the bare
alternative and costs zero fixture edits. Measure this rather than reasoning about it.

### Test Setup

- Test framework: Vitest with single-fork isolation
- Setup files are in `packages/platformos-check-common/src/test/test-setup.ts` and `packages/platformos-language-server-common/src/test/test-setup.ts`
- Prettier plugin has separate test runs for v2.x and v3.x compatibility

## Cross-Platform Compatibility

### Path Handling

On Windows, filesystem paths use backslashes (`\`), but glob patterns, regex matchers,
minimatch, and URI-based APIs all expect forward slashes (`/`). A path that reaches a
comparison in the wrong spelling matches nothing on Windows and everything on Linux, so
the mistake is invisible until the Windows CI job runs.

**There are exactly three normalizers, all exported by `@platformos/platformos-common`,
and no package rolls its own** — `src/os-path.spec.ts` fails the build if one does
(no `.replace(/\\/g, '/')`, no second `normalize-path`):

| Subject | Use | Result |
|---|---|---|
| A filesystem path | `toPosixPath(fsPath)` | `C:\a\b\` → `C:/a/b` |
| A filesystem path, relative to a directory | `relativePosixPath(fsPath, baseDir)` | `C:\repo\pkg\src\x.ts` in `C:/repo` → `pkg/src/x.ts` |
| A filesystem path that must become a URI | `uriFromPath(fsPath)` | `C:\a\x.liquid` → `file:///c:/a/x.liquid` |

```typescript
import { relativePosixPath, toPosixPath, uriFromPath } from '@platformos/platformos-common';

const paths = (await glob(pattern, { absolute: true })).map(toPosixPath);
const globPattern = toPosixPath(path.join(root, '**/*.liquid'));
const uri = uriFromPath(absoluteFilePath);
```

**Key rule**: any path coming from the filesystem (`glob()`, `path.join()`, `readdir()`,
`__dirname`, `os.tmpdir()`) must be normalized before being passed to:
- Regex pattern matching (e.g. `getFileType()`, `parseAppPath()`)
- minimatch / ignore patterns (e.g. `isIgnored()`)
- Glob pattern strings
- URI comparison or construction — via `uriFromPath`, never `URI.file(p).toString()`,
  which percent-encodes the drive colon (`file:///c%3A/…`) and so compares unequal to
  every URI an `App`, a walk or a config produced
- **A `slice`/`startsWith` against another path, in test code included.** Three of the
  four Windows-only failures this rule was written for were in specs comparing a
  hand-spelled path to a normalized one.

**These are for filesystem paths only, NOT URIs** — `toPosixPath` throws when handed
one, because collapsing `file:///c:/x` to `file:/c:/x` yields a plausible-looking URI
for a different location. A URI is normalized by `normalizeUri` (`platformos-common`),
re-exported as `normalize()` from `platformos-check-common/src/path.ts`; a path of
unknown provenance (a CLI argument, an `ignore` subject) goes through
`uriFromPathOrUri`.

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
- **"We both read YAML" is not agreement — name the DIALECT.** This repo parses
  YAML 1.2 (npm `yaml`); the platform parses YAML 1.1 (Ruby Psych). That one
  unwritten sentence produced three separate defects in three directions — a false
  block, a false positive, and a documented silence whose stated *reason* was
  wrong. The same applies to Liquid: `liquid-html-parser` is a Shopify fork and
  platformOS is not Shopify. Wherever a checker and its target implement the same
  format independently, run the differential rather than reasoning about the spec.
- **A documented silence can be right in behaviour and wrong in justification.**
  Fixing the comment matters as much as fixing the code: the next person reasons
  from the comment, and a confident false premise propagates further than a bug.

### Generated files

`src/filter-arity.ts`, `src/undocumented-filters.ts`, `src/yaml/psych-key-identity.ts`
and the `*-oracle.ts` fixtures are produced by `scripts/verify-*.mjs` against a live
instance (or a live Ruby) and committed. `grammar/liquid-html.ohm.js` is generated
too, but by the build rather than a script — see "Changing the grammar".
When touching them:

- Regenerating an unchanged instance must produce a **byte-identical** file —
  format the output inside the generator, not afterwards.
- A generator that parses another generated file must **fail loudly** when it
  extracts nothing; a silently-empty list drops data no test will miss.
- **A generator that can return a UNIFORM answer needs a shape assertion.** The
  Psych oracle was first built with `#{'#{tok}'}` — interpolation consumed by the
  wrong language — so all 61 tokens resolved to the literal string `#{tok}`. The
  output was plausible, committed, and entirely fictitious. Build the foreign-language
  snippet by concatenation, and assert the result is not degenerate.
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
