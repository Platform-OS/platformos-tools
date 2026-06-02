/**
 * MetadataParamsCheck rules — metadata/doc block parameter violations.
 *
 * Priority order:
 *   10 — module_contract: partial belongs to a known module → show module API
 *   20 — doc_block_params: cross-reference {% doc %} params with callers
 *   100 — generic: fallback hint
 */

import type { Rule } from './engine';

interface DocParam {
  name?: string;
  required?: boolean;
}

export const rules: Rule[] = [
  {
    id: 'MetadataParamsCheck.module_contract',
    check: 'MetadataParamsCheck',
    priority: 10,
    when: (diag) => {
      const msg = diag.message ?? '';
      const partialMatch = msg.match(/['"`]([^'"`]+)['"`]/);
      const name = partialMatch?.[1];
      return !!name && name.startsWith('modules/');
    },
    apply: (diag) => {
      const msg = diag.message ?? '';
      const partialMatch = msg.match(/['"`]([^'"`]+)['"`]/);
      const name = partialMatch?.[1];
      const moduleName = name?.split('/')[1] ?? 'unknown';
      const isFunctionCall = diag.params?.is_function_call === 'true';
      const tag = isFunctionCall ? 'function' : 'render';

      return {
        rule_id: 'MetadataParamsCheck.module_contract',
        hint_md: `Parameter mismatch on module ${tag} call \`${name}\`. Module partials define their contract via \`{% doc %}\` blocks — use \`module_info\` to see the expected signature.`,
        fixes: [],
        confidence: 0.85,
        see_also: {
          tool: 'module_info',
          args: { name: moduleName, section: 'api' },
          reason: `Module '${moduleName}' param mismatch. module_info(${moduleName}, api) shows the full signature with required/optional params.`,
        },
      };
    },
  },

  {
    id: 'MetadataParamsCheck.doc_block_params',
    check: 'MetadataParamsCheck',
    priority: 20,
    when: (diag, facts) => {
      const msg = diag.message ?? '';
      const partialMatch = msg.match(/['"`]([^'"`]+)['"`]/);
      const name = partialMatch?.[1];
      if (!name || name.startsWith('modules/')) return false;
      const sig = facts.graph!.partialSignature(name);
      return sig !== null && sig.length > 0;
    },
    apply: (diag, facts) => {
      const msg = diag.message ?? '';
      const partialMatch = msg.match(/['"`]([^'"`]+)['"`]/);
      const name = partialMatch![1];
      const sig = facts.graph!.partialSignature(name) as unknown as DocParam[];
      const isFunctionCall = diag.params?.is_function_call === 'true';
      const tag = isFunctionCall ? 'function' : 'render';

      const paramList = sig.map((p) => {
        const req = p.required ? '(required)' : '(optional)';
        return `\`${p.name}\` ${req}`;
      }).join(', ');

      return {
        rule_id: 'MetadataParamsCheck.doc_block_params',
        hint_md: `Parameter issue on \`{% ${tag} '${name}' %}\`. Declared params: ${paramList}.\n\nCheck the \`{% doc %}\` block in \`${name}\` for the full contract.`,
        fixes: [],
        confidence: 0.8,
        see_also: {
          tool: 'domain_guide',
          args: { domain: 'partials', section: 'api' },
          reason: 'Render call param mismatch. domain_guide(partials, api) explains how {% doc %} @param declarations interact with render and function calls.',
        },
      };
    },
  },

  {
    id: 'MetadataParamsCheck.generic',
    check: 'MetadataParamsCheck',
    priority: 100,
    when: () => true,
    apply: (diag) => {
      const isFunctionCall = diag.params?.is_function_call === 'true';
      return {
        rule_id: 'MetadataParamsCheck.generic',
        hint_md: isFunctionCall
          ? 'Function call parameter mismatch. Check the `{% doc %}` block in the target command/query for required `@param` declarations.'
          : 'Render call parameter mismatch. Check the `{% doc %}` block in the target partial for required `@param` declarations.',
        fixes: [],
        confidence: 0.4,
      };
    },
  },
];
