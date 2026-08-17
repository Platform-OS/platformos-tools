/**
 * Whether a multi-file request CONTRADICTS ITSELF, as opposed to merely being too
 * large.
 *
 * Separate from `batch-bounds.ts` because it asks a different question and needs a
 * different input: a cap is a pure function of the buffers' content, while deciding
 * whether two entries name the same file requires the project root to resolve
 * relative paths against.
 */
import { path as pathUtils } from '@platformos/platformos-check-common';

import { toAbsoluteFilePath } from '../adapter-input.js';
import type { Declined } from '../result/types.js';
import type { BufferToValidate } from './validate-buffers.js';

/**
 * A refusal when two or more entries resolve to the same file, else `undefined`.
 *
 * A REFUSAL AND NOT A MERGE. Results are keyed by the caller's own `filePath` STRING, but
 * buffers are overlaid and deduplicated by normalized URI, last entry winning — so when
 * several caller keys resolve to ONE uri they all read back that uri's offenses, and the
 * losing buffer is never linted while its entry carries the WINNER's verdict. Measured
 * before this guard existed: a broken buffer and a clean one under the same path returned
 * `ok` for both, and reversing the argument order flipped both to `error`.
 *
 * The whole request is refused rather than a winner picked, following `batchTooLarge`: the
 * incoherence is a property of the REQUEST. IDENTICAL CONTENT IS REFUSED TOO — merging
 * would be safe, but a rule with a content-equality carve-out is one more branch that can
 * be wrong.
 *
 * Collision is decided on the same normalized URI the overlay uses, so this guard cannot
 * disagree with the mechanism it protects.
 */
export function collidingBufferPaths(
  projectDir: string,
  buffers: readonly BufferToValidate[],
): Declined | undefined {
  const spellingsByFile = new Map<string, string[]>();

  for (const buffer of buffers) {
    const uri = pathUtils.normalize(
      pathUtils.URI.file(toAbsoluteFilePath(projectDir, buffer.filePath)),
    );
    const spellings = spellingsByFile.get(uri);
    if (spellings) spellings.push(buffer.filePath);
    else spellingsByFile.set(uri, [buffer.filePath]);
  }

  const collisions = [...spellingsByFile.values()].filter((spellings) => spellings.length > 1);
  if (collisions.length === 0) return undefined;

  const described = collisions
    .map((spellings) => spellings.map((spelling) => `\`${spelling}\``).join(' and '))
    .join('; ');

  return {
    code: 'internal_error',
    reason:
      `The same file appears more than once in this request: ${described}. A changeset cannot ` +
      `contain two versions of one file — validating it would mean checking one buffer and ` +
      `reporting its verdict for the other. Nothing was checked; send each file exactly once, ` +
      `with the content you intend to write.`,
  };
}
