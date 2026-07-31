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
 *   BLOCKING     the file will not parse, will not render, or will raise at
 *                runtime. Writing it produces something broken.
 *   NOT BLOCKING everything else — dead code, style, performance advice,
 *                hygiene, degraded-but-working output. Still REPORTED (severity
 *                is untouched); the agent decides.
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
  'MissingAsset',

  // platformOS raises on an unknown filter rather than ignoring it.
  'UnknownFilter',

  // A layout that never outputs `content_for_layout` renders an EMPTY page body.
  // The page "works" and shows nothing, which is worse than an error.
  'MissingContentForLayout',

  // A required `@param` the partial's own doc block DECLARES was not passed. This
  // is an explicit contract the author wrote down, not an inference.
  'MissingRenderPartialArguments',

  // The query is invalid against the schema, or references a variable that does
  // not exist: it fails when executed.
  'GraphQLCheck',
  'GraphQLVariablesCheck',

  // Runtime errors on execution.
  'InvalidHashAssignTarget',
  'ReservedVariableName',
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
 * - `TranslationKeyExists` / `MatchingTranslations` — a missing key renders the key
 *   or an empty string. Visibly wrong, still a working page.
 * - `UnknownProperty` — resolves to nil; the page renders.
 * - `UniqueDocParamNames`, `ValidDocParamTypes`, `JsonLiteralQuoteStyle` — doc and
 *   style hygiene with no runtime effect.
 * - `ImgWidthAndHeight`, `ParserBlockingScript` — performance advice.
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
