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
 * AND MEASURE THE CHECK THROUGH THIS SERVER, not through `check()`. A member has to
 * clear two independent bars, and only the first is about the check:
 *
 *   1. the diagnostic means the file is broken  — measured against a live instance;
 *   2. a buffer THIS SERVER accepts can produce it at all.
 *
 * Two more of the original twelve failed the SECOND bar while passing the first
 * (`ValidJSON`, `JSONSyntaxError` — see the exclusions below). That failure is
 * invisible from inside check-common, where both work perfectly, and invisible on
 * the wire, where a dead member and a clean file are byte-identical. Every member is
 * therefore driven end to end by `blocking-emission.spec.ts`; adding one here
 * without a fixture there fails the suite, which is the point.
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

  // Unparseable YAML. Measured, and it clears the highest bar in the rule above:
  // `pos-cli deploy --dry-run` REJECTS the file ("Body contains invalid YAML"),
  // which fails the WHOLE changeset rather than this one file. Until this check
  // existed, all four admitted YAML types — model/custom model types, transactable
  // types, instance profile types and translations — returned a clean `ok` for
  // genuinely invalid YAML, so an agent was told to proceed and took every other
  // file in the deploy down with it.
  //
  // Scoped to SYNTAX on purpose. The converter accepts unknown property types and
  // duplicate property names, so schema-shape validation would block nothing real;
  // this blocks only files that do not parse.
  'YAMLSyntaxError',

  // Broken reference: the target does not exist, so the render fails at runtime.
  'MissingPartial',

  // platformOS raises on an unknown filter rather than ignoring it.
  'UnknownFilter',

  // A KNOWN filter applied with the wrong number of arguments. Same runtime failure
  // class as `UnknownFilter` above — `Liquid::ArgumentError`, page 500 — and the
  // asymmetry of blocking one but not the other is what the evaluation flagged.
  //
  // Admitted on measurement, not on the argument above: the arity data is generated
  // from the runtime's own complaints (`scripts/verify-filter-arity.mjs`), and the
  // check was swept over 8 real projects / ~11k liquid files, producing 2 offenses,
  // BOTH verified true positives (one being `null | hash_merge`, which raises
  // "given 1, expected 2"), and 0 false positives. A filter with no measured arity
  // produces nothing, so the vocabulary gaps that made `UnknownFilter` expensive
  // cannot make this one refuse working code.
  'FilterArity',

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

  // Runtime error on execution — MEASURED, unlike the `ReservedVariableName` that
  // used to share this justification. `hash_assign` against a number, string,
  // boolean or range each raises `HashAssignTagError` ("x is 5, expected Hash or
  // Array"), while the object case it permits renders HTTP 200. So the check models
  // a genuine runtime failure and belongs here.
  //
  // It does over-report in one narrow case: it does not model filter RETURN types,
  // so `{% assign a = '' | split: ',' %}{% hash_assign a[0] = 'v' %}` is typed as a
  // string and reported, although the runtime accepts an Array with a numeric index.
  // That is a precision bug in the check rather than a reason to stop blocking on it
  // — the alternative is approving the number/string/boolean cases that do raise.
  // Tracked separately; see TASK-27.
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
 * - `ValidJSON` and `JSONSyntaxError` — REMOVED because they are UNREACHABLE, which
 *   is a different reason from every other entry here and the only one that is a
 *   defect in this file rather than a judgement. Both declare
 *   `type: SourceCodeType.JSON`, and check-common runs a check only against files of
 *   its own type. This server admits only what `isSupportedSourceFile` accepts —
 *   `.liquid`, `.graphql`, `.yml`/`.yaml` — and those parse as `LiquidHtml`,
 *   `GraphQL` and `YAML`. No buffer that reaches the gate has ever been parsed as
 *   JSON, so neither code could ever appear in a diagnostic and both were promising
 *   coverage the input filter forecloses. A `.json` buffer is declined
 *   `unsupported_type` before any check runs, which is honest — an entry here
 *   claiming to catch it was not.
 *
 *   Note what this is NOT: the checks work. They fire correctly under `check()` and
 *   for the CLI and language server, which do lint standalone JSON. Nothing about
 *   them changed and nothing needs fixing in check-common. If this server ever
 *   admits `.json`, re-add both — `blocking-emission.spec.ts` will demand a fixture,
 *   and it holds the proof of why one could not be written before.
 *
 *   AND THEY WERE NOT WRONG WHEN WRITTEN, which is the part worth remembering.
 *   `toSourceCode` types any unrecognized extension as JSON, so before the
 *   applicability gate existed EVERY path was JSON-linted — `/etc/passwd` came back
 *   `ValidJSON: Expected a JSON object, array or literal` with
 *   `must_fix_before_write: true` (see `adapter-input.ts`). These two entries were
 *   load-bearing then. The gate that fixed that made them unreachable, and nothing
 *   connected the two edits. A member can be orphaned by a correct change somewhere
 *   else, silently, which is the general lesson and the reason the emission suite
 *   runs the whole pipeline rather than the checks.
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
