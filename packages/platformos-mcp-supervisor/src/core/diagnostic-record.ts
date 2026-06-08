/**
 * Diagnostic record helpers — message-template masking and per-check
 * parameter extraction.
 *
 * In pos-supervisor this module also produced the full `DiagnosticRecord`
 * shape with fingerprints (`fp`, `template_fp`) for the analytics layer.
 * v1 strips that — validate_code no longer emits to a session bus and the
 * downstream analytics pipeline is out of scope. What survives is the
 * pair of pure helpers consumed by:
 *
 *   - `error-enricher.ts` — calls both `extractParams` and `templateOf`
 *     for every diagnostic before running rules.
 *   - `fix-generator.ts` — calls `extractParams` to pull values out of
 *     LSP messages when building text edits.
 *
 * Stability note: every regex literal below MUST match the source
 * byte-for-byte. They are pinned by the upstream LSP-message-format
 * contract test (`tests/upstream/lsp-diagnostic-contract.test.js`) — drift
 * here silently breaks every rule that reads `diag.params.X`.
 */

export type ExtractedParams = Record<string, string>;

// ── Message template (identifier mask) ─────────────────────────────────────
//
// Two diagnostics with the same SHAPE but different identifiers (file
// names, variable names, translation keys) collapse to the same template
// string. The mask is intentionally minimal — we replace only the things
// that vary across instances of the same check.
//
// Substitutions, in order:
//   1. Quoted identifiers (`x`, 'x', "x")              → <id>
//   2. Bare ASCII numbers (12, 1.5, 0xff)              → <n>
//   3. Run-of-whitespace                               → single space
//   4. Trim leading/trailing whitespace.
//
// Case is preserved — it can be load-bearing in some checks.
function messageTemplate(message: string): string {
  if (typeof message !== 'string' || message === '') return '';
  let out = message;
  // Quoted strings (backtick, single, double). Stops at the next matching
  // quote without crossing newlines so multi-message blobs survive.
  out = out.replace(/`([^`\n]*)`/g, '<id>');
  out = out.replace(/'([^'\n]*)'/g, '<id>');
  out = out.replace(/"([^"\n]*)"/g, '<id>');
  // Bare numbers (decimal, hex, float). Word-boundary anchored so we don't
  // chew "v1" → "v<n>" or "html5" → "html<n>".
  out = out.replace(/\b\d+(?:\.\d+)?\b/g, '<n>');
  out = out.replace(/\b0x[0-9a-fA-F]+\b/g, '<n>');
  out = out.replace(/\s+/g, ' ').trim();
  return out;
}

// Per-check template override hook. Today the generic mask is sufficient
// for every check we ship. Wire a custom mask here if a check ever needs
// one (e.g. the LSP starts emitting timestamps inside a message).
const TEMPLATE_OVERRIDES: Readonly<Record<string, (template: string) => string>> = Object.freeze(
  {},
);

/**
 * Mask `message` into a stable template string. Two messages from the
 * same check that differ only in identifiers / numbers collapse to the
 * same template. The `check` argument is consulted for per-check overrides;
 * with no overrides registered it is reserved for future use.
 */
export function templateOf(check: string, message: string): string {
  const override = TEMPLATE_OVERRIDES[check];
  return override ? override(messageTemplate(message)) : messageTemplate(message);
}

// ── Param extraction (typed, per check) ────────────────────────────────────

const QUOTED = /[`'"]([^`'"]+)[`'"]/;

function firstQuoted(message: string): string | null {
  const m = message.match(QUOTED);
  return m ? m[1] : null;
}

