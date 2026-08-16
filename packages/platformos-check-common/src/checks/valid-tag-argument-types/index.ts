import { LiquidNamedArgument, LiquidTag, NodeTypes } from '@platformos/liquid-html-parser';

import { generateTypeMismatchSuggestions } from '../../liquid-doc/arguments';
import { inferArgumentType, isNullLiteral, isTypeCompatible } from '../../liquid-doc/utils';
import { filterReturnTypes, tagParameterTypes } from '../../liquid-types';
import { LiquidCheckDefinition, Severity, SourceCodeType } from '../../types';
import { variableTypeSources, variableTypesOf } from '../../variable-types';

/**
 * The tag counterpart of `ValidRenderPartialArgumentTypes`, sharing its engine:
 * `inferArgumentType` reads the value, `isTypeCompatible` decides, and the filter return types come
 * from the same docset map — so there is no second inference path and no second compatibility rule.
 *
 * What differs is where the EXPECTED type comes from. A `{% render %}` argument is judged against
 * the partial's own `{% doc %}` block; a tag argument is judged against `tags.json`, which is
 * documentation this repository consumes and never audits.
 *
 * The size of that vocabulary is not this check's business and has changed under it once already:
 * the document typed 5 of its 72 parameters while `platformos_tags.liquid` published a hardcoded
 * `"untyped"`, and 69 of 72 the day that line was fixed — so this check went from nearly silent to
 * broadly useful without an edit here, which is the design. `tagParameterTypes` gives an `untyped`
 * parameter no row, and no row means nothing is reported. Guessing at a type the document does not
 * publish is the one thing it must not do: these checks are read as gates, and a wrong guess refuses
 * working code.
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
        const variables = await variableTypesOf(context.file);
        const sources = await variableTypeSources(platformosDocset);

        for (const arg of args) {
          const expectedType = parameters.get(arg.name);
          if (!expectedType) continue;

          // A hash pair (`key: 'val'` inside another argument) is a structure, not a value.
          if (arg.value.type === NodeTypes.NamedArgument) continue;

          // nil is compatible with every type — it is "no value", not a wrong one.
          if (isNullLiteral(arg.value)) continue;

          // A BARE variable lookup is answered by the FILE — `{% assign n = 'x' %}{% tag limit: n %}`
          // passes a string where the document publishes a number. A name the file never binds, and
          // a lookup INTO one, are still `untyped`. `inferArgumentType` is not consulted for either:
          // it answers `object`, which would report every argument written as a variable.
          const lookup =
            arg.value.type === NodeTypes.VariableLookup
              ? arg.value
              : arg.value.type === NodeTypes.LiquidVariable && arg.value.filters.length === 0
                ? arg.value.expression
                : undefined;

          const actualType =
            lookup?.type === NodeTypes.VariableLookup
              ? lookup.name && lookup.lookups.length === 0
                ? variables.typeAt(lookup.name, lookup.position.start, sources)
                : 'untyped'
              : inferArgumentType(arg.value, returnTypes);

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
