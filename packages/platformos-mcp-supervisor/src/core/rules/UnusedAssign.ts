/**
 * UnusedAssign rules — suppress false positives for variables used in render/function calls.
 *
 * Priority order:
 *   10 — passed_to_render: variable is an argument in a render call → suppress
 *   20 — passed_to_function: variable is a function call result → suppress
 *   100 — generic: standard "remove unused variable" hint
 */
import type { Rule } from './engine';
import { isVariablePassedToRender, isVariablePassedToFunction } from '../render-flow';

export const rules: Rule[] = [
  {
    id: 'UnusedAssign.passed_to_render',
    check: 'UnusedAssign',
    priority: 10,
    when: (diag, facts) => {
      const varName = diag.params?.variable;
      if (!varName || !diag.file || !facts.graph) return false;
      return !!isVariablePassedToRender(facts.graph, diag.file, varName);
    },
    apply: (diag) => {
      const params = diag.params!;
      const varName = params.variable;
      return {
        rule_id: 'UnusedAssign.passed_to_render',
        hint_md: `Variable \`${varName}\` appears unused in this file but is passed as an argument to a \`{% render %}\` call. This is a false positive — the variable IS used in the rendered partial.`,
        fixes: [],
        confidence: 0.95,
        suppress: true,
      };
    },
  },

  {
    id: 'UnusedAssign.passed_to_function',
    check: 'UnusedAssign',
    priority: 20,
    when: (diag, facts) => {
      const varName = diag.params?.variable;
      if (!varName || !diag.file || !facts.graph) return false;
      return !!isVariablePassedToFunction(facts.graph, diag.file, varName);
    },
    apply: (diag) => {
      const params = diag.params!;
      const varName = params.variable;
      return {
        rule_id: 'UnusedAssign.passed_to_function',
        hint_md: `Variable \`${varName}\` receives the return value of a \`{% function %}\` call. If the result is used downstream (e.g. passed to render or returned), this warning is a false positive.`,
        fixes: [],
        confidence: 0.8,
      };
    },
  },

  {
    id: 'UnusedAssign.generic',
    check: 'UnusedAssign',
    priority: 100,
    when: () => true,
    apply: (diag) => {
      const varName = diag.params?.variable ?? 'unknown';
      return {
        rule_id: 'UnusedAssign.generic',
        hint_md: `Variable \`${varName}\` is assigned but never read. Either remove the assignment or use the variable downstream.\nCommon causes: typo in variable name, leftover from refactoring, intermediate variable replaced by a direct expression.`,
        fixes: [],
        confidence: 0.5,
      };
    },
  },
];
