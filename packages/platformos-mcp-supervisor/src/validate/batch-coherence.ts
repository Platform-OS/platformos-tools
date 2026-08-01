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
 * WHY THIS IS A REFUSAL AND NOT A MERGE. Results are keyed by the caller's own
 * `filePath` STRING (deliberately — a caller mixing relative and absolute spellings
 * must be able to find its own entries without reproducing our normalization), but
 * buffers are overlaid and deduplicated by normalized URI, last entry winning. When
 * several caller keys resolve to ONE uri, they all read back that single uri's
 * offenses. The result: the losing buffer's content is never linted, and its entry
 * is reported carrying the WINNER's verdict.
 *
 * Measured before this guard existed — a broken buffer and a clean one under the
 * same path returned `status: "ok"` for both, and reversing the argument order
 * flipped it to `"error"` for both. So the answer depended on argument order, and in
 * one of the two orders a file that was never checked came back clean. That is the
 * one false approval in this server that no amount of gate calibration could
 * recover, because nothing about it involves a check at all.
 *
 * Refusing the whole request rather than picking a winner follows `batchTooLarge`:
 * the incoherence is a property of the REQUEST, so choosing which buffer to honour
 * would be arbitrary, and validating one while reporting for both is exactly the
 * defect. A changeset cannot contain two versions of one file.
 *
 * IDENTICAL CONTENT IS REFUSED TOO. It would be safe to merge, but "same path twice"
 * is a caller bug either way, and a rule with a content-equality carve-out is one
 * more branch that can be wrong. One spelling per file, always.
 *
 * Collision is decided on the same normalized URI the overlay uses, so this guard
 * cannot disagree with the mechanism it protects.
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
