import { LiquidFilter, LiquidHtmlNode, NodeTypes } from '@platformos/liquid-html-parser';
import { Severity, SourceCodeType, LiquidCheckDefinition, FilterEntry } from '../../types';
import { last } from '../../utils';

export const DeprecatedFilter: LiquidCheckDefinition = {
  meta: {
    code: 'DeprecatedFilter',
    aliases: ['DeprecatedFilters'],
    name: 'Deprecated Filter',
    docs: {
      description: 'Discourages using deprecated filters.',
      url: 'https://documentation.platformos.com/developer-guide/platformos-check/checks/deprecated-filter',
      recommended: true,
    },
    type: SourceCodeType.LiquidHtml,
    severity: Severity.WARNING,
    schema: {},
    targets: [],
  },

  create(context) {
    if (!context.platformosDocset) {
      return {};
    }

    return {
      LiquidFilter: async (node: LiquidFilter, ancestors: LiquidHtmlNode[]) => {
        const filters = await context.platformosDocset!.filters();

        const deprecatedFilter = filters.find((f) => {
          return f.deprecated && f.name === node.name;
        });

        if (!deprecatedFilter) {
          return;
        }

        const recommendedFilterName = findRecommendedAlternative(deprecatedFilter);
        const recommendedFilter = filters.find((f) => f.name === recommendedFilterName);

        // A deprecation that names a successor which is NOT a filter is a REWRITE, and only a
        // template-authored literal can be rewritten. A row with no successor at all is a plain
        // "stop using this" and still reports everywhere.
        const isRewriteDeprecation = !!recommendedFilterName && !recommendedFilter;
        if (isRewriteDeprecation && !isRewritableInPlace(node, ancestors)) {
          return;
        }

        const message = deprecatedFilterMessage(deprecatedFilter, recommendedFilter);

        const filterText = node.source.slice(node.position.start, node.position.end);
        const afterPipeIdx = filterText.indexOf('|') + 1;
        const nameIdx =
          afterPipeIdx + filterText.slice(afterPipeIdx).indexOf(deprecatedFilter.name);
        const filterNameStart = node.position.start + nameIdx;
        const filterNameEnd = filterNameStart + deprecatedFilter.name.length;

        context.report({
          message,
          startIndex: node.position.start + 1,
          endIndex: node.position.end,
          suggest: recommendedFilter
            ? [
                {
                  message: `Replace '${deprecatedFilter.name}' with '${recommendedFilter.name}'`,
                  fix: (corrector) => {
                    corrector.replace(filterNameStart, filterNameEnd, recommendedFilter.name);
                  },
                },
              ]
            : undefined,
        });
      },
    };
  },
};

function deprecatedFilterMessage(deprecated: FilterEntry, recommended?: FilterEntry) {
  if (recommended) {
    return `Deprecated filter '${deprecated.name}', consider using '${recommended.name}'.`;
  }

  return `Deprecated filter '${deprecated.name}'.`;
}

/**
 * The successor to offer as a rename, published from a `@replaced_by` annotation and gated by
 * `verify_filters_json.rb`: a deprecated filter must name a successor, and it must be a real filter.
 */
function findRecommendedAlternative(deprecatedFilter: FilterEntry) {
  return deprecatedFilter.deprecation_replacement?.trim() || undefined;
}

/**
 * Whether a deprecation whose successor is NOT a filter has anything the author can act on here.
 *
 * `parse_json` (and its alias `to_hash`) name `assign` as their replacement, because the
 * migration is `{% assign x = '{"a":1}' | parse_json %}` -> `{% assign x = { "a": 1 } %}`: the
 * JSON stops being a string and becomes markup. That only exists when the JSON was written in
 * the TEMPLATE. The docset says the rest out loud — a JSON document that arrives at RUNTIME (an
 * `api_call` response body, a session value, a `download_file`) reaches Liquid as a string, and
 * `{% assign %}` stores exactly the string it was given, so this filter remains the only step
 * that turns one into a Hash. Reporting `response.body | parse_json` asked for a rewrite that
 * does not exist and that no suggestion could offer, which is why this is a precondition for
 * reporting at all rather than a note in the message.
 *
 * Actionable means: this filter is FIRST in its chain and the chain starts at a string literal.
 * A later position means the input is whatever the preceding filters returned — `x | default:
 * '[]' | parse_json` parses a runtime value — and any non-literal source is runtime by
 * definition.
 */
function isRewritableInPlace(node: LiquidFilter, ancestors: LiquidHtmlNode[]): boolean {
  const parent = last(ancestors);
  if (!parent || parent.type !== NodeTypes.LiquidVariable) return false;
  if (parent.filters[0] !== node) return false;
  return parent.expression.type === NodeTypes.String;
}
