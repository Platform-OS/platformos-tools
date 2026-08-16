import {
  LiquidFilter,
  LiquidHtmlNode,
  LiquidNamedArgument,
  NodeTypes,
} from '@platformos/liquid-html-parser';

import { LiquidCheckDefinition, Severity, SourceCodeType } from '../../types';

/**
 * A filter the platform parses but never applies, so it is dead code.
 *
 * WHICH RUBY PARSER RECEIVES THE VALUE decides the answer, and each position was measured
 * against a live instance — the grammar cannot tell you, because it accepts a filter in far more
 * places than the runtime honours one:
 *
 *   `Liquid::Variable`             APPLIES    {{ }}, assign, hash_assign, session,
 *                                            echo, print, return
 *   `Liquid::JsonLiteralVariable`  APPLIES    an argument value that IS a JSON literal
 *   `TAG_ATTRIBUTES` scan          DISCARDS   every other operand and argument value
 *   `Expression.parse` over a
 *     `QuotedFragment`             DISCARDS
 *
 * Both discarding paths exclude `|` by construction, so the filter never reaches the value.
 *
 * A TRAILING filter — one written after a tag's last argument — is NOT a separate rule but the
 * same one applied to that last argument, because `TAG_ATTRIBUTES` keeps scanning past the `|`.
 * Measured: `{% function r = 'p', a: 1 | dig: 'x' %}` hands the partial a stray `dig` argument
 * and leaves `r` unfiltered, while `{% function r = 'p', items: [1, 2] | reverse %}` really does
 * reverse `items`, a JSON literal being the one argument shape whose parser consumes filters.
 * `graphql`'s FILE form is the sole tag that genuinely splits its markup on the first `|`.
 *
 * Applying positions are allowlisted rather than ignoring ones, because the applying set changes
 * only when a new write tag appears while the ignoring set grows with every tag platformOS adds
 * — so a new tag is reported by default, and a missing entry is a false positive `index.spec.ts`
 * holds measured fixtures against.
 *
 * ON AST FIDELITY: the grammar parks a trailing filter on the MARKUP node where the runtime
 * binds it to the last argument. That is deliberate and must not be read as "this is a result
 * filter" — the prettier printer regenerates source from the AST, and the markup node is where
 * the author's filter round-trips verbatim.
 *
 * Never blocking: the file deploys and renders.
 */

/**
 * Positions where the platform parses the value as a full Liquid variable, so filters apply.
 *
 * Keyed by parent type AND field, because neither alone is enough: `LiquidTag.markup` holds an
 * APPLYING variable for `echo` and an IGNORED one for `case` and `yield`.
 */
const APPLIES_BY_PARENT_FIELD: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  [NodeTypes.LiquidVariableOutput, new Set(['markup'])],
  [NodeTypes.AssignMarkup, new Set(['value'])],
  [NodeTypes.SessionMarkup, new Set(['value'])],
  [NodeTypes.HashAssignMarkup, new Set(['value'])],
]);

/** Tags whose ENTIRE markup is a Liquid variable, so filters apply. */
const APPLIES_AS_WHOLE_TAG_MARKUP: ReadonlySet<string> = new Set(['echo', 'print', 'return']);

/**
 * Expressions the platform parses with `Liquid::JsonLiteralVariable`, which consumes filters.
 *
 * Only the literal's OWN filters: measured, a filter nested INSIDE the literal
 * (`data: {"a": 'z' | upcase}`) is a converter syntax error, so nothing there is exempt.
 */
const JSON_LITERALS: ReadonlySet<string> = new Set([
  NodeTypes.JsonHashLiteral,
  NodeTypes.JsonArrayLiteral,
]);

/** The expression a value ultimately holds, through the wrappers different positions add. */
function expressionTypeOf(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object') return undefined;

  const node = value as LiquidHtmlNode;
  if (node.type === NodeTypes.NamedArgument) return expressionTypeOf(node.value);
  if (node.type === NodeTypes.LiquidVariable) return expressionTypeOf(node.expression);
  return node.type;
}

