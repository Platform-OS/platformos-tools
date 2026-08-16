import { LiquidCheckDefinition, Severity, SourceCodeType } from '../../types';
import { FunctionMarkup, NodeTypes, RenderMarkup } from '@platformos/liquid-html-parser';
import { LiquidDocParameter } from '../../liquid-doc/liquidDoc';
import { inferArgumentType, isNullLiteral, isTypeCompatible } from '../../liquid-doc/utils';
import { filterReturnTypes, LiquidType } from '../../liquid-types';
import {
  CallSiteVariables,
  argumentType,
  findTypeMismatchParams,
  generateTypeMismatchSuggestions,
  getLiquidDocParams,
  getPartialName,
  reportTypeMismatches,
} from '../../liquid-doc/arguments';
import { variableTypeSources, variableTypesOf } from '../../variable-types';

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
      returnTypes: ReadonlyMap<string, LiquidType> | undefined,
      variables: CallSiteVariables,
    ) {
      if (node.alias && node.variable?.name && !isNullLiteral(node.variable.name)) {
        const paramIsDefinedWithType = liquidDocParameters
          .get(node.alias.value)
          ?.type?.toLowerCase();
        if (paramIsDefinedWithType) {
          // A FILTERED alias value is typed from the docset like any other argument. This path used
          // to have no filter guard at all while the named-argument path skipped filtered values
          // outright, so `{% render 'card' with x | t as title %}` — correct code — was reported as
          // "expected string, got object". Nothing guards it now either: an unresolvable filter
          // infers `untyped`, which `isTypeCompatible` accepts.
          //
          // A BARE lookup used to be excluded by a guard on the node type; it now resolves against
          // the caller's own file, and is `untyped` — as before — when that file says nothing.
          const providedParamType = argumentType(node.variable.name, returnTypes, variables);
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

    /**
     * The docset's filter return types, or `undefined` when there is no docset.
     *
     * Cheap to ask for per call site: `filters()` is memoized by `AugmentedPlatformOSDocset` and
     * `filterReturnTypes` caches on that array's identity, so this is a map lookup after the first
     * call in a run.
     */
    const returnTypes = async () =>
      context.platformosDocset
        ? filterReturnTypes(await context.platformosDocset.filters())
        : undefined;

    const validate = async (node: RenderMarkup | FunctionMarkup) => {
      const partialName = getPartialName(node);

      if (!partialName) return;

      const liquidDocParameters = await getLiquidDocParams(context, partialName);

      if (!liquidDocParameters) return;

      const types = await returnTypes();
      // The CALLER's file: what it assigned to the names it is passing. The partial's own file is
      // where the expected types come from, and the two never mix.
      const variables: CallSiteVariables = {
        types: await variableTypesOf(context.file),
        sources: await variableTypeSources(context.platformosDocset),
      };

      if (node.type === NodeTypes.RenderMarkup) {
        findAndReportAliasType(node, liquidDocParameters, types, variables);
      }

      const typeMismatchParams = findTypeMismatchParams(
        liquidDocParameters,
        node.args,
        types,
        variables,
      );
      reportTypeMismatches(context, typeMismatchParams, liquidDocParameters, types, variables);
    };

    return {
      async RenderMarkup(node: RenderMarkup) {
        await validate(node);
      },
      // `{% function %}` parses to its own markup node, so a check that visits only `RenderMarkup`
      // silently exempts every function call site — which this one did. Its siblings
      // (`PartialCallArguments`, `MissingRenderPartialArguments`, `DuplicateFunctionArguments`) all
      // visit both.
      async FunctionMarkup(node: FunctionMarkup) {
        await validate(node);
      },
    };
  },
};
