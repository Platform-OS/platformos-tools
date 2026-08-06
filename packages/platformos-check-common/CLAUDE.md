# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

`@platformos/platformos-check-common` is the runtime-agnostic core of the platformOS linting engine. It defines all check logic, types, the visitor traversal system, the fix/autofix infrastructure, and test utilities. It has no Node.js or browser dependencies — those are in `-node` / `-browser` sibling packages.

## Commands

```bash
# From this directory:
yarn test               # Run all tests (vitest)
yarn build              # tsc -b tsconfig.build.json
yarn type-check         # tsc --noEmit

# Run a single test file:
yarn test src/checks/deprecated-filter/index.spec.ts

# Run tests matching a name pattern:
yarn test --reporter=verbose -t "DeprecatedFilter"
```

## Architecture

### Core pipeline (`src/index.ts`)

`check(app, config, dependencies, options?)` is the entry point. `app` is an
`App` from `platformos-common` — **only** that; it used to also accept a plain
`SourceCode[]`, and a caller that passed one silently got `dependencies.app ===
undefined`, which cost every cross-file check its O(1) name index. `options.only`
narrows what is VISITED without narrowing what the checks can SEE, and is how the
language server lints just the open buffers against the whole project.

It:
1. Wraps raw `Dependencies` with augmented helpers (file-exists, translations, etc.)
2. Wraps the raw docset in `AugmentedPlatformOSDocset` (memoized, adds undocumented filters/tags)
3. Iterates over `SourceCodeType` values (JSON, LiquidHtml, GraphQL, YAML) and runs each applicable `CheckDefinition` against each file via visitors

### Source code types (`src/types.ts`)

`SourceCodeType` has four values. Their AST types:
- `LiquidHtml` → `LiquidHtmlNode` (from `@platformos/liquid-html-parser`)
- `JSON` → `JSONNode` (jsonc-parser wrapper, `src/jsonc/types.ts`)
- `YAML` → **also `JSONNode`** — YAML is parsed into the same JSONNode AST via `src/yaml/parse.ts`
- `GraphQL` → `GraphQLDocumentNode` (`{ type, content, document?, syntaxError? }`, from
  `platformos-common` — re-exported here, never redeclared). The parse is the file's:
  `sourceParsers` injects `parseGraphql` into the `App`, so a `.graphql` document is
  parsed once until its source changes and `GraphQLCheck`, `GraphQLVariablesCheck`,
  `UnknownProperty` and the graph all read that one document. A check that wants tables
  or variables calls `extractGraphqlTables` / `extractGraphqlVariables` on it rather
  than parsing; an inline `{% graphql %}…{% endgraphql %}` body, which has no file,
  calls `parseGraphql` itself. `graphql-parse-once.spec.ts` fails if any of them grows
  a parse of its own.

### Check definition pattern

Every check exports a `CheckDefinition<SourceCodeType.X>` object:

```ts
export const MyCheck: LiquidCheckDefinition = {
  meta: {
    code: 'MyCheck',          // used in config and offenses
    name: '...',
    docs: { description: '...', recommended: true },
    type: SourceCodeType.LiquidHtml,
    severity: Severity.WARNING,
    schema: {},               // configurable settings shape
    targets: [],              // ConfigTarget[] or empty = all configs
  },
  create(context) {
    // Called once per file. Return visitor methods as a plain object.
    return {
      async LiquidTag(node, ancestors) { ... },
      async onCodePathEnd(file) { ... },
    };
  },
};
```

- `context` has: `report()`, `file`, `config`, `settings`, `toUri()`, `toRelativePath()`, `fileType()`, `app`, `fs`, `platformosDocset`, `getDocDefinition`, `fileExists`, `fileSize`, `getDefaultLocale`, `getDefaultTranslations`, `getTranslationsForBase`, `getRouteTable`, `validateJSON`
- `context.app` is the run's `App` and is never `undefined`. Hand it to
  `new DocumentsLocator(context.fs, context.app)` so a `render`/`graphql` name resolves
  through the index instead of a `stat` per candidate path. `context.fileType(uri?)`
  reads the type the file classified once; never call `getFileType` with a bare URI,
  which cannot be anchored at the run's root
- `context.report({ message, startIndex, endIndex, fix?, suggest? })` records an offense
- `fix` is safe auto-fix; `suggest` is manual (multiple options or unsafe)
- New checks must be registered in `src/checks/index.ts` → `allChecks` array

### Visitor system (`src/visitor.ts`)

`visit<S, R>(ast, visitor)` walks an AST depth-first and collects return values.

For checks the engine calls `visitLiquid` / `visitJSON` which support both entry (`NodeType`) and exit (`NodeType:exit`) visitor methods, plus `onCodePathStart` / `onCodePathEnd` lifecycle hooks.

`findCurrentNode(ast, cursorPosition)` — used by LSP for cursor-aware features.

### Fix / autofix infrastructure (`src/fixes/`)

