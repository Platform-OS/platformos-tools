import { JSONNode, YAMLCheck } from '../types';
import { walkNodes } from './walk';

function isJSONNode(thing: unknown): thing is JSONNode {
  return !!thing && typeof thing === 'object' && 'type' in thing;
}

/**
 * `loc` holds offsets, not nodes, so descending into it would find nothing — this is a
 * shortcut rather than a correctness guard, unlike Liquid's `nonTraversableProperties`.
 */
const nonTraversableProperties: ReadonlySet<string> = new Set(['loc']);

/**
 * Run a check's visitor methods over a {@link JSONNode} tree, which is the AST a YAML
 * file gets — `AST[YAML]` is `JSONNode`, so a YAML check narrows on JSON node types.
 *
 * Typed for `YAMLCheck` because YAML is the only caller: JSON is an editor-buffer type
 * that no check ever sees (see `JSONSourceCode`).
 */
// Not `async` — see `visitLiquid` for why the extra microtask ticks matter.
export function visitJSON(node: JSONNode, check: YAMLCheck): Promise<void> {
  return walkNodes(node, check as Parameters<typeof walkNodes>[1], {
    isNode: isJSONNode,
    skip: nonTraversableProperties,
  });
}
