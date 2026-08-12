import { NodeTypes } from '@platformos/liquid-html-parser';

import {
  ResolvedArity,
  acceptsArgumentCount,
  filterArities,
  resolveArity,
} from '../../filter-arity-lookup';
import { LiquidCheckDefinition, Severity, SourceCodeType } from '../../types';

/**
 * How many arguments the runtime will consider this call to have.
 *
 * The rule was established by probing a live instance, not assumed, because an
 * off-by-one here turns every correct call into an offense:
 *
 *   `{{ 'abc'    | upcase: a: 1, b: 2, c: 3 }}`  -> given 2  (input + ONE hash)
 *   `{{ 'abc'    | upcase: 1, 2 }}`              -> given 3  (input + 2 positional)
 *   `{{ 'abcdef' | slice: 1, 2, extra: 9 }}`     -> given 4  (input + 2 + one hash)
 *
 * The piped value is argument one, and a whole group of named arguments arrives as a
 * single trailing hash however many names it contains.
 */
function argumentCount(args: { type: string }[]): number {
  const positional = args.filter((arg) => arg.type !== NodeTypes.NamedArgument).length;
  const hasNamed = args.some((arg) => arg.type === NodeTypes.NamedArgument);
  return 1 + positional + (hasNamed ? 1 : 0);
}

const describeRange = ({ min, max }: ResolvedArity) =>
  max === null ? `at least ${min}` : min === max ? `exactly ${min}` : `${min} to ${max}`;

export const FilterArity: LiquidCheckDefinition = {
  meta: {
    code: 'FilterArity',
    name: 'Filter called with the wrong number of arguments',
    docs: {
      description:
        'Reports a known filter applied with too few or too many arguments. platformOS raises Liquid::ArgumentError at render time, so the page returns a 500 rather than degrading.',
      recommended: true,
      url: undefined,
    },
    type: SourceCodeType.LiquidHtml,
    severity: Severity.ERROR,
    schema: {},
    targets: [],
  },

  create(context) {
    return {
      async LiquidFilter(node) {
        const published = context.platformosDocset
          ? filterArities(await context.platformosDocset.filters())
          : new Map<string, ResolvedArity>();
        const arity = resolveArity(node.name, published);

        // UNKNOWN STAYS UNKNOWN. A filter with no arity from either source — a module-provided
        // filter, or anything newer than the docset — must produce nothing. Guessing is how a
        // gate starts refusing working code, and `UnknownFilter` already owns the separate
        // question of whether the name exists at all.
        if (!arity) return;

        const given = argumentCount(node.args);
        if (acceptsArgumentCount(arity, given)) return;

        context.report({
          // Phrased to line up with the runtime's own complaint — "wrong number of
          // arguments (given 1, expected 2..3)" — so the lint and the 500 an author
          // may already have seen are recognisably the same fact. The parenthetical
          // is load-bearing: without it the counts look off by one at every call site.
          message:
            `Filter '${node.name}' is called with ${given} ${given === 1 ? 'argument' : 'arguments'} ` +
            `but accepts ${describeRange(arity)} (the piped value counts as one). ` +
            `platformOS raises Liquid::ArgumentError at render time.`,
          startIndex: node.position.start + 1,
          endIndex: node.position.end,
        });
      },
    };
  },
};
