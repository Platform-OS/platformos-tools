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
 * Two things in the recorded output are surprising, and BOTH are the current contract:
 *
 * 1. **`:exit` does not mean "after the subtree".** It fires in the same loop iteration
 *    as the entry method, immediately after the node's children are pushed and before
 *    any of them is popped — so every `X:exit` sits directly under its own `X`. It is
 *    effectively a second entry callback. `CheckExitMethods` in `types.ts` claims
 *    "Happens once per node, in reverse order", which is not what happens; no shipped
 *    check uses `:exit`, which is how the wrong prose survived. See TASK-73.
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
      'Document:exit',
      '  LiquidTag',
      '  LiquidTag:exit',
      '    LiquidBranch',
      '    LiquidBranch:exit',
      // The `<b>` element and the `{% assign %}` are array elements of `children`, so
      // they keep SOURCE order: element first, assign second. Push them forwards
      // instead of in reverse and this pair swaps.
      '      HtmlElement',
      '      HtmlElement:exit',
      // … while this element's own properties do NOT keep declaration order:
      // `children` comes out before `name`.
      '        LiquidVariableOutput',
      '        LiquidVariableOutput:exit',
      '          LiquidVariable',
      '          LiquidVariable:exit',
      '            VariableLookup',
      '            VariableLookup:exit',
      '        TextNode',
      '        TextNode:exit',
      '      LiquidTag',
      '      LiquidTag:exit',
      '        AssignMarkup',
      '        AssignMarkup:exit',
      '          LiquidVariable',
      '          LiquidVariable:exit',
      '            Number',
      '            Number:exit',
      // The `{% if %}` condition, reached after the branch for the same reason.
      '    VariableLookup',
      '    VariableLookup:exit',
    ]);
  });

  it('walks a YAML AST in this exact order', async () => {
    const ast = toYAMLAST('en:\n  first: 1\n  second:\n    - a\n    - b\n');
    expect(ast).not.toBeInstanceOf(Error);

    const { events, check } = recorder();
    await visitJSON(ast as JSONNode, check as unknown as YAMLCheck);

    expect(events).toEqual([
      'Object',
      'Object:exit',
      '  Property',
      '  Property:exit',
      '    Object',
      '    Object:exit',
      // A Property yields its VALUE before its KEY — property-order reversal again.
      '      Property',
      '      Property:exit',
      '        Literal',
      '        Literal:exit',
      '        Identifier',
      '        Identifier:exit',
      '      Property',
      '      Property:exit',
      '        Array',
      '        Array:exit',
      // Array elements keep source order: `a` then `b`.
      '          Literal',
      '          Literal:exit',
      '          Literal',
      '          Literal:exit',
      '        Identifier',
      '        Identifier:exit',
      '    Identifier',
      '    Identifier:exit',
    ]);
  });
});
