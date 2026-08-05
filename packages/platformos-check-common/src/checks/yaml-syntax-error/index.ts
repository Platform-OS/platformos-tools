import { Severity, SourceCodeType, YAMLCheckDefinition } from '../../types';
import { yamlProblems } from '../../yaml/parse';

/**
 * What the YAML parser complained about, reported on the file that has it.
 *
 * The counterpart to `LiquidHTMLSyntaxError`, and until now the missing one: a YAML
 * source drew NO diagnostic however broken it was, while every reader in the toolchain
 * quietly declined to use it. A duplicated mapping key — two translators adding the same
 * key — is the case that made this expensive: `TranslationProvider` reads such a file
 * last-wins now, but the checks still skip it, so without this the author is told nothing
 * about a translation the file silently lost.
 */
export const YAMLSyntaxError: YAMLCheckDefinition = {
  meta: {
    code: 'YAMLSyntaxError',
    name: 'Prevent YAML syntax errors',
    docs: {
      description:
        'Reports what the YAML parser could not read, or read only by choosing between ' +
        'two values for the same key. A file with any of these is not key-checked by the ' +
        'other YAML checks, so this is the only thing that reports it.',
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
      async onCodePathStart(file) {
        // Parsed here rather than read off `file.ast`, which keeps only the AST: the
        // problems are per-position and there may be several, and a YAML source is a
        // handful of files per project where a Liquid one is thousands.
        for (const problem of yamlProblems(file.source)) {
          context.report(problem);
        }
      },
    };
  },
};
