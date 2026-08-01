/**
 * Which diagnostics actually block a write.
 *
 * WHY THIS EXISTS. `must_fix_before_write` used to be `errors.length > 0`, which
 * inherited check-common's severities wholesale. Those severities are calibrated
 * for a LINTER IN AN EDITOR, where `ERROR` means "red squiggle, look at this". A
 * write gate answers a different question:
 *
 *     will this file be broken if I write it?
 *
 * That is a strictly smaller set. 21 checks carry `Severity.ERROR`, but only the
 * ones below mean the file genuinely will not work. The reported case: passing an
 * argument a partial does not declare is `Severity.ERROR`, yet platformOS simply
 * ignores the argument and the page renders correctly — so the gate was telling an
 * agent it must fix dead code before writing.
 *
 * THE MEMBERSHIP RULE, for whoever adds the next check:
 *
 *   BLOCKING     Writing this file produces something broken. Any one of:
 *                  - it will not parse;
 *                  - it will raise at runtime;
 *                  - the deploy converter REJECTS it, which fails the whole
 *                    changeset rather than this one file.
 *
 *   EXCEPTION    Two members block without meeting that bar. Both are deliberate,
 *                both are named and argued individually below, and the argument is
 *                the same in each case: the file violates a contract its own author
 *                WROTE DOWN in this repository, rather than a rule we inferred.
 *                Nothing joins them without making that argument explicitly.
 *
 *   NOT BLOCKING everything else — dead code, style, performance advice,
 *                hygiene, degraded-but-working output. Still REPORTED (severity
 *                is untouched); the agent decides.
 *
 * MEMBERSHIP IS ESTABLISHED BY MEASUREMENT, NOT BY READING THE CHECK'S NAME. Three
 * of the original twelve entries were wrong when finally measured against a live
 * instance: `MissingAsset` and `ReservedVariableName` blocked files that render
 * HTTP 200, and `JsonLiteralQuoteStyle` — filed under "no runtime effect" — is a
 * deploy-wide rejection. A plausible-sounding justification in this file is worth
 * nothing; run the code.
 *
 * Severity is deliberately NOT changed. A dead argument stays an `error` in
 * `errors[]` and keeps `status: 'error'`; it just no longer gates the write. That
 * keeps check-common untouched — the language server and CLI behave exactly as
 * before — and keeps this agent-ergonomics judgement inside the supervisor, where
 * the architecture says it belongs (non-goal #4: correctness lives in check-common,
 * the supervisor keeps ONLY agent ergonomics).
 */

/**
 * Check codes whose presence means the file is broken.
 *
 * Each entry states WHY it blocks, because "it felt severe" is how this list rots
 * back into a copy of the severity table.
 */
export const BLOCKING_CHECKS: ReadonlySet<string> = new Set([
  // Does not parse. Nothing downstream can be trusted about the file at all.
  'LiquidHTMLSyntaxError',
  'JSONSyntaxError',
  'ValidJSON',

  // Broken reference: the target does not exist, so the render fails at runtime.
  'MissingPartial',

  // platformOS raises on an unknown filter rather than ignoring it.
  'UnknownFilter',

  // A single-quoted key or value inside a `{% assign %}` JSON literal. Measured:
  // `{% assign o = {'k': 'v'} %}` raises `Liquid syntax error: Invalid JSON in
  // assign: expected ':', got '''`, and `pos-cli deploy --dry-run` REJECTS — which
  // fails every file in the changeset, not just this one. Array literals behave
  // identically. This sat under "no runtime effect" until it was actually run.
  'JsonLiteralQuoteStyle',

  // The query is invalid against the schema, or references a variable that does
  // not exist: it fails when executed.
  'GraphQLCheck',
  'GraphQLVariablesCheck',

  // Runtime error on execution.
  //
  // NOT independently verified against a live instance. It shares this
  // justification with `ReservedVariableName`, which was measured and turned out
  // NOT to raise; that makes the shared reasoning unreliable rather than wrong, so
  // this entry is kept (removing it on suspicion would be the same unmeasured
  // guess in the other direction) and flagged for measurement — TASK-19.1 AC#5.
  'InvalidHashAssignTarget',

  // --- The two deliberate exceptions to the membership rule. ---
  //
  // Neither will fail to parse, raise, or be rejected on deploy. Both block because
  // the file breaks a contract its author WROTE DOWN, which is a stronger signal of
  // a mistake than any inference we could make.

  // A required `@param` the partial's own doc block DECLARES was not passed.
  // Measured: `{% doc %}` is inert at runtime, so this cannot raise — the page
  // deploys and returns HTTP 200 with the params empty (`a=[] b=[]`). It blocks
  // because the author declared the parameter required in this repository.
  'MissingRenderPartialArguments',

  // A layout that never outputs `content_for_layout`. Measured: HTTP 200 with the
  // page body silently dropped. It blocks because a layout exists to render its
  // content, so one that cannot is a defeated contract — and a silently blank page
  // is harder to diagnose than an error.
  'MissingContentForLayout',
]);

