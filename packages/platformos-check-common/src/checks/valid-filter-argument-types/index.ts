import {
  ComplexLiquidExpression,
  LiquidNamedArgument,
  LiquidVariable,
  NodeTypes,
} from '@platformos/liquid-html-parser';

import { generateTypeMismatchSuggestions } from '../../liquid-doc/arguments';
import { inferArgumentType, isNullLiteral } from '../../liquid-doc/utils';
import {
  FilterParameter,
  LiquidType,
  filterParameterTypes,
  filterReturnTypes,
  filterTypesAreContracts,
  isFilterArgumentCompatible,
} from '../../liquid-types';
import { LiquidCheckDefinition, Severity, SourceCodeType } from '../../types';

/**
 * The filter counterpart of `ValidTagArgumentTypes`. `inferArgumentType` reads the value and the
 * return types that resolve a chain come from the same docset map, so there is no second inference
 * path — but the COMPATIBILITY rule is its own, {@link isFilterArgumentCompatible}, because `object`
 * does not mean the same thing in a filter's document as in a `{% doc %}` block: there it is "some
 * structured value" and here it is a Hash, which `{{ [] | hash_add_key: 'k', v }}` raising proves.
 *
 * WHAT IT CATCHES is the piped value as much as the written arguments, because `filters.json`
 * publishes the input as parameter 0 and the platform's own filters refuse a wrong one outright:
 * `{{ 123 | hash_add_key: 'hello', 'world' }}` raises `hash_add_key filter - first argument must be
 * a hash, received: 123` and takes the whole page with it — measured against a live instance, which
 * is also where the silences below were measured rather than assumed.
 *
 * WHAT IT MUST NOT DO is read a published type as a contract when it is not one. Two of those, both
 * settled in the document rather than here:
 *
 * - A docset from before the platform separated `object` (a Hash) from `untyped` (several types
 *   accepted) cannot tell the two apart, and this check is silent on one entirely — see
 *   {@link filterTypesAreContracts}. It was 1,279 offenses on working code, none real.
 * - Core Liquid's filters COERCE rather than refuse — `{{ 5 | upcase }}`, `{{ '5' | minus: 1 }}` and
 *   `{{ 'abc' | where: 'x', 1 }}` all render — so every one of their parameters is published
 *   `untyped` and nothing is reported about them. That is upstream's statement, not a category this
 *   check knows about; a filter that starts refusing would say so by publishing a type.
 */
