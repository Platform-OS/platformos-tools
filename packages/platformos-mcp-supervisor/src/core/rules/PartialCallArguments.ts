/**
 * PartialCallArguments rules — `{% render '...', X: Y %}` or
 * `{% function r = '...', X: Y %}` passed (or omitted) a parameter that
 * doesn't match the target's `{% doc %}` declarations.
 *
 * Pre-rule the check landed as `.unmatched` even though it's the highest-
 * volume bucket-B emission (28 emits in DEMO, 78 % resolution / 22 %
 * regression). The LSP message names the param + call kind but NOT the
 * target path — the sibling diagnostic `MissingRenderPartialArguments` /
 * `UnrecognizedRenderPartialArguments` (both already rule-attributed)
 * carries the path when it co-fires. The rule's hint cross-references
 * those siblings so the agent sees concrete context, plus structured
 * required/unknown branches with copy-pasteable examples.
 *
 * Subrule analytics IDs:
 *   • PartialCallArguments.required_render   — "Required parameter X must
 *     be passed to render call"
 *   • PartialCallArguments.required_function — "... function call"
 *   • PartialCallArguments.unknown_render    — "Unknown parameter X passed
 *     to render call"
 *   • PartialCallArguments.unknown_function  — "... function call"
 *   • PartialCallArguments.default           — extractor failed; bare hint.
 *
 * Fix policy: guidance-only. The deterministic edit (add or drop a named
 * argument) needs the target path AND the call's argument list, neither
 * of which the rule layer has. Hint walks the agent through the canonical
 * resolution and points at the sibling diagnostic for the path.
 */
import type { Rule, RuleDiagnostic, RuleResult } from './engine';

const TAG_FOR_KIND: Record<string, string> = {
  render: 'render',
  function: 'function',
};

type CallKind = 'render' | 'function';

export const rules: Rule[] = [
  {
    id: 'PartialCallArguments.required_render',
    check: 'PartialCallArguments',
    priority: 5,
    when: (diag) => diag.params?.direction === 'required' && diag.params?.call_kind === 'render',
    apply: (diag) => buildRequiredHint(diag, 'render'),
  },
  {
    id: 'PartialCallArguments.required_function',
    check: 'PartialCallArguments',
    priority: 6,
    when: (diag) => diag.params?.direction === 'required' && diag.params?.call_kind === 'function',
    apply: (diag) => buildRequiredHint(diag, 'function'),
  },
  {
    id: 'PartialCallArguments.unknown_render',
    check: 'PartialCallArguments',
    priority: 7,
    when: (diag) => diag.params?.direction === 'unknown' && diag.params?.call_kind === 'render',
    apply: (diag) => buildUnknownHint(diag, 'render'),
  },
  {
    id: 'PartialCallArguments.unknown_function',
    check: 'PartialCallArguments',
    priority: 8,
    when: (diag) => diag.params?.direction === 'unknown' && diag.params?.call_kind === 'function',
    apply: (diag) => buildUnknownHint(diag, 'function'),
  },
  {
    id: 'PartialCallArguments.default',
    check: 'PartialCallArguments',
    priority: 100,
    when: () => true,
    apply: () => ({
      rule_id: 'PartialCallArguments.default',
      hint_md:
        `Tag-call parameter mismatch. Read the upstream message — it names the parameter and call kind. ` +
        `Required → add the named argument to the call; Unknown → drop it (or declare it as \`@param\` ` +
        `in the target's \`{% doc %}\` block). The sibling diagnostic on the same line ` +
        `(\`MissingRenderPartialArguments\` / \`UnrecognizedRenderPartialArguments\`) carries the partial ` +
        `or function path when it co-fires — use that to locate the contract.`,
      fixes: [
        {
          type: 'guidance',
          description:
            `Open the target's \`{% doc %}\` block to confirm the contract, then either add the missing ` +
            `argument to the call or drop the unrecognized one.`,
        },
      ],
      confidence: 0.5,
    }),
  },
];

