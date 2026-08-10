import { LiquidFilter, NodeTypes, toLiquidHtmlAST } from '@platformos/liquid-html-parser';
import { describe, expect, it } from 'vitest';

import {
  alternativeSubstituteArg,
  isAlternativeReturningFilter,
  navigationFilter,
} from './filter-semantics';

/** The filters of `{{ x | … }}`, from the real parser rather than hand-built nodes. */
function filtersOf(markup: string): LiquidFilter[] {
  const [output] = toLiquidHtmlAST(`{{ ${markup} }}`).children;
  if (output.type !== NodeTypes.LiquidVariableOutput || typeof output.markup === 'string') {
    throw new Error(`not a filtered output: ${markup}`);
  }
  return output.markup.filters;
}

/** What the accessor found, as something an assertion can state whole. */
function substituteOf(markup: string): string | undefined | 'not-a-string' {
  const substitute = alternativeSubstituteArg(filtersOf(markup)[0]);
  if (substitute === undefined) return undefined;
  return substitute.type === NodeTypes.String ? substitute.value : 'not-a-string';
}

describe('Unit: filter value semantics', () => {
  it('classifies the table it owns', () => {
    expect({
      default: isAlternativeReturningFilter('default'),
      dig: isAlternativeReturningFilter('dig'),
      upcase: isAlternativeReturningFilter('upcase'),
      navigation: [navigationFilter('hash_fetch'), navigationFilter('dig'), navigationFilter('t')],
    }).toEqual({
      default: true,
      dig: false,
      upcase: false,
      navigation: [
        { kind: 'navigates', maxKeys: 1 },
        { kind: 'navigates', maxKeys: Infinity },
        undefined,
      ],
    });
  });

  /**
   * WHICH ARGUMENT is the substitute, pinned once for both consumers.
   *
   * Nothing pinned it while each of them spelled `args[0]` privately: measured, changing the
   * index to `args[1]` failed no test in either package, in `UnknownProperty`'s JSON-chain
   * analysis or in the language server's `default` typing. Both read this accessor now, so
   * this group is the only place that has to be right.
   *
   * A `NamedArgument` is an OPTION and never a substitute, which is the half most likely to be
   * got wrong: `allow_false` is a real `default` argument (`filter-arity.ts` records
   * `default: {min: 1, max: 3}`), so it is reachable rather than hypothetical.
   */
  it('names the first POSITIONAL argument, and nothing else', () => {
    expect({
      literal: substituteOf(`x | default: 'fallback'`),
      // The option follows the substitute, which is still the substitute.
      beforeAnOption: substituteOf(`x | default: 'fallback', allow_false: true`),
      // An expression rather than a literal: found, and left to the caller to narrow.
      expression: substituteOf('x | default: y'),
      // Nothing stands in for the piped value in either of these.
      bare: substituteOf('x | default'),
      onlyAnOption: substituteOf('x | default: allow_false: true'),
      // Not an `alternative` filter at all, whatever it was handed.
      transforming: substituteOf(`x | upcase`),
      navigating: substituteOf(`x | dig: 'a'`),
    }).toEqual({
      literal: 'fallback',
      beforeAnOption: 'fallback',
      expression: 'not-a-string',
      bare: undefined,
      onlyAnOption: undefined,
      transforming: undefined,
      navigating: undefined,
    });
  });
});
