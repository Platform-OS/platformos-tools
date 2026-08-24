import { Severity, SourceCodeType, YAMLCheckDefinition } from '../../types';
import { isError } from '../../utils';
import { YAMLConvertError } from '../../yaml/parse';

/**
 * Report YAML that does not parse.
 *
 * WHY THIS CHECK EXISTS. Every other source type this engine loads already had one, and YAML
 * did not: the parse failure was computed and stored on `file.ast` by `toYAMLAST`, and then
 * nothing ever read it. The only two YAML checks are translation CONTENT checks and both bail
 * on an unparseable document, so a malformed `.yml` produced no diagnostic at all.
 *
 * That is the expensive kind of silence. Measured against a live instance, every one of the
 * four admitted YAML file types returned a clean result for genuinely invalid YAML while
 * `pos-cli deploy --dry-run` REJECTED the same file — and a converter rejection fails the WHOLE
 * changeset.
 *
 * SYNTAX ONLY, DELIBERATELY — and that used to rest on a claim a real deploy disproved. An
 * unknown property `type:` is REJECTED (`InvalidSchemaPropertyType` reports it now); so is an
 * unknown top-level key, which nothing reports yet. `--dry-run` accepts both, returning before
 * the nested converter that validates them. Duplicate property names ARE accepted, measured.
 *
 * DUPLICATE KEYS ARE THE WORKED EXAMPLE of that split. A repeated key still deploys, so it is
 * not reported here — but the platform keeps the LAST value, so an earlier one is silently
 * discarded, and `DuplicateYAMLKey` reports that as a WARNING outside `BLOCKING_CHECKS`.
 *
 * THAT PARAGRAPH IS ENFORCED, not merely asserted — see `index.spec.ts`. It was true and
 * untested for one release, during which the `yaml` package's `uniqueKeys` default quietly
 * turned a duplicated name into a hard refusal to write. A claim about what a check does NOT
 * report needs a test exactly as much as a claim about what it does.
 *
 * REPORTS EVERY FAILURE, not just the first, matching `JSONSyntaxError`: the `yaml` parser
 * recovers and keeps going, so a document can carry several independent problems. Measured on
 * realistic malformations the count is exactly one each, so truncating to the first would hide
 * genuinely separate errors to guard against a volume that does not occur.
 */
export const YAMLSyntaxError: YAMLCheckDefinition = {
  meta: {
    code: 'YAMLSyntaxError',
    name: 'Enforce valid YAML',
    docs: {
      description:
        'Reports YAML the parser cannot read. A file with a parse failure is not ' +
        'key-checked by the other YAML checks, so this is the only thing that reports it.',
      recommended: true,
      url: 'https://documentation.platformos.com/developer-guide/platformos-check/checks/yaml-syntax-error',
    },
    type: SourceCodeType.YAML,
    severity: Severity.ERROR,
    schema: {},
    targets: [],
  },

  create(context) {
    return {
      // `onCodePathStart`, not a node visitor: there is no tree to walk. `checkYAMLFile`
      // runs this hook BEFORE it returns on an unparseable document, which is the same
      // seam `JSONSyntaxError` uses and the only point at which a failed parse is
      // still observable.
      async onCodePathStart(file) {
        const ast = file.ast;
        if (!isError(ast)) return;

        if (ast instanceof YAMLConvertError) {
          for (const failure of ast.failures) {
            context.report({
              message: failure.message,
              startIndex: failure.offset,
              endIndex: failure.offset + failure.length,
            });
          }
          return;
        }

        // Not a parse failure but a conversion one — the document parsed and then
        // could not be mapped to the shared JSON node model. There is no position to
        // attribute it to, so the range is the file: still unusable, still reported,
        // never silent.
        context.report({
          message: ast.message,
          startIndex: 0,
          endIndex: file.source.length,
        });
      },
    };
  },
};