function buildRequiredHint(diag: RuleDiagnostic, kind: CallKind): RuleResult {
  const tag = TAG_FOR_KIND[kind];
  const param = diag.params?.param_name ?? '<param>';
  const id =
    kind === 'render'
      ? 'PartialCallArguments.required_render'
      : 'PartialCallArguments.required_function';
  // The most common idiomatic resolution is to forward the param under
  // the same name (`X: X`) since the caller usually has the value in
  // scope already (either as its own @param, an `assign` result, or the
  // page's frontmatter slug). The hint surfaces both the
  // forward-as-named pattern and the explicit-value pattern.
  return {
    rule_id: id,
    hint_md:
      `\`${tag}\` call is missing the required parameter \`${param}\`. The target's \`{% doc %}\` block ` +
      `declares \`@param ${param}\` (without a leading \`[\` for optional). Add the argument to the tag — ` +
      `the value can be a literal, a variable already in scope, or a forwarded \`@param\` of the caller.\n\n` +
      (kind === 'render'
        ? `Examples:\n` +
          '```liquid\n' +
          `{% render 'partial/name', ${param}: ${param} %}        # forward caller's own @param\n` +
          `{% render 'partial/name', ${param}: \"value\" %}         # literal\n` +
          `{% render 'partial/name', ${param}: result.records %}    # graphql result\n` +
          '```\n'
        : `Examples:\n` +
          '```liquid\n' +
          `{% function r = 'lib/path', ${param}: ${param} %}       # forward caller's own @param\n` +
          `{% function r = 'lib/path', ${param}: \"value\" %}        # literal\n` +
          '```\n') +
      `When the sibling \`MissingRenderPartialArguments\` (or \`UnrecognizedRenderPartialArguments\`) fires ` +
      `on the same line, its message names the partial / function path and may carry a richer \`@param\` ` +
      `signature — prefer its hint when present.`,
    fixes: [
      {
        type: 'guidance',
        description:
          `Add \`${param}: <value>\` to the \`{% ${tag} ... %}\` tag. Use \`${param}: ${param}\` when the ` +
          `caller already has \`${param}\` in scope (most common); otherwise pass a literal or a derived ` +
          `value. The companion \`Missing*Arguments\` diagnostic on this line carries the target path and ` +
          `the canonical signature.`,
      },
    ],
    confidence: 0.7,
    see_also: {
      tool: 'domain_guide',
      args: { domain: kind === 'render' ? 'partials' : 'commands', section: 'api' },
      reason:
        kind === 'render'
          ? 'Render call param mismatch. domain_guide(partials, api) covers @param semantics and forwarding patterns.'
          : 'Function call param mismatch. domain_guide(commands, api) covers @param semantics, build/check/execute phases, and forwarding.',
    },
  };
}

function buildUnknownHint(diag: RuleDiagnostic, kind: CallKind): RuleResult {
  const tag = TAG_FOR_KIND[kind];
  const param = diag.params?.param_name ?? '<param>';
  const id =
    kind === 'render'
      ? 'PartialCallArguments.unknown_render'
      : 'PartialCallArguments.unknown_function';
  return {
    rule_id: id,
    hint_md:
      `\`${tag}\` call passes \`${param}\` but the target's \`{% doc %}\` block does NOT declare ` +
      `\`@param ${param}\` — \`@param\` is the contract and undeclared arguments are silently dropped at ` +
      `call time, so this is dead data.\n\n` +
      `Pick one fix:\n` +
      `  A) **Drop** \`${param}: ...\` from the \`{% ${tag} %}\` tag in this file. Right when the target ` +
      `intentionally doesn't read it.\n` +
      `  B) **Declare** \`@param ${param} {<type>}\` in the target's \`{% doc %}\` block. Right when the ` +
      `target *should* consume the value.\n` +
      `  C) **Rename** \`${param}\` to match an existing \`@param\` of the target. Right when the name ` +
      `was a typo.\n\n` +
      `When the sibling \`UnrecognizedRenderPartialArguments\` fires on the same line, its message names ` +
      `the partial or function path — use it to locate the \`{% doc %}\` block.`,
    fixes: [
      {
        type: 'guidance',
        description:
          `Pick: (A) drop \`${param}: <value>\` from the \`{% ${tag} %}\` tag, (B) declare ` +
          `\`@param ${param} {<type>}\` in the target's \`{% doc %}\` block, or (C) rename \`${param}\` ` +
          `to a declared param. Module-owned targets (slugs starting with \`modules/\`) reject option B — ` +
          `the file is read-only.`,
      },
    ],
    confidence: 0.7,
    see_also: {
      tool: 'domain_guide',
      args: { domain: kind === 'render' ? 'partials' : 'commands', section: 'api' },
      reason:
        kind === 'render'
          ? 'Render call passes an undeclared arg. domain_guide(partials, api) explains @param contracts.'
          : 'Function call passes an undeclared arg. domain_guide(commands, api) explains @param contracts.',
    },
  };
}
