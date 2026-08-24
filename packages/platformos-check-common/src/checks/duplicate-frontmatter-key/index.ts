import { wellFormedFrontmatterBlock } from '@platformos/platformos-common';
import { LiquidCheckDefinition, Severity, SourceCodeType } from '../../types';
import { getPosition } from '../../utils/position';
import { findDuplicateKeys } from '../../yaml/duplicate-keys';

/**
 * Report a frontmatter key defined more than once, whose earlier value is silently discarded.
 *
 * THE LIQUID-SIDE SIBLING OF `DuplicateYAMLKey`, which is `SourceCodeType.YAML` and so never
 * sees a `.liquid` file — the same structural gap `InvalidFrontmatterSyntax` fills for
 * `YAMLSyntaxError`. Everything that check argues applies here unchanged, so this one adds no
 * judgement of its own: WARNING rather than error because the platform accepts the file, and
 * rather than info because silent data loss is not a style preference; the range is the
 * DISCARDED entry, because the later occurrence is the one that wins and pointing at it would
 * invite the author to delete the value they still have.
 *
 * MEASURED, by syncing a page whose `slug` was declared twice: it synced without error, the
 * first slug 404s and the second serves. The platform parses frontmatter with `SafeYAML.load`
 * (Psych), which has no uniqueness rule at all.
 *
 * KEY IDENTITY IS NOT DECIDED HERE. `findDuplicateKeys` reconciles npm `yaml` (1.2) with Psych
 * (1.1) against an oracle generated from a live Ruby — `yes:` and `true:` are ONE key to the
 * platform, `1:` and `1.0:` are TWO — and re-deriving any of that would manufacture false
 * positives on legal input.
 */
export const DuplicateFrontmatterKey: LiquidCheckDefinition = {
  meta: {
    code: 'DuplicateFrontmatterKey',
    name: 'Duplicate frontmatter key',
    docs: {
      description:
        'Reports a frontmatter key that is defined more than once. The file deploys and the last value wins, so the earlier value is silently discarded.',
      recommended: true,
      url: 'https://documentation.platformos.com/developer-guide/platformos-check/checks/duplicate-frontmatter-key',
    },
    type: SourceCodeType.LiquidHtml,
    severity: Severity.WARNING,
    schema: {},
    targets: [],
  },

  create(context) {
    return {
      async onCodePathStart(file) {
        // A block that does not parse belongs to `InvalidFrontmatterSyntax` alone: a second
        // opinion on it is noise, and the offsets would be untrustworthy besides. A repeated
        // key does NOT make a block unparseable — that is the whole point.
        const block = wellFormedFrontmatterBlock(context.file, context.fileType(file.uri));
        if (!block) return;

        for (const duplicate of findDuplicateKeys(block.body)) {
          // `findDuplicateKeys` reports into the string it was given, so every offset is
          // shifted by where that string starts in the `.liquid` file.
          const discardedStart = block.bodyOffset + duplicate.discardedStart;
          const survivorIndex = block.bodyOffset + duplicate.survivorStart;

          // 1-based, matching what an editor shows and the `line` the MCP surface reports.
          const survivorLine = getPosition(file.source, survivorIndex).line + 1;

          context.report({
            message:
              `Duplicate frontmatter key '${duplicate.key}': this value is discarded because ` +
              `the same key is defined again on line ${survivorLine}, and the platform keeps ` +
              `the last one.`,
            startIndex: discardedStart,
            endIndex: block.bodyOffset + duplicate.discardedEnd,
          });
        }
      },
    };
  },
};