- `StringCorrector` — for Liquid/YAML: records `replace(start, end, text)` and `remove(start, end)` operations
- `JSONCorrector` — for JSON: operates on the JSONNode tree
- `GraphQLCorrector` — for GraphQL
- `createCorrector(type, source)` — factory returning the right corrector
- `applyFixToString(source, fix)` — applies collected `FixDescription[]` to a string
- No YAML autofix: `createCorrector` throws for `SourceCodeType.YAML`

### `AugmentedPlatformOSDocset` (`src/AugmentedPlatformOSDocset.ts`)

Wraps the raw `PlatformOSDocset` (from dependency injection) with:
- Memoization on all methods
- Alias expansion for filters
- Normalization of inconsistent `deprecated: false` + `deprecation_reason: 'true'` entries
- Injection of undocumented-but-valid filters/tags

### Context utilities (`src/context-utils.ts`)

Factory functions for the augmented dependency methods:
- `makeGetTranslationsForBase(fs, app)` — loads and merges YAML translation files; open editor buffers take precedence over filesystem
- `makeGetDefaultTranslations(fs, app, rootUri)` — loads `app/translations/en.yml`, strips locale root key
- `makeGetDefaultLocale(fs, rootUri)` — always returns `'en'`
- `makeGetRouteTable(fs, rootUri, existing?)` — at most one `RouteTable` per run,
  produced on the first `context.getRouteTable()`. `existing` is either a table (the
  LSP's, kept current by file events) or a **provider** for a caller whose table costs
  something to make current (check-node reconciles a process-level one). Knowing a
  route means reading every page in the project, and `MissingPage` is its only
  consumer, so a check must ask for it at the point it needs a URL resolved — never in
  `onCodePathStart`.

## Testing

Tests use **Vitest** with custom matchers defined in `src/test/`.

### Test utilities (`src/test/test-helper.ts`)

```ts
import { runLiquidCheck, runYAMLCheck, check } from '../../test';

// Run a single check on one file. The default path is app/views/partials/file.liquid:
const offenses = await runLiquidCheck(MyCheck, '{{ x | unknown }}', 'app/views/pages/x.liquid');

// Run recommended checks on a whole mock app:
const offenses = await check({ 'app/views/partials/foo.liquid': '...' });

// Apply the auto-fix suggestion:
const result = applySuggestions(sourceCode, offenses[0]);

// Show highlighted source ranges for offenses:
const highlighted = highlightedOffenses({ 'app/views/partials/file.liquid': sourceCode }, offenses);
```

`MockApp` is `Record<relativePath, source>`. `MockFileSystem` provides the `AbstractFileSystem` implementation backed by the same object.

**Fixture paths must be REAL platformOS paths.** `getApp` builds an actual
`App.fromSources`, so a check under test resolves names through the same index,
`searchPathIndex` precedence and module shadowing that ship — and the model holds only
files in a recognized platformOS directory. A path it drops makes `getApp` THROW and
name the path, rather than leave the test passing against an empty app, which is what
two fixtures here were quietly doing. If a test's subject depends on the file's TYPE
(a layout, a page, a translation), name its path rather than lean on the default.

There is no `runJSONCheck`: a platformOS app has no JSON source (`sourceCodeTypeOf` has
no `.json` row), so no `.json` file is ever in an `App` and no JSON-typed check can
run. `ValidJSON` and `JSONSyntaxError` were removed for that reason.

### Custom matchers

- `expect(offenses).containOffense('message string')` — checks by message
- `expect(offenses).containOffense({ check: 'Code', severity: Severity.WARNING })` — checks by subset of keys
- Chai-based (legacy): `.to.offer.fix()`, `.to.suggest()`

### Test setup (`src/test/test-setup.ts`)

Loaded automatically by vitest (see root `vitest.config.ts`). Registers the custom matchers. New tests should use `expect.extend` / `containOffense` style, not chai.

## Key types to know

| Type | Purpose |
|------|---------|
| `AppModel` / `AppFile` | `platformos-common`'s `App` — the project's files, lazily read and parsed. What `check()` takes. There is no array form. |
| `TypedAppFile<T>` | An `AppFile` whose `SourceCodeType` is known, carrying the AST that type implies. What the engine hands a check. |
| `SourceCode<T>` | `{ uri, type, source, ast, version? }` |
| `CheckDefinition<T>` | Static descriptor with `meta` + `create` factory |
| `Check<T>` | Visitor object returned by `create()` |
| `Context<T, S>` | Passed to `create()`; includes `report()` and all deps |
| `Offense` | Recorded problem: `{ check, message, uri, severity, start, end, fix?, suggest? }` |
| `Problem<T>` | Argument to `context.report()` |
| `Dependencies` | Injectable services (`fs`, `platformosDocset`, etc.) |
| `AugmentedDependencies` | Extends `Dependencies` with derived helpers |
| `PlatformOSDocset` | `filters()`, `objects()`, `tags()`, `graphQL()` |
