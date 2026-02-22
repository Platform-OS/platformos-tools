import { LiquidFilter } from '@platformos/liquid-html-parser';
import {
  Severity,
  SourceCodeType,
  LiquidCheckDefinition,
  FilterEntry,
} from '../../types';

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
      LiquidFilter: async (node: LiquidFilter) => {
        const filters = await context.platformosDocset!.filters();

        const deprecatedFilter = filters.find((f) => {
          return f.deprecated && f.name === node.name;
        });

        if (!deprecatedFilter) {
          return;
        }

        const recommendedFilterName = findRecommendedAlternative(deprecatedFilter);
        const recommendedFilter = filters.find((f) => f.name === recommendedFilterName);

        const message = deprecatedFilterMessage(deprecatedFilter, recommendedFilter);

        context.report({
          message,
          startIndex: node.position.start + 1,
          endIndex: node.position.end,
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

function findRecommendedAlternative(deprecatedFilter: FilterEntry) {
  const reason = deprecatedFilter.deprecation_reason;
  const match = reason?.match(/replaced by \[`(.+?)`\]/);

  return match?.[1];
}
