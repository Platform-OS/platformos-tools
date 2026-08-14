import { LiquidCheckDefinition, Severity, SourceCodeType } from '../../types';
import {
  FunctionMarkup,
  LiquidHtmlNode,
  NodeTypes,
  RenderMarkup,
} from '@platformos/liquid-html-parser';
import { LiquidDocParameter } from '../../liquid-doc/liquidDoc';
import {
  getLiquidDocParams,
  getPartialName,
  reportUnknownArguments,
} from '../../liquid-doc/arguments';
import { CallSiteTag, callSiteTag } from '../utils';
import { inScopeNames } from '../../liquid-doc/in-scope-names';
import { PlatformOSFileType } from '@platformos/platformos-common';

export const UnrecognizedRenderPartialArguments: LiquidCheckDefinition = {
  meta: {
    code: 'UnrecognizedRenderPartialArguments',
    name: 'Unrecognized Render Partial Arguments',
    aliases: ['UnrecognizedRenderPartialParams'],
    docs: {
      description:
        'This check ensures that no unknown arguments are used when rendering a partial. It owns the partials that HAVE a {% doc %} block; `PartialCallArguments` owns the ones that do not.',
      recommended: true,
      url: 'https://documentation.platformos.com/developer-guide/platformos-check/checks/unrecognized-render-partial-arguments',
    },
    type: SourceCodeType.LiquidHtml,
    severity: Severity.WARNING,
    schema: {},
    targets: [],
  },

  create(context) {
    function reportUnknownAliases(
      node: RenderMarkup,
      liquidDocParameters: Map<string, LiquidDocParameter>,
      partialName: string,
      tag: CallSiteTag,
    ) {
      const alias = node.alias;
      const variable = node.variable;

      if (alias && !liquidDocParameters.has(alias.value) && variable) {
        const startIndex = variable.position.start + 1;

        context.report({
          message: `Unknown argument '${alias.value}' in ${tag} tag for partial '${partialName}'.`,
          startIndex: startIndex,
          endIndex: alias.position.end,
          suggest: [
            {
              message: `Remove '${alias.value}'`,
              fix: (fixer: any) => {
                if (variable) {
                  return fixer.remove(variable.position.start, alias.position.end);
                }
              },
            },
          ],
        });
      }
    }

    /**
     * The documented objects in scope inside the called partial, so passing one is
     * redundant rather than unknown — a {% doc %} block has no reason to declare what the
     * caller never had to supply. A render/function target always resolves through the
     * `partial` document type, which is why the scope question is asked for a partial.
     *
     * Through `inScopeNames`, which every other caller of this same question uses: this was a
     * second scan with its own answer, and the two had already drifted — that one appended
     * Shopify's `app` drop to a partial's scope and this one did not.
     */
    const inScopeObjectNames = async (): Promise<Set<string>> =>
      new Set(await inScopeNames(context, PlatformOSFileType.Partial));

    const validate = async (node: RenderMarkup | FunctionMarkup, ancestors: LiquidHtmlNode[]) => {
      const partialName = getPartialName(node);

      if (!partialName) return;

      const liquidDocParameters = await getLiquidDocParams(context, partialName);

      if (!liquidDocParameters) return;

      const tag = callSiteTag(node, ancestors);
      const inScopeNames = await inScopeObjectNames();
      const unknownProvidedParams = node.args.filter(
        (p) => !liquidDocParameters.has(p.name) && !inScopeNames.has(p.name),
      );
      if (node.type === NodeTypes.RenderMarkup) {
        reportUnknownAliases(node, liquidDocParameters, partialName, tag);
      }
      reportUnknownArguments(context, node, unknownProvidedParams, partialName, tag);
    };

    return {
      async RenderMarkup(node: RenderMarkup, ancestors: LiquidHtmlNode[]) {
        await validate(node, ancestors);
      },
      async FunctionMarkup(node: FunctionMarkup, ancestors: LiquidHtmlNode[]) {
        await validate(node, ancestors);
      },
    };
  },
};
