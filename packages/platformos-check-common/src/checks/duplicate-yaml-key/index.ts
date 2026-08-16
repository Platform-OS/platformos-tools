import { Severity, SourceCodeType, YAMLCheckDefinition } from '../../types';
import { isError } from '../../utils';
import { getPosition } from '../../utils/position';
import { findDuplicateKeys } from '../../yaml/duplicate-keys';

/**
 * Report a YAML key defined more than once, whose earlier value is silently discarded.
 *
 * NOT A DEPLOYABILITY QUESTION, AND IT MUST NEVER BLOCK. `pos-cli deploy --dry-run` accepts a
 * repeated key and the platform resolves it last-wins, so the file works. Two independent
 * things keep it off the write gate: the severity below, and `blocksWrite`, which requires
 * severity `error` AND membership of `BLOCKING_CHECKS`.
 *
 * A WARNING, NOT AN ERROR OR AN INFO. The precedent is `DuplicateRenderPartialArguments` — the
 * same defect one level up, a duplicate the runtime tolerates while discarding a value, and it
 * is a WARNING. Against ERROR: the platform accepts the file. Against INFO: this is silent DATA
 * LOSS, not a style preference, and nothing else in the system will ever say so.
 *
 * The distinction from the false-block failures this linter has paid for is that the input
 * there was legal AND INTENDED. A key written twice is legal and essentially never intended —
 * a typo or a bad merge, every time.
 *
 * A SEPARATE CHECK from `YAMLSyntaxError`, which answers "does this file parse" and is in
 * `BLOCKING_CHECKS`; adding a semantic finding to it would put this on the write gate.
 *
 * THE RANGE IS THE DISCARDED ENTRY, not the duplicate — a deliberate departure from
 * `DuplicateRenderPartialArguments`, which anchors on the later occurrence. Here the later
 * occurrence is the one that WINS (measured), so highlighting it would point the author at the
 * working value and invite them to delete it.
 */
export const DuplicateYAMLKey: YAMLCheckDefinition = {
  meta: {
    code: 'DuplicateYAMLKey',
    name: 'Duplicate YAML key',
    docs: {
      description:
        'Reports a YAML key that is defined more than once in the same mapping. The file deploys and the last value wins, so the earlier value is silently discarded.',
      recommended: true,
      url: 'https://documentation.platformos.com/developer-guide/platformos-check/checks/duplicate-yaml-key',
    },
    type: SourceCodeType.YAML,
    severity: Severity.WARNING,
    schema: {},
    targets: [],
  },

  create(context) {
    return {
      // `onCodePathStart`, matching `YAMLSyntaxError`: there is no tree to walk, and the
      // shared JSON node model cannot answer this question anyway — it is built through
      // `toJS`, which has already resolved the duplicate away by the time a visitor
      // could see it. The duplicate only exists in the YAML document itself.
      async onCodePathStart(file) {
        // An unparseable file belongs to `YAMLSyntaxError` alone. Reporting a second
        // opinion on a document that does not parse adds noise to a result the author
        // already has to act on, and the offsets would be untrustworthy besides.
        if (isError(file.ast)) return;

        for (const duplicate of findDuplicateKeys(file.source)) {
          // 1-based, because that is what an editor shows and what the MCP surface
          // reports in its sibling `line` field (`offense.start.line + 1`). A message
          // that disagreed with the number next to it would be worse than no number.
          const survivorLine = getPosition(file.source, duplicate.survivorStart).line + 1;

          context.report({
            message:
              `Duplicate key '${duplicate.key}': this value is discarded because the same key is ` +
              `defined again on line ${survivorLine}, and the platform keeps the last one.`,
            startIndex: duplicate.discardedStart,
            endIndex: duplicate.discardedEnd,
          });
        }
      },
    };
  },
};
