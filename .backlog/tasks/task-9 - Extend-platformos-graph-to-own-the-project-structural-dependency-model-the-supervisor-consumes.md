---
id: TASK-9
title: >-
  Extend platformos-graph to own the project structural/dependency model the
  supervisor consumes
status: To Do
assignee: []
created_date: '2026-06-23 10:32'
updated_date: '2026-06-25 15:45'
labels: []
dependencies: []
references:
  - >-
    docs/mcp-supervisor/decisions/003-graph-backed-structural-enrichment/README.md
  - packages/platformos-graph/src/graph/traverse.ts
  - packages/platformos-graph/src/types.ts
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Why
The rebuilt `validate_code` must tell agents not just *what is wrong* in a file but *how it sits in the project* — who renders it, what it renders/calls, whether it is orphaned, whether a target is missing, "did you mean" candidates, resource/CRUD completeness. The v1 supervisor did this with a BESPOKE in-supervisor graph + scanner (`project-fact-graph.ts`, `dependency-graph.ts`, `project-scanner.ts`, `render-flow.ts`) — exactly the duplicate-graph mistake the rebuild eliminates (ANALYSIS.md §6, invariant #3).

**Principle:** the supervisor is a pure consumer; ALL graph / project-structure functionality lives in `platformos-graph`. So we EXTEND `platformos-graph` to provide what the supervisor needs and resurrect the old `project-map` capabilities AS THE GRAPH PACKAGE'S API. The supervisor calls it and shapes the output into `ValidateCodeResult` — it re-implements no graph logic.

See ADR `docs/mcp-supervisor/decisions/003-graph-backed-structural-enrichment/README.md` for the full discovery + decision.

## Current state of platformos-graph (2026-06-12)
- `AppGraph` = modules with `dependencies` (outgoing) / `references` (incoming) `Reference[]`, `kind` (Page|Partial|Layout), `exists`.
- `Reference = { source, target, type: 'direct'|'indirect' }` — has call-site ranges but NO semantic kind and NO args.
- `traverseModule` extracts ONLY `{% render 'literal' %}`, asset filters, and `<custom-element>` edges; entry points are pages+layouts. So commands/queries/graphql files are largely absent; no function/graphql/include/layout edges; no query/project-map API; no per-file self-structural.

## Scope (extend the graph package; consume existing owners, don't duplicate)
Delegate to `platformos-check-common` for facts it already owns — partial `@param` signatures (`getDocDefinition`/liquid-doc), frontmatter validity + schema, docset. The graph composes those; it does not re-derive them.

## Constraints
- Additive changes only (e.g. an OPTIONAL `Reference.kind`) — `platformos-graph` is consumed by the LSP (`platformos_references` / `platformos_dependencies` / `platformos_dead_code`); re-verify those.
- The supervisor remains a pure consumer: zero graph/scanner logic added to `platformos-mcp-supervisor`.

This is the tracking epic. See child tasks. Prerequisite for the supervisor's structural enrichment (TASK-8.4) and the fuller TASK-7.6 ProjectContext.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 platformos-graph models function/graphql/include/layout edges (not just render/asset/web-component); command/query/graphql files are first-class nodes
- [ ] #2 platformos-graph exposes a documented project-structure/query API (dependents, orphan, reachability, missing-target, render-call args, nearest-name candidates, resource/CRUD completeness) that resurrects the old project-map capabilities
- [ ] #3 Facts owned by check-common (partial @param signatures, frontmatter, schema, docset) are consumed/composed, not duplicated, inside the graph package
- [ ] #4 The LSP consumers (references/dependencies/dead_code) remain correct (re-verified) and changes to shared types are additive
- [ ] #5 platformos-mcp-supervisor consumes this API and contains NO graph/scanner logic of its own
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Supervisor wiring guidance — consuming `extractFileReferences` (2026-06-25)

The per-file dependency primitive now exists in `platformos-graph` (see TASK-9.3 notes). This is how the supervisor (`platformos-mcp-supervisor`, branch `add-pos-supervisor`) should wire it into `validate_code`. WRITE NO GRAPH LOGIC IN THE SUPERVISOR (invariant #5 / this epic's principle) — it only calls the primitive and shapes the output.

### Where it goes (respect the architecture guards)
- Graph resolution does fs I/O → it must NOT live in the pure layers. The `architecture-invariants.spec.ts` guard marks `enrich/` and `result/` as PURE (no fs/process/I/O). So add a NEW I/O-layer sibling to `lint/` — e.g. `src/structure/` — that calls `extractFileReferences`, exactly mirroring how `lint/lint.ts` is the only other I/O seam.
- Do NOT route through `platformos-language-server-common` / `AppGraphManager` — that's a banned dependency (invariant #1, enforced). Use `@platformos/platformos-graph` directly (already a declared dep, currently unused).

### Call shape (matches the existing `runLint` seam)
```ts
import { extractFileReferences, toSourceCode } from '@platformos/platformos-graph';
import { NodeFileSystem } from '@platformos/platformos-check-node'; // supervisor already deps check-node

const rootUri = URI.file(projectDir).toString();          // projectDir from SupervisorContext
const sourceUri = URI.file(absoluteFilePath).toString();   // same abs path runLint builds
const sourceCode = await toSourceCode(sourceUri, content); // parse the BUFFER, not disk
const refs = await extractFileReferences(rootUri, sourceUri, sourceCode, { fs: NodeFileSystem });
```
Key: parse `params.content` (the in-flight buffer), NOT the on-disk file — the file may not exist yet ("validate before writing"). `rootUri`/`projectDir`: reuse check-common `findRoot` for consistency with the CLI if you want pointed-inside-project tolerance.

### Result shaping (pure `result/` layer)
- Map `Reference[]` → a NEW agent-facing `dependencies` field on `ValidateCodeResult` (e.g. `{ kind, target_path, line, column }[]`). Convert `target.uri` → project-relative via check-common `path.relative(target.uri, rootUri)`; convert `source.range` offsets → 1-based line/col with the SAME `+1`/positionAt approach `lint.ts` uses.
- Do NOT overload the existing name-level `structural.renders_used` (that's TASK-9.3's self-structural NAMES, a separate slot). `dependencies` = resolved edges; `structural.*` = declared names.

### What NOT to duplicate (overlap with existing lint)
- The linter ALREADY emits `MissingPartial` for unresolved render targets. So do NOT re-detect missing targets as supervisor diagnostics from the dependency edges — the unique value the graph adds is the CANONICAL RESOLVED URI + the `kind` taxonomy, not re-flagging "missing". If you want an explicit `exists` per edge, `stat` `target.uri` via the same `fs` in the `structure/` layer (don't add `exists` to check-common's `Reference` — too broad, breaks LSP).

### Out of scope for the primitive (future graph work, still TASK-9.2)
- Incoming `references` ("who renders this file") need the on-disk whole-graph build (`buildAppGraph`) + per-root caching (mirror `AppGraphManager`'s cache). That's heavier and project-wide; defer to the project-structure query API (TASK-9.2). At validate-time the file's OWN outgoing deps are the primary signal.

### Verify after wiring
- `architecture-invariants.spec.ts` still green (no LSP dep, pure layers stay pure, `structure/` is the only new I/O seam).
- AC #5 of this epic: supervisor contains zero graph/scanner logic — it just calls `extractFileReferences` and maps the result.
<!-- SECTION:NOTES:END -->