function pairQuoted(message: string): [string, string] | null {
  // Two distinct quoted spans, in order of appearance.
  const bt = message.match(/`([^`]+)`[^`]*`([^`]+)`/);
  const dq = message.match(/"([^"]+)"[^"]*"([^"]+)"/);
  const sq = message.match(/'([^']+)'[^']*'([^']+)'/);
  const m = bt ?? dq ?? sq;
  return m ? [m[1], m[2]] : null;
}

type Extractor = (message: string) => ExtractedParams;

const EXTRACTORS = Object.freeze({
  UnknownFilter(message: string): ExtractedParams {
    const filter = firstQuoted(message);
    return filter ? { filter } : {};
  },

  UndefinedObject(message: string): ExtractedParams {
    // LSP message: "The object 'foo' is undefined". Earlier the codebase
    // used a dedicated extractVarName regex; we keep the same first-quoted
    // contract so existing tests pass without touching the enricher yet.
    const variable = firstQuoted(message);
    return variable ? { variable } : {};
  },

  UnusedAssign(message: string): ExtractedParams {
    const variable = firstQuoted(message);
    return variable ? { variable } : {};
  },

  MissingPartial(message: string): ExtractedParams {
    const partial = firstQuoted(message);
    return partial ? { partial } : {};
  },

  TranslationKeyExists(message: string): ExtractedParams {
    const key = firstQuoted(message);
    if (!key) return {};
    const params: ExtractedParams = { key };
    if (/did you mean/i.test(message)) params.has_typo_suggestion = 'true';
    return params;
  },

  UnknownProperty(message: string): ExtractedParams {
    const pair = pairQuoted(message);
    if (!pair) return {};
    return { property: pair[0], object: pair[1] };
  },

  DeprecatedTag(message: string): ExtractedParams {
    // Tag is the first identifier; replacement (when present) follows
    // "replaced by" or "use".
    const tagMatch =
      message.match(/[`'"](\w+)[`'"]/) ?? message.match(/\btag\s+[`'"]?(\w+)[`'"]?/i);
    const tag = tagMatch ? tagMatch[1] : null;
    const replMatch =
      message.match(/replaced\s+by\s+\[?[`'"](\w+)[`'"]\]?/i) ??
      message.match(/\buse\s+[`'"](\w+)[`'"]/i);
    const replacement = replMatch ? replMatch[1] : tag === 'include' ? 'render' : null;
    const params: ExtractedParams = {};
    if (tag) params.tag = tag;
    if (replacement) params.replacement = replacement;
    return params;
  },

  MissingRenderPartialArguments(message: string): ExtractedParams {
    const partialMatch = message.match(/[`'"]([^`'"]+\/[^`'"]+)[`'"]/);
    const paramMatch = message.match(/\bargument\s+['"`](\w+)['"`]/i);
    const params: ExtractedParams = {};
    if (partialMatch) params.partial = partialMatch[1];
    if (paramMatch) params.missing_param = paramMatch[1];
    return params;
  },

  MetadataParamsCheck(message: string): ExtractedParams {
    return { is_function_call: /function call/i.test(message) ? 'true' : 'false' };
  },

  PartialCallArguments(message: string): ExtractedParams {
    // Two distinct LSP message shapes:
    //   "Required parameter <X> must be passed to (render|function|GraphQL) call"
    //   "Unknown parameter <X> passed to (render|function|GraphQL) call"
    const requiredMatch = message.match(
      /^Required parameter\s+([A-Za-z_][\w]*)\s+must be passed to (\w+)\s+call/i,
    );
    const unknownMatch = message.match(
      /^Unknown parameter\s+([A-Za-z_][\w]*)\s+passed to (\w+)\s+call/i,
    );
    const m = requiredMatch ?? unknownMatch;
    if (!m) return {};
    const callKind = m[2].toLowerCase();
    return {
      param_name: m[1],
      direction: requiredMatch ? 'required' : 'unknown',
      call_kind: callKind, // 'render' | 'function' | 'graphql'
      is_function_call: callKind === 'function' ? 'true' : 'false',
    };
  },

  GraphQLVariablesCheck(message: string): ExtractedParams {
    // LSP shape mirrors PartialCallArguments but always carries the
    // GraphQL call kind.
    const requiredMatch = message.match(
      /^Required parameter\s+([A-Za-z_][\w]*)\s+must be passed to GraphQL call/i,
    );
    const unknownMatch = message.match(
      /^Unknown parameter\s+([A-Za-z_][\w]*)\s+passed to GraphQL call/i,
    );
    const m = requiredMatch ?? unknownMatch;
    if (!m) return {};
    return {
      param_name: m[1],
      direction: requiredMatch ? 'required' : 'unknown',
      call_kind: 'graphql',
    };
  },

  UnusedDocParam(message: string): ExtractedParams {
    // LSP shape: "The parameter 'name' is defined but not used in this file."
    const m = message.match(
      /^The parameter\s+['"`]([A-Za-z_][\w]*)['"`]\s+is defined but not used/i,
    );
    return m ? { param_name: m[1] } : {};
  },

  ValidFrontmatter(message: string): ExtractedParams {
    // pos-cli 6.0.7 ships a single check that emits eight distinct shapes.
    // We classify into a `category` so the rule engine can route to a
    // category-specific hint without re-parsing the message itself.
    if (/'home\.html\.liquid' is deprecated/i.test(message)) {
      return { category: 'home_deprecated' };
    }
    let m = message.match(/^Missing required frontmatter field [`'"]([^`'"]+)[`'"] in (.+?) file$/);
    if (m) return { category: 'missing_required', field: m[1], file_type: m[2] };
    m = message.match(/^Unknown frontmatter field [`'"]([^`'"]+)[`'"] in (.+?) file$/);
    if (m) return { category: 'unknown_field', field: m[1], file_type: m[2] };
    if (/^`layout: false`/.test(message)) return { category: 'layout_false' };
    m = message.match(/^Layout [`'"]([^`'"]+)[`'"] does not exist$/);
    if (m) return { category: 'layout_missing', layout: m[1] };
    m = message.match(
      /^Invalid value [`'"]([^`'"]+)[`'"] for [`'"]([^`'"]+)[`'"]\. Must be one of: (.+)$/,
    );
    if (m) return { category: 'invalid_enum', value: m[1], field: m[2], allowed: m[3] };
    m = message.match(/^[`'"]([^`'"]+)[`'"] is deprecated/);
    if (m) return { category: 'deprecated_field', field: m[1] };
    if (/deprecated/i.test(message)) {
      // Custom deprecation messages from per-field schemas — extract the
      // first quoted token as a best-effort field hint.
      const f = firstQuoted(message);
      return f ? { category: 'deprecated_field', field: f } : { category: 'deprecated_field' };
    }
    m = message.match(/^(.+?) [`'"]([^`'"]+)[`'"] does not exist$/);
    if (m) return { category: 'association_missing', label: m[1], name: m[2] };
    return { category: 'unknown' };
  },

  JsonLiteralQuoteStyle(): ExtractedParams {
    // Single-shot message — no params extracted. Returning {} keeps the
    // bag JSON-safe and lets the rule engine fire on `check` alone.
    return {};
  },

  DuplicateFunctionArguments(message: string): ExtractedParams {
    // "Duplicate argument 'x' in render tag for partial 'p'."
    // "Duplicate argument 'x' in function tag for partial 'p'."
    const m = message.match(
      /^Duplicate argument [`'"]([^`'"]+)[`'"] in (\w+) tag for partial [`'"]([^`'"]+)[`'"]\.?$/,
    );
    if (m) return { argument: m[1], tag_kind: m[2], partial: m[3] };
    return {};
  },

  GraphQLCheck(message: string): ExtractedParams {
    const unused = message.match(/Variable\s+["']?\$(\w+)["']?\s+is never used/i);
    if (unused) return { category: 'unused_variable', variable: unused[1] };

    const fieldMatch = message.match(
      /Cannot query field\s+["']?(\w+)["']?\s+on type\s+["']?(\w+)["']?/i,
    );
    if (fieldMatch) {
      return {
        category: fieldMatch[2] === 'Record' ? 'unknown_field_record' : 'unknown_field_other',
        field: fieldMatch[1],
        type: fieldMatch[2],
      };
    }

    const typeMismatch = message.match(
      /Variable\s+["']?\$(\w+)["']?\s+of type\s+["']?([^"']+)["']?\s+used in position expecting(?: type)?\s+["']?([^"'.]+)["']?/i,
    );
    if (typeMismatch) {
      const expected = typeMismatch[3].trim();
      return {
        category: /filter/i.test(expected) ? 'type_mismatch_filter' : 'type_mismatch_other',
        variable: typeMismatch[1],
        actual_type: typeMismatch[2],
        expected_type: expected,
      };
    }

    const filterMatch = message.match(
      /Expected value of type\s+["']?(\w+)["']?,?\s+found\s+["']?([^"'.]+)["']?/i,
    );
    if (filterMatch) {
      return {
        category: /filter/i.test(filterMatch[1]) ? 'type_mismatch_filter' : 'type_mismatch_other',
        actual_type: `"${filterMatch[2].trim()}"`,
        expected_type: filterMatch[1],
      };
    }

    return { category: 'generic' };
  },
});

/**
 * Pull check-specific parameters out of a diagnostic message. Returns an
 * empty object when the check is unknown or the message doesn't match the
 * check's expected shape.
 *
 * Values are coerced to strings so the result is JSON-safe and downstream
 * consumers (enricher, fix-generator) can read them without type guards.
 */
export function extractParams(check: string, message: string): ExtractedParams {
  const fn = (EXTRACTORS as Readonly<Record<string, Extractor>>)[check];
  if (!fn) return {};
  try {
    const out = fn(message ?? '');
    const safe: ExtractedParams = {};
    for (const [k, v] of Object.entries(out)) {
      if (v == null) continue;
      safe[k] = typeof v === 'string' ? v : String(v);
    }
    return safe;
  } catch {
    return {};
  }
}
