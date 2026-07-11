# Platform facts vs. conventions: keep platformos-graph convention-free; layer the commands/queries/resource convention on top

## Status

Accepted (2026-06-30). Refines ADR 003 (graph-backed structural enrichment).

## tl;dr

`commands` and `queries` are **not** platformOS primitives — they are a
convention of the `core` module: a partial under `lib/commands/<x>` (write) or
`lib/queries/<x>` (read), invoked by `{% function %}`. The platform sees only "a
`function` edge to a partial." Therefore **`platformos-graph` (the canonical
platform model, consumed by the LSP) must stay convention-free**, and the
resource/CRUD-completeness view from the old `detectResources` — which fuses
platform facts with the `core` convention — must be split: platform facts may
live in the graph; the convention overlay must live in a separate, clearly
labeled, configurable layer on top of it.

## Context

ADR 003 decided to resurrect the old supervisor's project-map capabilities
inside `platformos-graph`. While implementing the query layer (TASK-9.2) we hit
a boundary problem the old code ignored.

### Two kinds of truth

| | Platform truth | Convention truth |
|---|---|---|
| Authority | platformOS itself | the `core` module (or whichever modules an app installs) |
| Always correct? | Yes, for every app | Only for apps following the convention |
| Examples | partial, page, layout, graphql op, asset, schema/`custom_model_type`; the edges between them; a graphql op's `table`; a page's `slug` | "this partial is a command/query"; "a resource needs search/find/create/update/delete"; pluralized-path grouping (`/commands/{plural}/`) |

The old `detectResources` (recovered from `project-scanner.js`) **fused these**:
`pluralize` + `/commands/{plural}/` + `/queries/{plural}/` + the expected-CRUD
set are all *convention truth* presented as platform facts.

### Why the graph must stay convention-free

- `platformos-graph` is consumed by the **LSP** (go-to-definition, references,
  dead-code). Encoding the `core` CQRS opinion there gives editor features
  assumptions that are **false for apps not using `core`**.
- If `core` changes its convention, or an app uses a different module, a graph
  that "knows" commands/queries is wrong — in the foundation everything builds on.
- The current graph is **already correct**: `getPartialModule` classifies
  `commands/`, `queries/`, and `lib/` all as `kind: Partial`. Adding
  `LiquidModuleKind.Command/.Query` would be the mistake.

### The clarifying asymmetry

Resource completeness needs several inputs; they split cleanly:

- **Legitimate platform facts** (may grow the graph): schema/`CustomModelType`
  nodes (custom model types *are* a platform primitive); a graphql op's `table`
  (a platform GraphQL concept); a page's `slug` (frontmatter is platform).
- **Convention overlays** (must NOT enter the graph core): command/query roles,
  pluralize grouping, the expected-CRUD set, "resource completeness."

So: *resource/CRUD completeness = (platform facts, graph-eligible) + (a
convention overlay, not graph-eligible).*

### The convention produces two outputs, wanting different homes

1. **Descriptive map** ("resource → its commands/queries/graphql/pages"):
   project-map data to *show* an agent; not an offense. Home: the supervisor's
   per-domain layer (TASK-8), which exists for domain conventions — or a
   clearly-quarantined `platformos-graph/conventions/*` exported separately from
   the neutral query API. Preferred: the domain layer, keeping the graph pristine.
2. **Prescriptive warning** ("table X has a query but no `create` command"):
   opinionated, actionable, and **toggleable** — exactly what a custom check is
   for. An app not following the `core` convention disables it via
   `.platformos-check.yml`. That configurability is the tell that it is
   convention, not platform law.

**Rule of thumb:** facts → graph; descriptive convention map → domain layer
(consumes graph); prescriptive convention warnings → a configurable check
(consumes graph). All three build on the same convention-free graph facts; none
teaches the graph the convention.

### Deepest layer (noted, likely out of scope to build now)

The convention is **module-defined**: the command/query path roots are whatever
the installed modules declare, not universally `commands`/`queries`. Hardcoding
`core`'s roots is a pragmatic 95% solution; making them **configurable** is the
principled hedge. Reading them from installed modules is probably
over-engineering — but the design must leave room for parameterization rather
than baking the roots in.

## Decision

1. **`platformos-graph` stays convention-free.** TASK-9.2 Phases 1–3
   (dependents / orphan / reachability / exists / missing-target / call-site
   args / nearest-name) are neutral and correct; they ship as the query API. Do
   **not** add command/query kinds or resource/CRUD logic to the graph core.
2. **Resource/CRUD completeness is deferred and split by output type:**
   - **Platform-fact groundwork** (TASK-9.6) — model only neutral facts in the
     graph: schema/`CustomModelType` nodes, a graphql op's `table`, page `slug`.
     No convention.
   - **Convention map + warnings** (TASK-9.7) — descriptive map in the domain
     layer and/or prescriptive warnings in a configurable check; both consume
     the graph facts; path roots configurable; the supervisor stays a pure
     consumer.
3. **TASK-9.2 closes at Phases 1–3.** Its "resource/CRUD completeness" clause
   moves to TASK-9.6/9.7 with this ADR as the governing constraint.

## Consequences

- **Positive:** the platform model (and the LSP that depends on it) stays
  correct for every app, regardless of which modules it installs. Convention
  lives where it can be turned off. The supervisor remains a pure consumer.
- **Cost:** resource completeness is no longer a single function; it is a
  facts-layer (graph) + an overlay-layer (domain/check). This is deliberate —
  the seam is the whole point.
- **If we ignore this boundary:** command/query in the graph couples the
  platform model + LSP to one module (wrong for non-`core` apps, brittle to
  convention drift); always-on resource-completeness yields false positives for
  apps with a different architecture and erodes agent trust.
- **Undo/mitigation:** the split is additive. If a convention ever became truly
  universal platform truth, its detection could be promoted from the overlay
  into the graph without disturbing consumers (the neutral API is a subset).
