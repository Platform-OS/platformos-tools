/**
 * The one stack walk behind `visitLiquid` and `visitJSON`.
 *
 * Those two were the same thirty lines written twice, differing only in the type guard,
 * the set of properties not to descend into, and the static types — so those three are
 * exactly what this takes as parameters.
 *
 * The ORDER this produces is a contract, not an implementation detail: checks accumulate
 * state across nodes, so a different order gives different offenses on some files.
 * `index.spec.ts` pins the whole sequence for both ASTs. Two properties of it
 * are easy to break by "tidying" and are load-bearing:
 *
 * - **Array items are pushed in REVERSE.** The stack pops what was pushed last, so
 *   pushing backwards is what makes siblings come out in document order. Push them
 *   forwards and every array is visited backwards.
 * - **`:exit` fires in the same iteration as the entry method**, after the children are
 *   pushed but before any is popped — so it runs BEFORE the subtree, not after. That is
 *   surprising and it is what the code has always done; `CheckExitMethods`'s "in reverse
 *   order" is wrong prose over correct-by-precedent behaviour (TASK-73). Preserved here
 *   deliberately rather than fixed in passing, because changing it would change what
 *   every future `:exit` consumer sees.
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
 * A check's methods, as this walker addresses them: entry under the node's `type`, exit
 * under `` `${type}:exit` ``. The typed `Check<T>` surfaces are what callers use; this
 * is deliberately the loose shape, because the walk itself is type-agnostic.
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

    const exit = check[`${node.type}:exit`];
    if (exit) await exit(node, ancestors);
  }
}