/**
 * NOT in the set, and deliberately so — recorded because each looks severe:
 *
 * - `PartialCallArguments` reports TWO different things under one code: an unknown
 *   (dead) argument, and a missing required one. There is no structured
 *   discriminator on the offense, and non-goal #2 forbids regex over messages, so
 *   the code cannot be split here. It is non-blocking wholesale, which is safe
 *   because the blocking half is independently covered: a partial with a `{% doc %}`
 *   block also raises `MissingRenderPartialArguments`, which DOES block (verified —
 *   both fire together). What that leaves unblocked is a DOC-LESS partial whose
 *   required params are INFERRED from usage. Blocking a write on a heuristic
 *   inference is exactly the false block this task removes, and the failure mode is
 *   a nil value rather than a crash.
 * - `UnrecognizedRenderPartialArguments` is the same dead-argument finding.
 * - `MissingAsset` — REMOVED from the set after measurement. `asset_url` is pure
 *   string construction: it never resolves the asset, never raises, and even
 *   `'' | asset_url` returns a URL. `{{ 'no_such.css' | asset_url }}` renders, the
 *   page returns HTTP 200 with the link tag present, and `--dry-run` accepts. The
 *   asset 404s in the browser; the page is fine — "degraded-but-working", which the
 *   rule above places outside the set. It also misfires on assets that exist on the
 *   instance but not in the local tree.
 * - `ReservedVariableName` — REMOVED from the set after measurement. It was filed
 *   under "runtime errors"; it does not error. `{% assign blank = 'oops' %}` renders
 *   `[]`, `{% assign true = 'oops' %}` renders `[true]`, the deployed page returns
 *   HTTP 200. The code is certainly wrong and is still reported loudly as an
 *   `error` — but it is the same "visibly wrong, still a working page" class as
 *   `TranslationKeyExists` below, and consistency there is the whole point.
 * - `TranslationKeyExists` / `MatchingTranslations` — a missing key renders the key
 *   or an empty string. Visibly wrong, still a working page.
 * - `UnknownProperty` — resolves to nil; the page renders.
 * - `UniqueDocParamNames`, `ValidDocParamTypes` — doc hygiene with no runtime
 *   effect (measured: duplicate `@param` names and invalid `@param` types render
 *   fine, since `{% doc %}` is inert at runtime).
 * - `ImgWidthAndHeight`, `ParserBlockingScript` — performance advice.
 * - `ValidFrontmatter` — two of its three findings (unknown key, missing layout) ARE
 *   hard deploy rejections, so this absence is a known gap rather than a judgement.
 *   It reports all three findings under one code with no structured discriminator,
 *   exactly like `PartialCallArguments` above, so adding it would fix two false
 *   approvals and create one false block. Blocked on a discriminator — TASK-26.
 */

/** A diagnostic, narrowed to what the gate reads. */
interface GateInput {
  check: string;
  severity: string;
}

/**
 * Whether this set of diagnostics should stop the agent writing the file.
 *
 * An UNRECOGNIZED check code is treated as NON-blocking. That default is
 * load-bearing: check-common gains checks over time and community extensions can
 * contribute their own, and a gate that blocked on codes it had never heard of
 * would silently over-block every time the engine grew. Erring toward "let the
 * agent write it" also matches how everything else here degrades — the supervisor
 * never blocks on its own uncertainty.
 */
export function blocksWrite(diagnostics: readonly GateInput[]): boolean {
  return diagnostics.some(
    (diagnostic) => diagnostic.severity === 'error' && BLOCKING_CHECKS.has(diagnostic.check),
  );
}
