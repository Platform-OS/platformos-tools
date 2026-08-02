import { HtmlElement, LiquidTag } from '@platformos/liquid-html-parser';
import {
  shouldSkipUrl,
  isValuedAttrNode,
  getAttrName,
  extractUrlPattern,
  getEffectiveMethod,
  tryExtractAssignUrl,
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
    // Tracks {% assign %} variable mappings incrementally in document order.
    // This means each <a> / <form> sees only the assigns that precede it,
    // and reassignments correctly shadow earlier values at their position.
    const variableMap = new Map<string, string>();

    async function checkUrlAttribute(
      attr: Parameters<typeof extractUrlPattern>[0],
      method: string,
    ) {
      const urlPattern = extractUrlPattern(attr, variableMap);
      if (urlPattern === null) return;
      if (shouldSkipUrl(urlPattern)) return;

      // Asked here, not in `onCodePathStart`: the table costs a read of every page in
      // the project, and this is the first moment it is known to be needed. A file
      // with no links — 87-97% of the Liquid in a real project — never gets here, and
      // `context.getRouteTable` is memoized per run, so a file with many pays once.
      const routeTable = await context.getRouteTable();

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
        const extracted = tryExtractAssignUrl(node);
        if (extracted) {
          variableMap.set(extracted.name, extracted.urlPattern);
        }
      },

      async HtmlElement(node) {
        if (isHtmlTag(node, 'a')) {
          const hrefAttr = node.attributes.find(
            (a) => isValuedAttrNode(a) && getAttrName(a) === 'href',
          );

          if (hrefAttr && isValuedAttrNode(hrefAttr)) {
            await checkUrlAttribute(hrefAttr, 'get');
          }
        } else if (isHtmlTag(node, 'form')) {
          const actionAttr = node.attributes.find(
            (a) => isValuedAttrNode(a) && getAttrName(a) === 'action',
          );

          if (actionAttr && isValuedAttrNode(actionAttr)) {
            const method = getEffectiveMethod(node as HtmlElement);
            if (method !== null) {
              await checkUrlAttribute(actionAttr, method);
            }
          }
        }
      },
    };
  },
};
