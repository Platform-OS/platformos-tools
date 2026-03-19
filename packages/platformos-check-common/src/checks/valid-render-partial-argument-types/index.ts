import { LiquidCheckDefinition, Severity, SourceCodeType } from '../../types';
import { NodeTypes, RenderMarkup } from '@platformos/liquid-html-parser';
import { LiquidDocParameter } from '../../liquid-doc/liquidDoc';
import { inferArgumentType, isNullLiteral, isTypeCompatible } from '../../liquid-doc/utils';
import {
  findTypeMismatchParams,
  generateTypeMismatchSuggestions,
  getLiquidDocParams,
  getPartialName,
  reportTypeMismatches,
} from '../../liquid-doc/arguments';

export const ValidRenderPartialArgumentTypes: LiquidCheckDefinition = {
  meta: {
    code: 'ValidRenderPartialArgumentTypes',
    name: 'Valid Render Partial Argument Types',
    aliases: ['ValidRenderPartialParamTypes'],
    docs: {
      description:
        'This check ensures that arguments passed to partial match the expected types defined in the liquidDoc header if present.',
      recommended: true,
      url: 'https://documentation.platformos.com/developer-guide/platformos-check/checks/valid-render-partial-argument-types',
    },
    type: SourceCodeType.LiquidHtml,
    severity: Severity.WARNING,
    schema: {},
    targets: [],
  },

  create(context) {
    /**
     * Checks for type mismatches when alias is used with `for` or `with` syntax.
     * This can be refactored at a later date to share more code with regular named arguments as they are both backed by LiquidExpression nodes.
     *
     * E.g. {% render 'card' with 123 as title %}
     */
    function findAndReportAliasType(
      node: RenderMarkup,
      liquidDocParameters: Map<string, LiquidDocParameter>,
    ) {
      if (
        node.alias &&
        node.variable?.name &&
        node.variable.name.type !== NodeTypes.VariableLookup &&
        !isNullLiteral(node.variable.name)
      ) {
        const paramIsDefinedWithType = liquidDocParameters
          .get(node.alias.value)
          ?.type?.toLowerCase();
        if (paramIsDefinedWithType) {
          const providedParamType = inferArgumentType(node.variable.name);
          if (!isTypeCompatible(paramIsDefinedWithType, providedParamType)) {
            const suggestions = generateTypeMismatchSuggestions(
              paramIsDefinedWithType,
              node.variable.name.position.start,
              node.variable.name.position.end,
            );

            context.report({
              message: `Type mismatch for argument '${node.alias.value}': expected ${paramIsDefinedWithType}, got ${providedParamType}`,
              startIndex: node.variable.name.position.start,
              endIndex: node.variable.name.position.end,
              suggest: suggestions,
            });
          }
        }
      }
    }

    return {
      async RenderMarkup(node: RenderMarkup) {
        const partialName = getPartialName(node);

        if (!partialName) return;

        const liquidDocParameters = await getLiquidDocParams(context, partialName);

        if (!liquidDocParameters) return;

        findAndReportAliasType(node, liquidDocParameters);

        const typeMismatchParams = findTypeMismatchParams(liquidDocParameters, node.args);
        reportTypeMismatches(context, typeMismatchParams, liquidDocParameters);
      },
    };
  },
};
