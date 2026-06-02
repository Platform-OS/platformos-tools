/**
 * GraphQLVariablesCheck rules — `{% graphql result = 'op_name', $X: Y %}`
 * passed (or omitted) a variable that doesn't match the .graphql operation's
 * declared signature.
 *
 * Pre-rule the check landed as `.unmatched` (3 emits in DEMO, 100 %
 * resolution but 0 % adoption — the LSP message named the variable but
 * carried no actionable fix). The rule extracts variable + direction
 * (required vs unknown) from the message and, when the file has graphql
 * calls indexed by the project graph, surfaces the operation's full
 * variable signature so the agent can pick the right value type.
 *
 * Subrules:
 *   • GraphQLVariablesCheck.parser_blind_spot — call lives inside a
 *       `{% liquid %}` block with multi-line `,` continuation. Both
 *       liquid-html-parser and pos-cli's LSP truncate the call at the first
 *       newline-comma; LSP fires `.required` for every arg past it. The
 *       agent sees the args in source, our default `.required` hint says
 *       "add the arg" — agent enters a regression spiral. This sub-rule
 *       fires first when the project graph reports the file's graphql call
 *       with `source_kind === 'liquid_multiline_truncated'` and steers the
 *       agent at the syntactic root cause instead. (Reproduced in DEMO
 *       2026-04-27, 4 emits / 100 % regression.)
 *   • GraphQLVariablesCheck.required        — agent forgot a `$var` argument.
 *   • GraphQLVariablesCheck.unknown         — agent passed an undeclared `$var`.
 *   • GraphQLVariablesCheck.default         — extractor failed; bare hint.
 *
 * Fix policy: guidance-only; the deterministic edit needs the call's
 * argument list which the rule layer doesn't have.
 */

import type { Rule, RuleDiagnostic, RuleFacts } from './engine';

export const rules: Rule[] = [
  {
    id: 'GraphQLVariablesCheck.parser_blind_spot',
    check: 'GraphQLVariablesCheck',
    priority: 3,
    when: (diag: RuleDiagnostic, facts: RuleFacts) => isParserBlindSpot(diag, facts),
    apply: (diag: RuleDiagnostic, facts: RuleFacts) => buildParserBlindSpotHint(diag, facts),
  },
  {
    id: 'GraphQLVariablesCheck.required',
    check: 'GraphQLVariablesCheck',
    priority: 5,
    when: (diag: RuleDiagnostic) => diag.params?.direction === 'required',
    apply: (diag: RuleDiagnostic, facts: RuleFacts) => buildRequiredHint(diag, facts),
  },
  {
    id: 'GraphQLVariablesCheck.unknown',
    check: 'GraphQLVariablesCheck',
    priority: 6,
    when: (diag: RuleDiagnostic) => diag.params?.direction === 'unknown',
    apply: (diag: RuleDiagnostic, facts: RuleFacts) => buildUnknownHint(diag, facts),
  },
  {
    id: 'GraphQLVariablesCheck.default',
    check: 'GraphQLVariablesCheck',
    priority: 100,
    when: () => true,
    apply: (_diag: RuleDiagnostic) => ({
      rule_id: 'GraphQLVariablesCheck.default',
      hint_md:
        `\`{% graphql %}\` variable mismatch. Open the called .graphql operation under \`app/graphql/\` ` +
        `and read the operation header — variables declared as \`$name: Type\` (no leading \`$\` is wrong). ` +
        `Required → add the argument to the tag (\`{% graphql r = 'op', name: value %}\`); Unknown → drop it.`,
      fixes: [{
        type: 'guidance',
        description:
          `Open the .graphql file's operation header to see the full \`$variable: Type\` signature, then ` +
          `pass each required variable as a named argument on the \`{% graphql %}\` tag.`,
      }],
      confidence: 0.5,
    }),
  },
];

/**
 * True when the diagnostic looks like the multi-line truncation false-flag.
 *
 * Two paths, either of which is sufficient:
 *
 *   1. **Disk-indexed** — Project graph already has a graphql call from this
 *      file whose extracted `source_kind === 'liquid_multiline_truncated'`.
 *      Populated by `liquid-parser.classifyGraphqlSourceKind` during scan.
 *
 *   2. **In-memory** — `facts.content` (the live editor buffer) contains the
 *      truncation pattern. This path is essential for any file the agent has
 *      JUST written or is iterating on without a reindex pass: the disk graph
 *      lags behind the in-memory state, and the upstream LSP regression spiral
 *      starts immediately on the first emit. Without this path we measured
 *      4/4 regressions on `app/lib/commands/contacts/create.liquid` (DEMO,
 *      2026-04 → 2026-05) — the agent kept adding the missing variable that
 *      was already in source, every iteration tripping the same blind spot.
 *
 * The in-memory detector looks for the pattern:
 *
 *   {% liquid
 *     graphql result = 'some/op',                  # comma at EOL
 *       arg1: …                                    # truncated past here
 *   %}
 *
 * inside any `{% liquid %}` block in `content`. Falsy content / no liquid
 * blocks / non-comma graphql lines all fall through to the downstream
 * `.required` rule, so this predicate is purely additive.
 */
