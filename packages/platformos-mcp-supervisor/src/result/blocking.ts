/**
 * Which diagnostics actually block a write.
 *
 * check-common's severities are calibrated for a LINTER IN AN EDITOR, where `ERROR` means
 * "red squiggle, look at this". A write gate answers a different question — will this file
 * be broken if I write it? — and that is a strictly smaller set than `Severity.ERROR`.
 *
 * THE MEMBERSHIP RULE, for whoever adds the next check:
 *
 *   BLOCKING     Writing this file produces something broken. Any one of:
 *                  - it will not parse;
 *                  - it will raise at runtime;
 *                  - the deploy converter REJECTS it, which fails the whole changeset
 *                    rather than this one file.
 *
 *   EXCEPTION    Two members block without meeting that bar, because the file violates a
 *                contract its own author WROTE DOWN in this repository rather than a rule
 *                we inferred. Nothing joins them without making that argument explicitly.
 *
 *   NOT BLOCKING everything else — dead code, style, performance advice, hygiene,
 *                degraded-but-working output. Still REPORTED (severity is untouched).
 *
 * MEMBERSHIP IS ESTABLISHED BY MEASUREMENT, NOT BY READING THE CHECK'S NAME, and the
 * measurement runs through THIS SERVER rather than through `check()`. A member clears two
 * independent bars: the diagnostic means the file is broken (measured against a live
 * instance), and a buffer this server accepts can produce it at all. The "every blocking
 * check can actually block" group in `transport/validate-code.spec.ts` drives every member
 * end to end, so adding one here without a fixture there fails the suite.
 *
 * Severity is deliberately NOT changed: a non-member stays an `error` in `errors[]` and
 * keeps `status: 'error'`, it just no longer gates the write. Correctness lives in
 * check-common; the supervisor keeps ONLY agent ergonomics.
 */

/**
 * Check codes whose presence means the file is broken.
 *
 * Each entry states WHY it blocks, because "it felt severe" is how this list rots back into
 * a copy of the severity table.
 */
export const BLOCKING_CHECKS: ReadonlySet<string> = new Set([
  // Does not parse. Nothing downstream can be trusted about the file at all.
  'LiquidHTMLSyntaxError',

  // Unparseable YAML. Measured: `pos-cli deploy --dry-run` REJECTS the file ("Body
  // contains invalid YAML"), failing the WHOLE changeset. Scoped to SYNTAX on purpose —
  // the converter accepts unknown property types and duplicate property names, so
  // schema-shape validation would block nothing real.
  'YAMLSyntaxError',

  // Broken reference: the target does not exist, so the render fails at runtime.
  'MissingPartial',

  // platformOS raises on an unknown filter rather than ignoring it.
  'UnknownFilter',

  // A KNOWN filter applied with the wrong number of arguments: `Liquid::ArgumentError`,
  // page 500 — the same runtime failure class as `UnknownFilter`. A filter the docset
  // publishes no arity for produces nothing, so a vocabulary gap cannot refuse working
  // code; swept over 8 real projects / ~11k liquid files with 0 false positives.
  'FilterArity',

  // A single-quoted key or value inside a `{% assign %}` JSON literal. Measured:
  // `{% assign o = {'k': 'v'} %}` raises `Liquid syntax error: Invalid JSON in assign`,
  // and `pos-cli deploy --dry-run` REJECTS, failing every file in the changeset.
  'JsonLiteralQuoteStyle',

  // The query is invalid against the schema, or references a variable that does
  // not exist: it fails when executed.
  'GraphQLCheck',
  'GraphQLVariablesCheck',

  // Runtime error on execution, MEASURED: `hash_assign` against a number, string, boolean
  // or range each raises `HashAssignTagError` ("x is 5, expected Hash or Array"), while
  // the object case it permits renders HTTP 200. Filter return types come from the docset,
  // and an unknown one produces nothing, so a docset gap cannot refuse working code.
  'InvalidWriteTarget',

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
 * - `ValidJSON` and `JSONSyntaxError` — UNREACHABLE from here, which is a different reason
 *   from every other entry. Both declare `type: SourceCodeType.JSON`, check-common runs a
 *   check only against files of its own type, and this server admits only `.liquid`,
 *   `.graphql` and `.yml`/`.yaml`. A `.json` buffer is declined `unsupported_type` before
 *   any check runs. The checks themselves are fine and do fire for the CLI and language
 *   server; if this server ever admits `.json`, re-add both.
 * - `PartialCallArguments` reports TWO things under one code — an unknown (dead) argument
 *   and a missing required one — with no structured discriminator, and non-goal #2 forbids
 *   regex over messages. Safe to leave out wholesale because the check only looks at
 *   UNDOCUMENTED partials: a partial whose `{% doc %}` declares a contract is owned by
 *   `MissingRenderPartialArguments` (which DOES block). What is left rests on required
 *   params INFERRED from undefined variables, and the failure mode is a nil value.
 * - `UnrecognizedRenderPartialArguments` is the same dead-argument finding.
 * - `MissingAsset` — measured: `asset_url` is pure string construction, never resolves the
 *   asset and never raises; the page returns HTTP 200 and `--dry-run` accepts. It also
 *   misfires on assets that exist on the instance but not in the local tree.
 * - `ReservedVariableName` — measured: `{% assign blank = 'oops' %}` renders `[]` and the
 *   deployed page returns HTTP 200. Visibly wrong code, still a working page.
 * - `TranslationKeyExists` / `MatchingTranslations` — a missing key renders the key or an
 *   empty string. Visibly wrong, still a working page.
 * - `UnknownProperty` — resolves to nil; the page renders.
 * - `UniqueDocParamNames`, `ValidDocParamTypes` — doc hygiene with no runtime effect, since
 *   `{% doc %}` is inert at runtime.
 * - `ImgWidthAndHeight`, `ParserBlockingScript` — performance advice.
 * - `ValidFrontmatter` — two of its three findings (unknown key, missing layout) ARE hard
 *   deploy rejections, so this absence is a known gap rather than a judgement. All three
 *   share one code with no discriminator, so adding it would fix two false approvals and
 *   create one false block. Blocked on a discriminator — TASK-26.
 */

/** A diagnostic, narrowed to what the gate reads. */
interface GateInput {
  check: string;
  severity: string;
}

/**
 * Whether this set of diagnostics should stop the agent writing the file.
 *
 * An UNRECOGNIZED check code is treated as NON-blocking: check-common gains checks over
 * time, and a gate that blocked on codes it had never heard of would over-block every time
 * the engine grew. The supervisor never blocks on its own uncertainty.
 */
export function blocksWrite(diagnostics: readonly GateInput[]): boolean {
  return diagnostics.some(
    (diagnostic) => diagnostic.severity === 'error' && BLOCKING_CHECKS.has(diagnostic.check),
  );
}
