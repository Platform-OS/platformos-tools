import { LiquidFilter, NodeTypes, toLiquidHtmlAST } from '@platformos/liquid-html-parser';
import { describe, expect, it } from 'vitest';

import filtersJson from '../../platformos-check-docs-updater/data/filters.json';
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
   * THE ONE THING IN THIS TABLE THE DOCSET ALSO KNOWS: which names are aliases.
   */
  it('classifies every alias the shipped docset declares for a navigation filter', () => {
    const aliasesOf = (name: string) =>
      filtersJson.find((filter) => filter.name === name)?.aliases ?? [];

    // Read off the docset, so a new alias appears here without this file being edited.
    const spellings = (canonical: string) => [canonical, ...aliasesOf(canonical)];

    expect({
      hash_dig: spellings('hash_dig').map(navigationFilter),
      hash_fetch: spellings('hash_fetch').map(navigationFilter),
      // The control: `default` is the `alternative` row, and it must NOT be a navigation
      // filter — an assertion that every name maps to *something* would pass with the two
      // kinds confused.
      default: navigationFilter('default'),
    }).toEqual({
      hash_dig: [
        { kind: 'navigates', maxKeys: Infinity },
        { kind: 'navigates', maxKeys: Infinity },
      ],
      hash_fetch: [
        { kind: 'navigates', maxKeys: 1 },
        { kind: 'navigates', maxKeys: 1 },
      ],
      default: undefined,
    });
  });

  /**
   * WHICH ARGUMENT is the substitute, pinned once for both consumers.
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
