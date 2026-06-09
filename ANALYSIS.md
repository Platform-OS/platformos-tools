 4. The core architectural problem: a lossy structured→string→structured round-trip

  This is the single most important finding and the spine of any refactor argument.

  check-common Offense        LSP Diagnostic            supervisor re-derivation
  { check, message,     ──▶   { code, message,    ──▶   extractParams() regex on the
    start, end,               range }                    message STRING → params{},
    fix:Corrector,            (fix/suggest dropped)      templateOf() masking,
    suggest:[...] }                                      fix-generator rebuilds fixes

  - check-common already knows structurally which filter was unknown, what the nearest suggestion is, and how to fix it (fix/suggest correctors).
  - The LSP boundary flattens that to a message string and drops the structured fix/suggest.
  - The supervisor then regex-parses the English message back into params (diagnostic-record.ts has 16 per-check extractors, explicitly "MUST match the source byte-for-byte"), and regenerates
  fixes from scratch (fix-generator.ts, 18 per-check functions).

  The supervisor's own comment admits the fragility: "drift here silently breaks every rule that reads diag.params.X", pinned only by a 23-case contract test. This is duplicated intelligence
  connected by a brittle string contract. check-common changes a message wording → supervisor silently loses params, hints, and fixes.

  5. Justifications for keeping the packages separate

  These are genuine and should survive any refactor:

  1. Runtime boundary. check-common is deliberately runtime-agnostic (it powers -browser too). The supervisor is hard Node: node:fs, @modelcontextprotocol/sdk, stdio, an in-process LSP. Merging
  would drag a server runtime and the MCP SDK into the browser-shippable core. Hard no.
  2. Different consumers, different stability contracts. check-common's Offense is consumed by editors, the CLI, and the browser playground — it must stay minimal and stable. The supervisor's
  ValidateCodeResult is an LLM-ergonomics surface that will churn fast (hints, confidence, next_step, scorecard) as prompt/agent behavior is tuned. Coupling their release cadence would
  destabilize the editor toolchain.
  3. Separation of "what's wrong" from "what an agent should do about it." Detection (linting) and remediation-advice-for-an-LLM are legitimately different concerns with different domain
  experts and different failure modes. A false fix suggestion is an agent-UX problem; a false offense is a linter-correctness problem.
  4. Dependency weight & blast radius. The supervisor pulls MCP SDK, zod, vscode-languageserver, and ships a data/ payload. None of that belongs in a library every editor integration installs.
  5. Independent test surfaces. The supervisor needs parity/integration/stdio-bin tests against captured baselines; check-common needs per-check unit pins. Distinct.

  However — separation of packages does not justify separation of intelligence. Points 1–5 argue for two packages; they do not justify the supervisor re-detecting and re-fixing what
  check-common already computes structurally. That's the mistake, addressed below.

  6. Drafted responsibilities (the clean boundary)

  platformos-check-common — "the source of truth for correctness"

  - Owns all detection logic as CheckDefinitions over the 4 source types.
  - Owns the structured Offense including structured fix/suggest correctors — and should be the only place fixes are authored.
  - Owns the docset abstraction (PlatformOSDocset, augmentation, alias expansion, undocumented-entry injection).
  - Owns the check vocabulary (codes, severities, docs.description, recommended-set).
  - Should expose enough structured detail on each offense (the matched identifier, the suggestion, the fix) that downstream consumers never need to regex the message.
  - Stays runtime-agnostic, stateless, browser-safe.

  platformos-mcp-supervisor — "the agent-facing remediation & orchestration layer"

  - Owns the MCP server, the validate_code tool, stdio transport, lifecycle.
  - Owns orchestration: project scanning, the in-process LSP client, caching, the ordered pipeline.
  - Owns agent ergonomics: prose hints, confidence scoring, next_step, clustering, scorecard, must_fix_before_write — the things that are about how an LLM consumes results, not about
  correctness.
  - Owns net-new analyses that check-common deliberately doesn't ship (the legitimately-additive pos-supervisor:* structural warnings: HtmlInPage, GraphqlInPartial, MissingReturn, etc.) —
  though these are candidates to promote into check-common if they're truly correctness checks (see §7).
  - Owns knowledge/data (gotchas, content-triggers, Shopify-contamination, domain guides).
  - Consumes check-common's structured output directly — not via regex on LSP strings.

  7. Existing architecture mistakes

  1. 🔴 The structured→string→regex round-trip (§4). The deepest mistake. diagnostic-record.ts (16 extractors) + the fallback regex in error-enricher.ts exist only because the structured
  offense was thrown away at the LSP boundary.
  2. 🔴 Going through the LSP for batch linting. The supervisor boots a full language server over PassThrough streams and awaits publishDiagnostics just to lint one buffer. The LSP is built for
  interactive editing (open/change/diagnostics push). For a request/response "lint this string" need, calling check-common's check() directly would be simpler, synchronous, fully typed, and
  would preserve the structured fix/suggest. The in-process-LSP machinery (lsp-client.ts, 524 LOC, PassThrough trick, settle timeouts, the documented "HTTP fetch may outlive close()" caveat) is
  largely accidental complexity bought to avoid the pos-cli subprocess — but the right replacement was the library, not an embedded server.
  3. 🟠 Duplicated cross-file graph. project-fact-graph.ts / dependency-graph.ts / project-scanner.ts re-implement render/function/graphql resolution and orphan/dependent analysis that
  platformos-graph (consumed by check-common) already does. Two graph implementations will drift.
  4. 🟠 Duplicated docset wrappers. FiltersIndex/ObjectsIndex/TagsIndex re-wrap the same docset that AugmentedPlatformOSDocset already wraps (memoization, alias expansion). The supervisor
  reuses the docset data but not the augmentation logic.
  5. 🟠 Duplicated fix infrastructure. check-common has correctors + FixDescription; the supervisor has a parallel Fix union and 1.7k LOC of fix generation. Many supervisor fixes (strip lib/
  prefix, convert include→render, did-you-mean filter) correspond to fixes check-common can already express.
  6. 🟡 Overlap inside the supervisor itself. structural-warnings.ts emits pos-supervisor:DeprecatedTag, pos-supervisor:MissingContentForLayout, pos-supervisor:MissingSlug,
  pos-supervisor:NonGetRenderingPage — names that also exist as LSP checks, forcing dedup logic (existingChecks set, step 2c1 "drop upstream ValidFrontmatter rows that collide on line"). Some
  of these "structural warnings" are really correctness checks that belong in check-common; others are genuinely additive. They're not cleanly separated.
  7. 🟡 An 1,227-LOC orchestrator with a 15-step load-bearing-ordered pipeline. "Ordering is load-bearing" + many suppress*/verify*OnDisk steps that re-check the filesystem to correct false
  positives the LSP produced (steps 9–13 cross-check MissingAsset/TranslationKeys/MissingPage/Orphaned/MissingPartial against disk). Several of these suppressions exist because the LSP ran
  without full project context — a problem that disappears if check-common runs directly with the project's AbstractFileSystem.
  8. 🟡 Knowledge duplication. data/checks/*.yml and data/hints/*.md redescribe checks whose canonical docs.description already lives in check-common's meta. Two sources of truth for "what does
  this check mean."

  8. Goals of the refactoring

  North star: check-common is the single source of truth for detection + structured fixes; the supervisor is a thin, agent-facing orchestration + ergonomics layer that consumes structured
  output — no string round-trips, no re-detection.

  1. Replace the LSP boundary with a direct library call for the batch-validate path. Call check-common's check() (via a small node façade) so the supervisor receives Offense[] with intact
  fix/suggest and structured detail. Retire the in-process LSP for linting (keep it only if hover/completion are genuinely needed).
  2. Delete the regex re-parsing layer. Once offenses arrive structured, diagnostic-record.ts's 16 extractors and the fallback regex enrichment collapse into reading typed fields. This removes
  the brittle byte-for-byte message contract entirely.
  3. Push correctness up, keep ergonomics down. Audit the 16 pos-supervisor:* structural detectors and the supervisor's fixes: promote the ones that are correctness into check-common as real
  CheckDefinitions (with structured fixes); keep only agent-ergonomic transformation (prose hints, confidence, clustering, next_step, scorecard) in the supervisor.
  4. Reuse, don't re-derive, the project graph and docset. Consume platformos-graph and AugmentedPlatformOSDocset instead of project-fact-graph/FiltersIndex et al. One graph, one docset
  wrapper.
  5. Single source of check metadata. Hints/descriptions should derive from (or be validated against) check-common's meta.docs, not a parallel data/checks/*.yml.
  6. Shrink the orchestrator. With structured input and full project context, most suppress*OnDisk correction steps (pipeline steps 9–13) become unnecessary — they exist to patch context the
  LSP lacked. The 15-step ordered pipeline should shrink toward a small, order-independent enrichment set.
  7. Preserve the package split, formalize the contract. Keep two packages (§5 still holds), but make the seam a typed structured API (Offense + docset + graph), not a serialized LSP/JSON-RPC
  string protocol.

  ---
  Bottom line: The two packages should stay separate — different runtimes, audiences, and stability contracts make that correct. But today they're separated by the wrong seam: a lossy
  LSP-message string boundary that forces the supervisor to re-detect, re-parse, and re-fix what check-common already computes. The refactor's job is to keep the package boundary while moving
  the seam to a structured, typed contract, collapsing ~several thousand lines of regex re-parsing, duplicate graphs, duplicate docset wrappers, and false-positive-correction steps into direct
  reuse of check-common's structured output.
