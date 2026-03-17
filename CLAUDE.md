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

- Always use `.to.equal()` for message assertions, never `.to.include()` — assert the entire expected string
- Do not use regex for matching in tests unless absolutely necessary
- For array assertions (e.g., `applySuggestions` results), use `.to.deep.equal([...])` instead of `.to.include(element)`
- When multiple `.include()` calls check the same value, collapse them into a single `.to.equal()`

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