const isJsonLiteral = (value: unknown) => JSON_LITERALS.has(expressionTypeOf(value) ?? '');

/** Which field of `parent` holds `node`, or undefined when it is not a direct child. */
function fieldHolding(parent: LiquidHtmlNode, node: LiquidHtmlNode): string | undefined {
  for (const [key, value] of Object.entries(parent)) {
    if (value === node) return key;
    if (Array.isArray(value) && value.includes(node)) return key;
  }
  return undefined;
}

function filtersApplyHere(parent: LiquidHtmlNode, node: LiquidHtmlNode): boolean {
  const field = fieldHolding(parent, node);
  if (field === undefined) return false;

  if (parent.type === NodeTypes.LiquidTag) {
    return field === 'markup' && APPLIES_AS_WHOLE_TAG_MARKUP.has(String(parent.name));
  }

  if (parent.type === NodeTypes.NamedArgument) {
    return field === 'value' && isJsonLiteral(node);
  }

  return APPLIES_BY_PARENT_FIELD.get(parent.type)?.has(field) ?? false;
}

/** The shape shared by every markup node that can carry a trailing filter list. */
type MarkupWithTrailingFilters = { args: LiquidNamedArgument[]; filters: LiquidFilter[] };

export const FilterWithoutEffect: LiquidCheckDefinition = {
  meta: {
    code: 'FilterWithoutEffect',
    name: 'Filter in a position the platform ignores',
    docs: {
      description:
        'Reports a filter applied in a platformOS tag operand or argument value. The deploy converter accepts it, but the runtime parses those markups with its own scanner and never applies the filter, so the value is used unfiltered.',
      recommended: true,
      url: 'https://documentation.platformos.com/developer-guide/platformos-check/checks/filter-without-effect',
    },
    type: SourceCodeType.LiquidHtml,
    severity: Severity.WARNING,
    schema: {},
    targets: [],
  },

  create(context) {
    const report = (filters: LiquidFilter[], advice: string) => {
      const names = filters.map((filter) => `'${filter.name}'`).join(', ');

      context.report({
        message:
          `${filters.length === 1 ? `Filter ${names} has` : `Filters ${names} have`} no effect here. ` +
          advice,
        // The FILTERS are highlighted, not the value: the value is fine and the filter is
        // the dead part. A LiquidFilter's range opens at the whitespace before its `|`.
        startIndex: filters[0].position.start,
        endIndex: filters[filters.length - 1].position.end,
      });
    };

    /**
     * A trailing filter on a tag the runtime does NOT split on the first `|`. It binds to the
     * last argument, so it survives only where that argument's parser consumes filters.
     */
    const reportTrailingFilters = (node: MarkupWithTrailingFilters) => {
      if (node.filters.length === 0) return;
      if (isJsonLiteral(node.args[node.args.length - 1])) return;

      report(
        node.filters,
        'platformOS scans this tag markup with its own scanner and never filters the tag result, ' +
          'so the unfiltered value is assigned — and a filter spelled `name: value` is scanned ' +
          'as one more tag argument. Apply it to the result in a following {% assign %}.',
      );
    };

    return {
      async LiquidVariable(node, ancestors) {
        if (node.filters.length === 0) return;

        const parent = ancestors[ancestors.length - 1];
        if (!parent || filtersApplyHere(parent, node)) return;

        report(
          node.filters,
          'platformOS parses this tag markup with its own scanner and never applies the filter, ' +
            'so the unfiltered value is used. Apply it in an {% assign %} first and pass the ' +
            'assigned variable.',
        );
      },

      // Every markup node that carries a trailing filter list EXCEPT `GraphQLMarkup`, which is
      // the one tag measured to split its markup on the first `|` and filter its result.
      async FunctionMarkup(node) {
        reportTrailingFilters(node);
      },
      async BackgroundMarkup(node) {
        reportTrailingFilters(node);
      },
      async GraphQLInlineMarkup(node) {
        reportTrailingFilters(node);
      },
    };
  },
};