function isParserBlindSpot(diag: RuleDiagnostic, facts: RuleFacts): boolean {
  if (diag?.params?.direction !== 'required') return false;

  // Path 1: project graph carries the source-kind flag.
  const node = facts?.graph?.nodeByPath?.(diag?.file);
  const calls = node?.graphql_calls ?? [];
  if (calls.some((c) => c?.source_kind === 'liquid_multiline_truncated')) return true;

  // Path 2: in-memory content scan.
  if (typeof facts?.content === 'string' && contentHasTruncatedGraphqlCall(facts.content)) {
    return true;
  }
  return false;
}

/**
 * Detect the `{% liquid %}` multi-line graphql truncation by scanning the
 * source for any block-level `graphql ...,` line ending in a trailing comma.
 *
 * The LSP truncates at the first newline-after-comma inside `{% liquid %}`.
 * Outside `{% liquid %}` (i.e. tag-form `{% graphql ... %}`) commas don't
 * truncate, so we must scope the scan to inside-block. The regex is
 * deliberately tolerant: extra whitespace, the `if`/`assign`/etc. statements
 * around the call, and chained continuations all still match because we
 * look at one line at a time inside any `{% liquid %} ... %}` slice.
 */
function contentHasTruncatedGraphqlCall(content: string): boolean {
  // Iterate every {% liquid ... %} block. The `[\s\S]` form catches newlines
  // because the `s` flag is unsupported in some bundlers we still target.
  const blockRe = /\{%-?\s*liquid\b([\s\S]*?)-?%\}/g;
  let m;
  while ((m = blockRe.exec(content)) !== null) {
    const body = m[1];
    // Inside the body, any line that starts with `graphql` (after optional
    // indent) AND ends with a `,` — possibly with trailing whitespace before
    // the EOL — is the truncation pattern. We match per-line via /m so the
    // `^` and `$` anchors operate on logical lines.
    if (/^\s*graphql\b[^\n]*,\s*$/m.test(body)) return true;
  }
  return false;
}

function buildParserBlindSpotHint(diag: RuleDiagnostic, facts: RuleFacts) {
  const param = diag?.params?.param_name ?? '<var>';
  const sigBlock = signatureBlock(diag, facts);
  return {
    rule_id: 'GraphQLVariablesCheck.parser_blind_spot',
    hint_md:
      `\`{% graphql %}\` call appears to pass \`${param}\`, but the parser cannot see it. ` +
      `The call lives inside a \`{% liquid %}\` block written with multi-line \`,\` ` +
      `continuation — both pos-cli's check and the AST parser stop at the first newline-comma, ` +
      `so every named argument past it is silently dropped.\n\n` +
      `Do NOT keep adding the argument — it is already there in source. **Fix the syntax**:\n\n` +
      '```liquid\n' +
      `{% graphql result = '<op_name>', ${param}: ${param}, ... %}    # tag form, args on one line\n` +
      '```\n' +
      `or, if you must keep it inside \`{% liquid %}\`, put every named arg on the SAME line as ` +
      `\`graphql\`:\n\n` +
      '```liquid\n' +
      `{% liquid\n` +
      `  graphql result = '<op_name>', ${param}: ${param}, email: email, ...\n` +
      `%}\n` +
      '```' +
      sigBlock,
    fixes: [{
      type: 'guidance',
      description:
        `Convert the multi-line \`graphql\` call to a single-line form. Either move it out of ` +
        `\`{% liquid %}\` into \`{% graphql ... %}\` tag delimiters, or keep it inside the block ` +
        `but place every \`name: value\` argument on the same line as \`graphql\`. The arguments ` +
        `you wrote are correct — only the line breaks are dropping them.${diagFiles(diag, facts)}`,
    }],
    confidence: 0.95,
    see_also: {
      tool: 'domain_guide',
      args: { domain: 'graphql' },
      reason: 'Multi-line `{% graphql %}` continuation inside `{% liquid %}` is silently truncated. domain_guide(graphql) shows the canonical tag form.',
    },
  };
}

