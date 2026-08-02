import { LiquidDocParamNode, Position } from '@platformos/liquid-html-parser';
import { LiquidCheckDefinition, Severity, SourceCodeType } from '../../types';
import { fileTypeSupportsLiquidDoc } from '../../liquid-doc/utils';
import { partialInputs } from '../../liquid-doc/partial-inputs';

export const MissingDocParam: LiquidCheckDefinition = {
  meta: {
    code: 'MissingDocParam',
    name: 'Missing doc parameter',
    docs: {
      description:
        'This check exists to ensure every input a partial reads from its caller is declared in its `doc` tag. The mirror of `UnusedDocParam`: a parameter the doc declares and the partial never uses, against a parameter the partial uses and the doc never declares.',
      recommended: true,
      url: 'https://documentation.platformos.com/developer-guide/platformos-check/checks/missing-doc-param',
    },
    type: SourceCodeType.LiquidHtml,
    severity: Severity.ERROR,
    schema: {},
    targets: [],
  },

  create(context) {
    // `{% doc %}` applies to partials and to nothing else, so no other file can drift from
    // one. Asking the file for the type it classified once, never re-deriving it from a URI.
    if (!fileTypeSupportsLiquidDoc(context.fileType())) return {};

    const declaredParams: Set<string> = new Set();
    /** Where each name is first read, so a name used ten times is reported once, at the top. */
    const firstUse: Map<string, Position> = new Map();
    let lastParam: LiquidDocParamNode | undefined;

    return {
      async LiquidDocParamNode(node) {
        declaredParams.add(node.paramName.value);
        lastParam = node;
      },

      async VariableLookup(node) {
        if (node.name && !firstUse.has(node.name)) firstUse.set(node.name, node.position);
      },

      async onCodePathEnd() {
        // A partial whose doc declares no parameter declares no contract, and the call-site
        // checks fall back to inferring one from this same analysis (`PartialCallArguments`).
        // Nothing can have drifted, so a doc holding only an `@description` — or no doc at
        // all — is not this check's business.
        const declaredLast = lastParam;
        if (!declaredLast) return;

        const { required, optional, defined } = await partialInputs(context);
        const inputs = new Set([...required, ...optional]);
        const definedSomewhere = new Set(defined);

        const undeclared = [...firstUse]
          .filter(
            ([name]) =>
              inputs.has(name) && !declaredParams.has(name) && !definedSomewhere.has(name),
          )
          .sort(([, a], [, b]) => a.start - b.start);

        for (const [name, position] of undeclared) {
          context.report({
            message: `The parameter '${name}' is used but not declared in the doc tag of this file.`,
            startIndex: position.start,
            endIndex: position.end,
            suggest: [
              {
                message: `Declare '${name}' in the doc tag`,
                fix: (corrector) =>
                  corrector.insert(
                    declaredLast.position.end,
                    `\n${indentationOfLineAt(declaredLast.position.start)}@param ${name}`,
                  ),
              },
            ],
          });
        }
      },
    };

    /**
     * The whitespace the line holding `index` opens with, so an inserted `@param` lines up
     * with the ones already declared. Ask with a position INSIDE the line: a `lastIndexOf`
     * that starts on the newline ending the line finds that newline and answers for the
     * next one.
     *
     * No type is emitted with the declaration: nothing at a READ of a variable says what a
     * caller should pass, and a guessed `{string}` would be a claim `ValidDocParamTypes` and
     * the type-mismatch checks then act on.
     */
    function indentationOfLineAt(index: number): string {
      const lineStart = context.file.source.lastIndexOf('\n', index) + 1;
      return context.file.source.slice(lineStart).match(/^[ \t]*/)?.[0] ?? '';
    }
  },
};
