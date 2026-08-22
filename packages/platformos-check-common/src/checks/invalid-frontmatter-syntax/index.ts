import { LiquidCheckDefinition, Severity, SourceCodeType } from '../../types';
import { frontmatterBlock } from '../../frontmatter/extract';

/**
 * YAML inside a frontmatter block that does not parse.
 *
 * Measured: the converter rejects the file — `Body contains invalid YAML: found a tab
 * character that violates indentation` — failing the whole changeset.
 *
 * `YAMLSyntaxError` cannot cover this: it declares `SourceCodeType.YAML` and the engine runs
 * a check only against files of its own type, so a `.liquid` file never reaches it.
 *
 * The linter reads YAML 1.2 (npm `yaml`) and the platform reads YAML 1.1 (Ruby Psych). Both
 * refuse a tab and an unclosed flow collection, but the dialects are not the same parser, so
 * messages come from ours rather than being written to match theirs.
 */
export const InvalidFrontmatterSyntax: LiquidCheckDefinition = {
  meta: {
    code: 'InvalidFrontmatterSyntax',
    name: 'Invalid Frontmatter Syntax',
    docs: {
      description:
        'Reports YAML in a frontmatter block that cannot be parsed. The deploy converter rejects the whole changeset for a block it cannot read.',
      recommended: true,
      url: 'https://documentation.platformos.com/developer-guide/platformos-check/checks/invalid-frontmatter-syntax',
    },
    type: SourceCodeType.LiquidHtml,
    severity: Severity.ERROR,
    schema: {},
    targets: [],
  },

  create(context) {
    return {
      async onCodePathStart(file) {
        const block = frontmatterBlock(file, context.fileType(file.uri));
        if (!block) return;

        for (const failure of block.syntaxErrors) {
          context.report(failure);
        }
      },
    };
  },
};
