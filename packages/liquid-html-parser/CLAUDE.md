# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Package Overview

`@platformos/liquid-html-parser` is the core Liquid + HTML parser for the platformOS Tools monorepo. It produces a typed AST consumed by the Prettier plugin, linter (`platformos-check-*`), and language server (`platformos-language-server-*`).

## Commands

```bash
yarn build          # Compile TypeScript to dist/ (runs prebuild shims first)
yarn type-check     # Type-check without emitting
```

Tests are run from the monorepo root:
```bash
yarn workspace @platformos/liquid-html-parser test
```

## Two-Stage Architecture

### Stage 1 — CST (`src/stage-1-cst.ts`)

Converts source string → flat Concrete Syntax Tree using the Ohm.js grammar (`grammar/liquid-html.ohm`). Open/close block tags appear as **siblings** at this stage, not parent/child.

### Stage 2 — AST (`src/stage-2-ast.ts`)

Converts CST → hierarchical Abstract Syntax Tree. Block open/close pairs are merged into a single node with a `children` array. This is what downstream consumers use.

**Public API:**

```typescript
toLiquidHtmlAST(source, options?)   // Full Liquid+HTML parse; allowUnclosedDocumentNode=false
toLiquidAST(source, options?)       // Liquid-only; allowUnclosedDocumentNode=true
toLiquidStatementAST(source, options?)  // Individual statements inside {% liquid %} tag
```

**Options:**
```typescript
{
  allowUnclosedDocumentNode?: boolean;
  mode?: 'strict' | 'tolerant' | 'completion' | 'placeholder';  // default: 'tolerant'
}
```

### Grammar (`grammar/liquid-html.ohm`)

~775-line Ohm.js grammar. There are three grammar sets selected by mode:
- `tolerantGrammars` (default) — fault-tolerant, recovers from syntax errors
- `strictGrammars` — stricter validation
- `placeholderGrammars` — with placeholder token support for completion

### Build Shim (`build/shims.js`)

The prebuild step wraps `grammar/liquid-html.ohm` as a JS module (`grammar/liquid-html.ohm.js` using `String.raw`). This runs automatically before `build:ts`.

## Key Types (`src/types.ts`)

All nodes implement `ASTNode<NodeTypes.X>` with:
- `type: NodeTypes.X` — discriminator for exhaustive switch statements
- `position: { start: number; end: number }` — 0-indexed source offsets (end is exclusive)

The `NodeTypes` enum covers: `Document`, `HtmlElement`, `HtmlVoidElement`, `HtmlRawNode`, `HtmlComment`, `HtmlDoctype`, `LiquidTag`, `LiquidBranch`, `LiquidRawTag`, `LiquidVariableOutput`, `LiquidVariable`, `LiquidFilter`, `LiquidLiteral`, `String`, `Number`, `Range`, `VariableLookup`, `NamedArgument`, `Comparison`, `LogicalExpression`, attribute types, markup types, and platformOS-specific markup types.

**platformOS-specific markup node types:** `BackgroundMarkup`, `BackgroundInlineMarkup`, `CacheMarkup`, `LogMarkup`, `SessionMarkup`, `ExportMarkup`, `RedirectToMarkup`, `IncludeFormMarkup`, `SpamProtectionMarkup`.

## Grammar Constants (`src/grammar.ts`)

```typescript
BLOCKS          // Set of block-level tag names
RAW_TAGS        // Tags whose content is unparsed (script, style, etc.)
VOID_ELEMENTS   // Self-closing HTML elements
TAGS_WITHOUT_MARKUP  // Liquid tags that take no markup (break, continue, etc.)
```

## Adding a New Tag

1. Add grammar rule(s) to `grammar/liquid-html.ohm` in both tolerant and strict grammars
2. If it is a block tag, add the tag name to `blockName` rule and `BLOCKS` constant
3. Define a markup interface in `src/types.ts` and add the `NodeTypes` enum value if needed
4. Wire the CST → AST transformation in `src/stage-2-ast.ts`
5. Export new types from `src/index.ts` if needed
