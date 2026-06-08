/**
 * Render-flow analyser — cross-file variable tracking through render chains.
 *
 * Pure query functions over `ProjectFactGraph`. No side effects.
 *
 * Consumed by:
 *   - `UnusedAssign` rules — suppress when the variable is passed to a
 *     render or function call.
 *   - `MissingRenderPartialArguments` rules — read the target's declared
 *     `@param` list and detect chain-satisfaction (a missing arg may
 *     already be in the caller's own signature).
 *
 * v1 trim (dropped: no in-scope readers): `callersWithArgs`,
 * `missingArgsForCaller`, `renderFlowSummary`.
 */

import type { ProjectFactGraph } from './project-fact-graph';

/**
 * True if `varName` is passed as an argument value in any `{% render %}`
 * call inside `filePath`. Source semantics: match against the call's
 * recorded `args` array — arg names that equal the variable name count.
 */
export function isVariablePassedToRender(
  graph: ProjectFactGraph,
  filePath: string,
  varName: string,
): boolean {
  const calls = graph.renderCallsFrom(filePath);
  for (const call of calls) {
    if (call.args.includes(varName)) return true;
  }
  return false;
}

/**
 * True if `varName` appears as the result variable of any `{% function %}`
 * call in the file's node (e.g. `{% function varName = 'modules/x' %}`).
 */
export function isVariablePassedToFunction(
  graph: ProjectFactGraph,
  filePath: string,
  varName: string,
): boolean {
  const node = graph.nodeByPath(filePath);
  if (!node?.function_calls) return false;
  for (const fc of node.function_calls) {
    if (fc.variable === varName) return true;
  }
  return false;
}

/** Declared `@param` list for `partialKey`, or `[]` when unknown. */
export function getPartialParams(graph: ProjectFactGraph, partialKey: string): string[] {
  return graph.partialSignature(partialKey) ?? [];
}

/**
 * Chain-satisfaction check: a missing param on a callee is acceptable
 * when the caller has the same param in its own signature.
 *
 * Page → A → B: if B requires `x` and A doesn't pass it, but A declares
 * `x` as a `@param`, A has it in scope and can forward it.
 */
export function isParamAvailableInCallerScope(
  graph: ProjectFactGraph,
  callerPath: string,
  paramName: string,
): boolean {
  const callerNode = graph.nodeByPath(callerPath);
  if (!callerNode?.params) return false;
  return callerNode.params.includes(paramName);
}
