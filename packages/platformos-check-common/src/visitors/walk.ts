/**
 * The one stack walk behind `visitLiquid` and `visitJSON`.
 *
 * Those two were the same thirty lines written twice, differing only in the type guard,
 * the set of properties not to descend into, and the static types — so those three are
 * exactly what this takes as parameters.
 *
 * The ORDER this produces is a contract, not an implementation detail: checks accumulate
 * state across nodes, so a different order gives different offenses on some files.
 * `index.spec.ts` pins the whole sequence for both ASTs, and one property of it is easy
 * to break by "tidying" and is load-bearing: **array items are pushed in REVERSE**. The
 * stack pops what was pushed last, so pushing backwards is what makes siblings come out
 * in document order. Push them forwards and every array is visited backwards.
 *
 * There is **one callback per node**, and no per-node exit callback. A check that needs
 * to act after a subtree accumulates during the walk and acts in `onCodePathEnd`, which
 * every one of them already does. Post-subtree semantics need a second stack frame per
 * node; `index.spec.ts` pins that nothing but the entry method is ever dispatched, so
 * re-adding the capability is a deliberate change with a failing test to flip (TASK-73).
 */
export interface NodeWalkOptions<Node> {
  /** Whether an arbitrary property value is a node worth descending into. */
  isNode: (value: unknown) => value is Node;
  /**
   * Property names never descended into.
   *
   * For Liquid this is the parser's `nonTraversableProperties` (`parentNode`, `prev`,
   * `next`, `firstChild`, `lastChild`), which the parser documents as "properties that
   * create loops that would make walking infinite".
   */
  skip: ReadonlySet<string>;
}

/**
 * A check's methods, as this walker addresses them: one entry method under the node's
 * `type`. The typed `Check<T>` surfaces are what callers use; this is deliberately the
 * loose shape, because the walk itself is type-agnostic.
 */
type NodeMethods<Node> = Record<
  string,
  ((node: Node, ancestors: Node[]) => Promise<void>) | undefined
>;

export async function walkNodes<Node extends { type: string }>(
  root: Node,
  check: NodeMethods<Node>,
  { isNode, skip }: NodeWalkOptions<Node>,
): Promise<void> {
  const stack: { node: Node; ancestors: Node[] }[] = [{ node: root, ancestors: [] }];

  while (stack.length > 0) {
    const { node, ancestors } = stack.pop()!;
    const lineage = ancestors.concat(node);

    // `if (method) await …`, never `await check[type]?.(…)`. The optional-call form
    // awaits `undefined` for every node a check has no method for, which is nearly all
    // of them — one extra microtask per node per check, in the hot loop. It also
    // reorders results: the engine runs check pipelines concurrently, so extra ticks
    // change which finishes first, and `required-doc-param-with-default`'s spec caught
    // exactly that as a reordered offense list.
    const enter = check[node.type];
    if (enter) await enter(node, ancestors);

    for (const key in node) {
      if (!Object.prototype.hasOwnProperty.call(node, key) || skip.has(key)) continue;

      const value = node[key as keyof Node];
      if (Array.isArray(value)) {
        // Backwards: the stack pops last-pushed first, so this is what keeps siblings
        // in document order.
        for (let i = value.length - 1; i >= 0; i--) {
          const item = value[i];
          if (isNode(item)) stack.push({ node: item, ancestors: lineage });
        }
      } else if (isNode(value)) {
        stack.push({ node: value, ancestors: lineage });
      }
    }
  }
}
