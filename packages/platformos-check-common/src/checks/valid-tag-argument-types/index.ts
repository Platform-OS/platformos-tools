import { LiquidNamedArgument, LiquidTag, NodeTypes } from '@platformos/liquid-html-parser';

import { generateTypeMismatchSuggestions } from '../../liquid-doc/arguments';
import { inferArgumentType, isNullLiteral, isTypeCompatible } from '../../liquid-doc/utils';
import { filterReturnTypes, tagParameterTypes } from '../../liquid-types';
import { LiquidCheckDefinition, Severity, SourceCodeType } from '../../types';

/**
 * The tag counterpart of `ValidRenderPartialArgumentTypes`, sharing its engine:
 * `inferArgumentType` reads the value, `isTypeCompatible` decides, and the filter return types come
 * from the same docset map — so there is no second inference path and no second compatibility rule.
 *
 * What differs is where the EXPECTED type comes from. A `{% render %}` argument is judged against
 * the partial's own `{% doc %}` block; a tag argument is judged against `tags.json`, which is
 * documentation this repository consumes and never audits.
 *
 * That document types almost nothing today: 67 of its 72 published parameters are `untyped`, and
 * the whole typed vocabulary is `for`'s and `tablerow`'s `limit`, `offset` and `cols`, all `number`.
 * So this check is nearly silent, deliberately — `tagParameterTypes` gives an `untyped` parameter no
 * row, and no row means nothing is reported. It starts reporting the moment the platform publishes
 * real types, with no change here. Guessing in the meantime is the one thing it must not do: these
 * checks are read as gates, and a wrong guess refuses working code.
 */
export const ValidTagArgumentTypes: LiquidCheckDefinition = {
  meta: {
    code: 'ValidTagArgumentTypes',
    name: 'Valid Tag Argument Types',
    docs: {
      description:
        'This check ensures that the arguments passed to a Liquid tag have the types the platformOS documentation publishes for them.',
      recommended: true,
      url: 'https://documentation.platformos.com/developer-guide/platformos-check/checks/valid-tag-argument-types',
    },
    type: SourceCodeType.LiquidHtml,
    severity: Severity.WARNING,
    schema: {},
    targets: [],
  },

  create(context) {
    const platformosDocset = context.platformosDocset;
    if (!platformosDocset) return {};

    return {
      async LiquidTag(node) {
        const args = namedArguments(node);
        if (args.length === 0) return;

        const parameters = tagParameterTypes(await platformosDocset.tags()).get(node.name);
        if (!parameters) return;

        const returnTypes = filterReturnTypes(await platformosDocset.filters());

        for (const arg of args) {
          const expectedType = parameters.get(arg.name);
          if (!expectedType) continue;

          // A hash pair (`key: 'val'` inside another argument) is a structure, not a value.
          if (arg.value.type === NodeTypes.NamedArgument) continue;

          // A BARE variable lookup has no type here — there is no symbol table at a tag, so
          // `limit: page_size` says nothing about what `page_size` holds. A FILTERED one does: the
          // last filter's published return type does not depend on its input. The same line
          // `findTypeMismatchParams` draws, for the same reason.
          if (arg.value.type === NodeTypes.LiquidVariable) {
            if (
              arg.value.filters.length === 0 &&
              arg.value.expression.type === NodeTypes.VariableLookup
            ) {
              continue;
            }
          } else if (arg.value.type === NodeTypes.VariableLookup) {
            continue;
          }

          // nil is compatible with every type — it is "no value", not a wrong one.
          if (isNullLiteral(arg.value)) continue;

          const actualType = inferArgumentType(arg.value, returnTypes);
          if (isTypeCompatible(expectedType, actualType)) continue;

          context.report({
            message: `Type mismatch for argument '${arg.name}' in ${node.name} tag: expected ${expectedType}, got ${actualType}`,
            startIndex: arg.value.position.start,
            endIndex: arg.value.position.end,
            suggest: generateTypeMismatchSuggestions(
              expectedType,
              arg.value.position.start,
              arg.value.position.end,
            ),
          });
        }
      },
    };
  },
};

/**
 * The named arguments a tag was written with, whatever markup shape it has.
 *
 * Read off `markup.args` rather than per tag: a dozen markup types carry that array, and a check
 * that named them one at a time would go quiet for the next tag the grammar learns.
 */
function namedArguments(node: LiquidTag): LiquidNamedArgument[] {
  const markup = node.markup;
  if (!markup || typeof markup === 'string') return [];

  const args = (markup as { args?: unknown }).args;
  if (!Array.isArray(args)) return [];

  return args.filter(
    (arg): arg is LiquidNamedArgument =>
      !!arg && typeof arg === 'object' && arg.type === NodeTypes.NamedArgument,
  );
}