export const ValidFilterArgumentTypes: LiquidCheckDefinition = {
  meta: {
    code: 'ValidFilterArgumentTypes',
    name: 'Valid Filter Argument Types',
    docs: {
      description:
        'This check ensures that the values passed to a Liquid filter — the piped value included — have the types the platformOS documentation publishes for them.',
      recommended: true,
      url: 'https://documentation.platformos.com/developer-guide/platformos-check/checks/valid-filter-argument-types',
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
      async LiquidVariable(node) {
        if (node.filters.length === 0) return;

        const filters = await platformosDocset.filters();
        if (!filterTypesAreContracts(filters)) return;

        const parametersByFilter = filterParameterTypes(filters);
        const returnTypes = filterReturnTypes(filters);

        node.filters.forEach((filter, index) => {
          const parameters = parametersByFilter.get(filter.name);
          if (!parameters?.length) return;

          const [input, ...rest] = parameters;

          reportInput(input);
          reportArguments(rest);

          /**
           * The piped value, which is parameter 0.
           *
           * A filter EARLIER in the chain decides it from here on — `{{ x | to_time | strftime: f }}`
           * pipes a `time` into `strftime` whatever `x` is — and only the immediately preceding one,
           * because each is input to the next.
           */
          function reportInput(parameter: FilterParameter) {
            const value = index === 0 ? node.expression : undefined;

            const actualType =
              value === undefined
                ? (returnTypes.get(node.filters[index - 1].name) ?? 'untyped')
                : typeOfValue(value, returnTypes);

            // The whole chain is anchored on a name, so there is no position for "the piped value"
            // other than the filter itself — and the filter is what the reader has to change.
            report(parameter, actualType, filter.position.start + 1, filter.position.end, true);
          }

          /** The arguments the author WROTE, matched to parameters the way the runtime matches them. */
          function reportArguments(remaining: readonly FilterParameter[]) {
            const positional = remaining.filter((parameter) => parameter.positional);
            let next = 0;

            for (const arg of filter.args) {
              if (arg.type === NodeTypes.NamedArgument) {
                const parameter = remaining.find((candidate) => candidate.name === arg.name);
                // The VALUE's position, not the pair's: the suggestion replaces what it points at, and
                // anchoring on `precision: 'two'` made "replace with 0" delete the name as well.
                if (parameter) reportValue(parameter, arg.value, arg.value);
                continue;
              }

              const parameter = positional[next];
              next += 1;
              if (parameter) reportValue(parameter, arg, arg);
            }
          }

          function reportValue(
            parameter: FilterParameter,
            value: WrittenValue,
            at: { position: { start: number; end: number } },
          ) {
            // A VARIADIC parameter's type describes the collection it gathers; each argument written
            // here is an element of it, and the document publishes no element type.
            if (parameter.variadic) return;

            report(
              parameter,
              typeOfValue(value, returnTypes),
              at.position.start,
              at.position.end,
              false,
            );
          }

          function report(
            parameter: FilterParameter,
            actualType: LiquidType,
            startIndex: number,
            endIndex: number,
            isInput: boolean,
          ) {
            const [expected] = parameter.types;
            if (expected === 'untyped' || actualType === 'untyped') return;
            // A parameter may accept SEVERAL types, and then a value is only wrong when it matches
            // none of them — `strftime` takes a string, a number of seconds, a Date or a Time.
            if (parameter.types.some((type) => isFilterArgumentCompatible(type, actualType)))
              return;

            const subject = isInput
              ? `the value piped into '${filter.name}'`
              : `argument '${parameter.name}' of '${filter.name}'`;

            context.report({
              message:
                `Type mismatch for ${subject}: expected ${describe(parameter.types)}, got ${actualType}. ` +
                `platformOS raises Liquid::ArgumentError at render time.`,
              startIndex,
              endIndex,
              // Replacing the piped value is not a fix this check can write — the value is upstream of
              // the filter and often a whole expression — so only a written argument gets suggestions.
              // The FIRST type is the one a default is offered for: the document orders a union with
              // the typical type in front, which is the one an author most likely meant to write.
              suggest: isInput
                ? undefined
                : generateTypeMismatchSuggestions(expected, startIndex, endIndex),
            });
          }
        });
      },
    };
  },
};

/**
 * What a written value holds, or `untyped` when nothing can be said about it.
 *
 * A BARE variable lookup is `untyped` here, not `object`: there is no symbol table at a filter call,
 * so `{{ maybe_a_hash | hash_keys }}` says nothing about what `maybe_a_hash` holds. `inferArgumentType`
 * answers `object` for one, which is the right answer for a `@param {object}` in a `{% doc %}` block
 * and the wrong one here — it would report every `{{ x | upcase }}` in the codebase.
 *
 * A FILTERED one does resolve, from the last filter's published return type, which does not depend on
 * its input. The same line `findTypeMismatchParams` and `ValidTagArgumentTypes` draw.
 */
/** Anything that can stand where a filter argument or a piped value stands. */
type WrittenValue = ComplexLiquidExpression | LiquidVariable | LiquidNamedArgument;

/** The accepted types as a reader would say them: `string`, or `string, number or time`. */
function describe(types: readonly LiquidType[]): string {
  if (types.length === 1) return types[0];

  return `${types.slice(0, -1).join(', ')} or ${types[types.length - 1]}`;
}

function typeOfValue(
  value: WrittenValue,
  returnTypes: ReadonlyMap<string, LiquidType>,
): LiquidType {
  // A hash pair nested inside another argument is a structure, not a value.
  if (value.type === NodeTypes.NamedArgument) return 'untyped';

  // A comparison. `inferArgumentType` answers `object` for one — conservatively, so that a
  // `{% doc %}` `@param {object}` keeps being accepted — and that is not an answer to use here.
  if (value.type === NodeTypes.BooleanExpression) return 'untyped';

  // nil is compatible with every type — it is "no value", not a wrong one.
  if (isNullLiteral(value)) return 'untyped';

  if (value.type === NodeTypes.LiquidVariable) {
    if (value.filters.length === 0 && value.expression.type === NodeTypes.VariableLookup) {
      return 'untyped';
    }
  } else if (value.type === NodeTypes.VariableLookup) {
    return 'untyped';
  }

  return inferArgumentType(value, returnTypes);
}
