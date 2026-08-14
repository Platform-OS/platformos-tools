import { LiquidCheckDefinition, Severity, SourceCodeType } from '../../types';
import { getValidParamTypes, parseParamType } from '../../liquid-doc/utils';

export const ValidDocParamTypes: LiquidCheckDefinition = {
  meta: {
    code: 'ValidDocParamTypes',
    name: 'Valid doc parameter types',
    docs: {
      description:
        'This check exists to ensure any parameter types defined in the `doc` tag are valid.',
      recommended: true,
      url: 'https://documentation.platformos.com/developer-guide/platformos-check/checks/valid-doc-param-types',
    },
    type: SourceCodeType.LiquidHtml,
    severity: Severity.ERROR,
    schema: {},
    targets: [],
  },

  create(context) {
    if (!context.platformosDocset) {
      return {};
    }

    const docset = context.platformosDocset;

    // To avoid recalculating valid param types during platformos-check, constructing
    // the promise beforehand.
    //
    // `undefined` when the docset publishes no `param_types`, and then this check reports NOTHING.
    // That is the same silence an unpublished filter arity gets, and here it is the only safe answer:
    // the set of valid types would otherwise be the object names alone, and every `@param {string}` in
    // the project would be reported as unsupported by a docset that simply predates the vocabulary.
    const validParamTypesPromise = Promise.all([docset.liquidDoc(), docset.liquidDrops()]).then(
      ([vocabulary, drops]) => {
        const types = getValidParamTypes(vocabulary.param_types, drops);

        return types && new Set(types.keys());
      },
    );

    return {
      async LiquidDocParamNode(node) {
        if (!node.paramType) {
          return;
        }

        const validParamTypes = await validParamTypesPromise;

        if (!validParamTypes) {
          return;
        }

        const parsedParamType = parseParamType(validParamTypes, node.paramType.value);

        if (parsedParamType) {
          return;
        }

        context.report({
          message: `The parameter type '${node.paramType.value}' is not supported.`,
          // Index is offset to include the curly brackets around the param type
          startIndex: node.paramType.position.start - 1,
          endIndex: node.paramType.position.end + 1,
          suggest: [
            {
              message: 'Remove invalid parameter type',
              fix: (corrector) => {
                if (!node.paramType) return;

                corrector.replace(
                  node.position.start,
                  node.position.end,
                  node.source.slice(node.position.start, node.position.end).replace(
                    // We could have padded spaces around + inside the param type
                    // e.g. `{ string }`, `{string}`, or ` { string } `
                    /\s*\{\s*[^\s]+\s*\}\s*/,
                    ' ',
                  ),
                );
              },
            },
          ],
        });
      },
    };
  },
};
