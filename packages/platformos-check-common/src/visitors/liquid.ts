import { nonTraversableProperties } from '@platformos/liquid-html-parser';
import { LiquidCheck, LiquidHtmlNode } from '../types';
import { walkNodes } from './walk';

function isLiquidHtmlNode(thing: unknown): thing is LiquidHtmlNode {
  return !!thing && typeof thing === 'object' && 'type' in thing;
}

/**
 * Run a check's visitor methods over a Liquid+HTML AST.
 *
 * `nonTraversableProperties` is the parser's own list of the properties that link a node
 * back to its parent or siblings — descending into them would not terminate.
 */
// Returns the walk's promise rather than being `async` itself: `async function f() {
// return g() }` adds microtask ticks, and the engine runs check pipelines concurrently,
// so extra ticks reorder which pipeline reports first.
export function visitLiquid(node: LiquidHtmlNode, check: LiquidCheck): Promise<void> {
  return walkNodes(node, check as Parameters<typeof walkNodes>[1], {
    isNode: isLiquidHtmlNode,
    skip: nonTraversableProperties,
  });
}
