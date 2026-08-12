import { describe, expect, it } from 'vitest';
import { toLiquidHTMLAST, toYAMLAST } from '../to-source-code';
import { JSONNode, LiquidCheck, LiquidHtmlNode, YAMLCheck } from '../types';
import { visitLiquid } from './liquid';
import { visitJSON } from './json';

/**
 * A CHARACTERIZATION test: it pins the exact sequence the two check-runner walkers
 * produce TODAY, recorded from the running code rather than reasoned about, so that
 * unifying them into one implementation cannot quietly change it.
 *
 * Traversal order is not an implementation detail. Checks accumulate state across nodes
 * — `UnusedAssign` pairs an assign with a later lookup, `UnclosedHTMLElement` matches
 * opens against closes — so a walker that visits the same nodes in a different order
 * gives the same offenses on some files and different ones on others. Asserting the
 * whole sequence rather than a node count is what makes that visible.
 *
 * Two things in the recorded output are worth knowing, and BOTH are the contract:
 *
 * 1. **Exactly one callback per node.** The recorder below offers a method for every
 *    property asked of it, `` `${type}:exit` `` included, so these sequences are also
 *    the proof that the walker never dispatches a second callback per node — a check
 *    that wants to act after a subtree accumulates and acts in `onCodePathEnd`. The
 *    per-node exit hook was removed in TASK-73: it fired BEFORE the subtree rather than
 *    after, had no consumer among the shipped checks, and cost 33% of the walker's time
 *    (a template-string allocation plus a lookup per node, measured over 80k node
 *    visits). Re-adding it is a deliberate change that fails these two tests first.
 *
 * 2. **Sibling PROPERTIES come out in reverse declaration order, while sibling ARRAY
 *    ELEMENTS come out in document order.** The stack pops what was pushed last, so
 *    properties reverse; the inner loop pushes array items backwards specifically to
 *    undo that, so array items do not. Hence an `HtmlElement` yields its `children`
 *    (`LiquidVariableOutput`) before its `name` (`TextNode`), while the two
 *    `HtmlElement` siblings inside `children` stay in source order.
 */
describe('Unit: check-runner traversal order', () => {
  /**
   * Records every method the walker dispatches, indented by ancestor depth.
   *
   * A `Proxy` rather than an enumerated check object: the walker looks up
   * `check[node.type]`, so this records whatever it asks for without the test having to
   * list node types — and so a node type appearing that the test did not anticipate
   * shows up in the output instead of being silently skipped.
   */
  function recorder() {
    const events: string[] = [];
    const check = new Proxy(
      {},
      {
        get(_target, property: string) {
          // vitest awaits the result; without this the Proxy looks thenable.
          if (property === 'then') return undefined;
          return async (_node: unknown, ancestors: unknown[]) => {
            events.push(`${'  '.repeat(ancestors.length)}${property}`);
          };
        },
        has: () => true,
      },
    );
    return { events, check };
  }

  /**
   * The siblings are deliberately DIFFERENT node types. An earlier version of this
   * fixture used `<b>{{ x }}</b><i>{{ y }}</i>` — two structurally identical elements —
   * so reversing the array push order produced the very same type sequence and the test
   * passed under sabotage. Sibling order is only observable when siblings differ.
   */
  it('walks a Liquid AST in this exact order', async () => {
    const ast = toLiquidHTMLAST('{% if a %}<b>{{ x }}</b>{% assign z = 1 %}{% endif %}');
    expect(ast).not.toBeInstanceOf(Error);

    const { events, check } = recorder();
    await visitLiquid(ast as LiquidHtmlNode, check as unknown as LiquidCheck);

    expect(events).toEqual([
      'Document',
      '  LiquidTag',
      '    LiquidBranch',
      // The `<b>` element and the `{% assign %}` are array elements of `children`, so
      // they keep SOURCE order: element first, assign second. Push them forwards
      // instead of in reverse and this pair swaps.
      '      HtmlElement',
      // … while this element's own properties do NOT keep declaration order:
      // `children` comes out before `name`.
      '        LiquidVariableOutput',
      '          LiquidVariable',
      '            VariableLookup',
      '        TextNode',
      '      LiquidTag',
      '        AssignMarkup',
      '          LiquidVariable',
      '            Number',
      // The `{% if %}` condition, reached after the branch for the same reason.
      '    VariableLookup',
    ]);
  });

  it('walks a YAML AST in this exact order', async () => {
    const ast = toYAMLAST('en:\n  first: 1\n  second:\n    - a\n    - b\n');
    expect(ast).not.toBeInstanceOf(Error);

    const { events, check } = recorder();
    await visitJSON(ast as JSONNode, check as unknown as YAMLCheck);

    expect(events).toEqual([
      'Object',
      '  Property',
      '    Object',
      // A Property yields its VALUE before its KEY — property-order reversal again.
      '      Property',
      '        Literal',
      '        Identifier',
      '      Property',
      '        Array',
      // Array elements keep source order: `a` then `b`.
      '          Literal',
      '          Literal',
      '        Identifier',
      '    Identifier',
    ]);
  });
});
