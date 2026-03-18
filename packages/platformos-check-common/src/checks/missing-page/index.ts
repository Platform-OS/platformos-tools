import {
  HtmlElement,
  LiquidTag,
  NamedTags,
  LiquidTagAssign,
  AssignMarkup,
} from '@platformos/liquid-html-parser';
import { RouteTable } from '@platformos/platformos-common';
import {
  shouldSkipUrl,
  isValuedAttrNode,
  getAttrName,
  extractUrlPattern,
  getEffectiveMethod,
  resolveAssignToUrlPattern,
} from '../../url-helpers';
import { LiquidCheckDefinition, Severity, SourceCodeType } from '../../types';
import { isHtmlTag } from '../utils';

export const MissingPage: LiquidCheckDefinition = {
  meta: {
    code: 'MissingPage',
    name: 'Missing page for route',
    docs: {
      description:
        'Reports links and form actions that point to routes with no corresponding platformOS page.',
      recommended: true,
      url: 'https://documentation.platformos.com/developer-guide/platformos-check/checks/missing-page',
    },
    type: SourceCodeType.LiquidHtml,
    severity: Severity.WARNING,
    schema: {},
    targets: [],
  },

  create(context) {
    let routeTable: RouteTable;
    // Tracks {% assign %} variable mappings incrementally in document order.
    // This means each <a> / <form> sees only the assigns that precede it,
    // and reassignments correctly shadow earlier values at their position.
    const variableMap = new Map<string, string>();

    function checkUrlAttribute(attr: Parameters<typeof extractUrlPattern>[0], method: string) {
      const urlPattern = extractUrlPattern(attr, variableMap);
      if (urlPattern === null) return;
      if (shouldSkipUrl(urlPattern)) return;

      if (!routeTable.hasMatch(urlPattern, method)) {
        const methodLabel = method.toUpperCase();
        context.report({
          message: `No page found for route '${urlPattern}' (${methodLabel})`,
          startIndex: attr.value[0].position.start,
          endIndex: attr.value[attr.value.length - 1].position.end,
        });
      }
    }

    return {
      async LiquidTag(node: LiquidTag) {
        if (node.name !== NamedTags.assign) return;
        const markup = (node as LiquidTagAssign).markup as AssignMarkup;
        if (markup.lookups.length > 0) return;

        const urlPattern = resolveAssignToUrlPattern(markup);
        if (urlPattern !== null) {
          variableMap.set(markup.name, urlPattern);
        }
      },

      async HtmlElement(node) {
        if (!routeTable) {
          routeTable = await context.getRouteTable();
        }

        if (isHtmlTag(node, 'a')) {
          const hrefAttr = node.attributes.find(
            (a) => isValuedAttrNode(a) && getAttrName(a) === 'href',
          );

          if (hrefAttr && isValuedAttrNode(hrefAttr)) {
            checkUrlAttribute(hrefAttr, 'get');
          }
        } else if (isHtmlTag(node, 'form')) {
          const actionAttr = node.attributes.find(
            (a) => isValuedAttrNode(a) && getAttrName(a) === 'action',
          );

          if (actionAttr && isValuedAttrNode(actionAttr)) {
            const method = getEffectiveMethod(node as HtmlElement);
            if (method !== null) {
              checkUrlAttribute(actionAttr, method);
            }
          }
        }
      },
    };
  },
};
