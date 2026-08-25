import { LiquidCheckDefinition, Severity, SourceCodeType } from '../../types';
import { wellFormedFrontmatterBlock } from '../../frontmatter';

/**
 * A frontmatter key the file type's converter does not accept.
 *
 * Measured: the converter rejects the file — `Unknown properties: <key>.` from
 * `base_converter.rb`'s `check_unknown_keys` — failing the whole changeset.
 */
export const UnknownFrontmatterField: LiquidCheckDefinition = {
  meta: {
    code: 'UnknownFrontmatterField',
    name: 'Unknown Frontmatter Field',
    docs: {
      description:
        'Reports a frontmatter key that is not part of the schema for this file type. The deploy converter rejects the whole changeset for an unknown key.',
      recommended: true,
      url: 'https://documentation.platformos.com/developer-guide/platformos-check/checks/unknown-frontmatter-field',
    },
    type: SourceCodeType.LiquidHtml,
    severity: Severity.ERROR,
    schema: {},
    targets: [],
  },

  create(context) {
    return {
      async onCodePathStart(file) {
        const block = wellFormedFrontmatterBlock(context.file, context.fileType(file.uri));
        if (!block) return;

        for (const [key, entry] of block.entries) {
          if (key in block.schema.fields) continue;

          context.report({
            message: `Unknown frontmatter field '${key}' in ${block.schema.name} file`,
            startIndex: entry.absStart,
            endIndex: entry.absEnd,
          });
        }
      },
    };
  },
};