function buildRequiredHint(diag: RuleDiagnostic, facts: RuleFacts) {
  const param = diag.params?.param_name ?? '<var>';
  const sigBlock = signatureBlock(diag, facts);
  return {
    rule_id: 'GraphQLVariablesCheck.required',
    hint_md:
      `\`{% graphql %}\` call is missing required variable \`${param}\`. The operation declares ` +
      `\`$${param}: <Type>\` in its header — every non-optional variable (no \`= default\`) MUST be passed ` +
      `at the call site.\n\n` +
      `Add to the tag:\n` +
      '```liquid\n' +
      `{% graphql result = '<op_name>', ${param}: ${param} %}    # forward caller scope\n` +
      `{% graphql result = '<op_name>', ${param}: \"value\" %}    # literal\n` +
      `{% graphql result = '<op_name>', ${param}: context.params.${param} %}  # request param\n` +
      '```' +
      sigBlock,
    fixes: [{
      type: 'guidance',
      description:
        `Add \`${param}: <value>\` to the \`{% graphql %}\` tag. The value must match the declared ` +
        `GraphQL type — pass a string for \`String!\`, an integer for \`Int!\`, an object literal for ` +
        `input types, etc.${diagFiles(diag, facts)}`,
    }],
    confidence: 0.75,
    see_also: {
      tool: 'domain_guide',
      args: { domain: 'graphql' },
      reason: 'GraphQL call variable mismatch. domain_guide(graphql) covers $variable signatures and value forwarding.',
    },
  };
}

function buildUnknownHint(diag: RuleDiagnostic, facts: RuleFacts) {
  const param = diag.params?.param_name ?? '<var>';
  const sigBlock = signatureBlock(diag, facts);
  return {
    rule_id: 'GraphQLVariablesCheck.unknown',
    hint_md:
      `\`{% graphql %}\` call passes \`${param}\` but the operation does NOT declare \`$${param}\`. ` +
      `Undeclared variables are silently dropped at call time — this is dead data that may mask a typo.\n\n` +
      `Pick one fix:\n` +
      `  A) **Drop** \`${param}: ...\` from the \`{% graphql %}\` tag in this file.\n` +
      `  B) **Declare** \`$${param}: <Type>\` in the .graphql operation's variable list (and use it in ` +
      `the body — orphan declarations themselves trigger \`GraphQLCheck\`).\n` +
      `  C) **Rename** \`${param}\` to match an existing operation variable — common cause is a typo.` +
      sigBlock,
    fixes: [{
      type: 'guidance',
      description:
        `Pick: (A) drop \`${param}: <value>\` from the call, (B) add \`$${param}: <Type>\` to the .graphql ` +
        `operation header, or (C) rename \`${param}\` to a declared variable.${diagFiles(diag, facts)}`,
    }],
    confidence: 0.75,
    see_also: {
      tool: 'domain_guide',
      args: { domain: 'graphql' },
      reason: 'GraphQL call passes an undeclared variable. domain_guide(graphql) covers $variable signatures.',
    },
  };
}

interface Signature {
  queryName: string;
  args: ReadonlyArray<{ name: string; type: string }>;
}

/**
 * Build a markdown block listing the declared variables of every graphql
 * operation called from `diag.file`. Empty string when the file is not
 * indexed or has no graphql_calls.
 *
 * Uses the graph's `graphql_calls` (which carries `{ variable, queryName }`
 * per call) and the per-operation node's `args` list (parsed from the
 * `.graphql` file's `query Foo($x: String!) { ... }` header).
 */
function signatureBlock(diag: RuleDiagnostic, facts: RuleFacts): string {
  const sigs = collectSignatures(diag, facts);
  if (sigs.length === 0) return '';
  const list = sigs.map((s) => {
    const args = s.args.length === 0
      ? '(no variables)'
      : s.args.map((a) => `\`$${a.name}: ${a.type}\``).join(', ');
    return `  • \`${s.queryName}\` — ${args}`;
  }).join('\n');
  return `\n\nGraphQL operation(s) called from this file:\n${list}`;
}

function diagFiles(diag: RuleDiagnostic, facts: RuleFacts): string {
  const sigs = collectSignatures(diag, facts);
  if (sigs.length !== 1) return '';
  return ` Reference: \`app/graphql/${sigs[0].queryName}.graphql\`.`;
}

function collectSignatures(diag: RuleDiagnostic, facts: RuleFacts): Signature[] {
  const graph = facts?.graph;
  const filePath = diag?.file;
  if (!graph || !filePath) return [];
  const node = graph.nodeByPath(filePath);
  if (!node) return [];
  const calls = node.graphql_calls ?? [];
  const out: Signature[] = [];
  const seen = new Set<string>();
  for (const call of calls) {
    const queryName = typeof call === 'string' ? call : call?.queryName;
    if (!queryName || seen.has(queryName)) continue;
    seen.add(queryName);
    const opNode = graph.nodeByKey('graphql', queryName);
    if (!opNode) continue;
    out.push({ queryName, args: opNode.args ?? [] });
  }
  return out;
}
