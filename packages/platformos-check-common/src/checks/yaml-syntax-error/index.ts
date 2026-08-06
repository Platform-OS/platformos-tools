import { Severity, SourceCodeType, YAMLCheckDefinition } from '../../types';
import { isError } from '../../utils';
import { YAMLConvertError } from '../../yaml/parse';

/**
 * Report YAML that does not parse.
 *
 * WHY THIS CHECK EXISTS. Every other source type this engine loads already had one
 * — `LiquidHTMLSyntaxError` for Liquid, `JSONSyntaxError` / `ValidJSON` for JSON —
 * and YAML did not. The parse failure was computed and stored on `file.ast` by
 * `toYAMLAST`, and then nothing ever read it. The only two YAML checks
 * (`MatchingTranslations`, `ValidHTMLTranslation`) are translation CONTENT checks,
 * and both bail on an unparseable document, so a malformed `.yml` produced no
 * diagnostic at all.
 *
 * That is the expensive kind of silence. Measured against a live instance, every
 * one of the four YAML file types the linter admits — model / custom model types,
 * transactable types, instance profile types and translations — returned a clean
 * result for genuinely invalid YAML, while `pos-cli deploy --dry-run` REJECTED the
 * same file. A converter rejection fails the WHOLE changeset, not just the file
 * that caused it, so an agent told "nothing to fix" here takes every other file in
 * the deploy down with it.
 *
 * SYNTAX ONLY, DELIBERATELY. Semantic defects were probed separately against the
 * converter and it accepts them: an unknown property `type:`, and duplicate
 * property names, both deploy fine. So the entire cost of the gap is parseability,
 * and a schema model would be work with no measured payoff. If that changes, it is
 * a different check — this one answers "does this file parse?" and nothing else.
 *
 * THAT IS EXACTLY WHAT HAPPENED WITH DUPLICATE KEYS, and the split held. A repeated
 * key still deploys, so it is still not a syntax error and still not reported here —
 * but the platform keeps the LAST value, so an earlier one is silently discarded.
 * `DuplicateYAMLKey` reports that, as a WARNING and outside `BLOCKING_CHECKS`, which
 * is what keeps a semantic finding off the write gate this check sits on.
 *
 * THAT PARAGRAPH IS ENFORCED, not merely asserted — see `duplicate-keys.spec.ts`. It
 * was true and untested for one release, during which the `yaml` package's
 * `uniqueKeys` default quietly turned a duplicated name into a hard refusal to write,
 * with this comment and the server's agent-facing instructions both still promising
 * the opposite. A claim about what a check does NOT report needs a test exactly as
 * much as a claim about what it does.
 *
 * REPORTS EVERY FAILURE, not just the first, matching `JSONSyntaxError`. The `yaml`
 * parser recovers and keeps going, so a document can carry several independent
 * problems. Measured on realistic malformations (bad indent under a sequence item,
 * unclosed flow sequence, tab indentation, unterminated quote, misaligned sequence)
 * the count is exactly one each; the multi-error case needs deliberately mangled
 * input. Truncating to the first would hide genuinely separate errors to guard
 * against a volume that does not occur.
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
