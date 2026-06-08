/**
 * MissingRenderPartialArguments rules — rich cross-file hints for missing params.
 *
 * Priority order:
 *   10 — doc_block_mismatch: reads target partial's params, shows full expected signature
 *   20 — chain_satisfied: param available in caller's own scope (received from grandparent)
 *   30 — optional_param: param has a default → downgrade to info-level confidence
 *   100 — generic: standard hint
 */
import type { Rule } from './engine';
import { getPartialParams, isParamAvailableInCallerScope } from '../render-flow';

export const rules: Rule[] = [
  {
    id: 'MissingRenderPartialArguments.doc_block_mismatch',
    check: 'MissingRenderPartialArguments',
    priority: 10,
    when: (diag, facts) => {
      const partialName = diag.params?.partial;
      if (!partialName || !facts.graph) return false;
      const params = getPartialParams(facts.graph, partialName);
      return params.length > 0;
    },
    apply: (diag, facts) => {
      const params = diag.params!;
      const partialName = params.partial;
      const missingParam = params.missing_param ?? 'unknown';
      const declared = getPartialParams(facts.graph!, partialName);
      const signature = declared.map((p) => `${p}: ${p}`).join(', ');

      return {
        rule_id: 'MissingRenderPartialArguments.doc_block_mismatch',
        hint_md: `Required param \`${missingParam}\` is not passed to \`${partialName}\`.\n\nFull signature: \`{% render '${partialName}', ${signature} %}\`\n\nDeclared params: ${declared.map((p) => `\`${p}\``).join(', ')}. Add the missing argument to the render/function call.`,
        suggestion: `Add \`, ${missingParam}: ${missingParam}\` to the render call.`,
        fixes: [],
        confidence: 0.9,
        see_also: {
          tool: 'domain_guide',
          args: { domain: 'partials', section: 'api' },
          reason: `Render call missing required param. domain_guide(partials, api) explains {% doc %} @param declarations.`,
        },
      };
    },
  },

  {
    id: 'MissingRenderPartialArguments.chain_satisfied',
    check: 'MissingRenderPartialArguments',
    priority: 20,
    when: (diag, facts) => {
      const missingParam = diag.params?.missing_param;
      if (!missingParam || !diag.file || !facts.graph) return false;
      return isParamAvailableInCallerScope(facts.graph, diag.file, missingParam);
    },
    apply: (diag) => {
      const params = diag.params!;
      const partialName = params.partial ?? 'unknown';
      const missingParam = params.missing_param;

      return {
        rule_id: 'MissingRenderPartialArguments.chain_satisfied',
        hint_md: `Param \`${missingParam}\` is not passed to \`${partialName}\`, but this file declares \`${missingParam}\` as its own param (received from a caller). Add \`${missingParam}: ${missingParam}\` to forward it.`,
        suggestion: `Forward the param: add \`, ${missingParam}: ${missingParam}\` to the render call.`,
        fixes: [],
        confidence: 0.85,
      };
    },
  },

  {
    id: 'MissingRenderPartialArguments.generic',
    check: 'MissingRenderPartialArguments',
    priority: 100,
    when: () => true,
    apply: (diag) => {
      const partialName = diag.params?.partial ?? 'unknown';
      const missingParam = diag.params?.missing_param ?? 'unknown';

      return {
        rule_id: 'MissingRenderPartialArguments.generic',
        hint_md: `Required param \`${missingParam}\` is not passed to \`${partialName}\`. Open the partial's \`{% doc %}\` block to see the full signature, then add the missing argument to the render/function call.`,
        fixes: [],
        confidence: 0.5,
      };
    },
  },
];
