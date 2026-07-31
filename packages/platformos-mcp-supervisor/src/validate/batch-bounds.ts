/**
 * Caps on a multi-file request.
 *
 * The per-buffer bound (`MAX_BUFFER_BYTES`) is not enough on its own: a batch is a
 * new way to hand the server unbounded work, and N individually-legal buffers add
 * up. At the measured ~61 ms/KiB, a request has to be bounded in total, not just
 * per file.
 */
import { MAX_BUFFER_BYTES } from '../adapter-input.js';
import type { Declined } from '../result/types.js';
import type { BufferToValidate } from './validate-buffers.js';

/**
 * Most files in one request.
 *
 * Far above any plausible single coherent edit. In practice the byte cap below binds
 * first for large files; this one exists so a request of thousands of tiny buffers
 * cannot turn into an unbounded number of per-file graph lookups.
 */
export const MAX_BATCH_FILES = 50;

/**
 * Most total bytes in one request.
 *
 * Set to four worst-case single buffers, so a batch can never cost more than a
 * handful of legal single calls. Without it, 50 files just under `MAX_BUFFER_BYTES`
 * would be ~6 MiB — minutes of parsing.
 */
export const MAX_BATCH_BYTES = 4 * MAX_BUFFER_BYTES;

/**
 * A refusal when the request exceeds its file-count or total-byte cap, else
 * `undefined`.
 *
 * Refuses the WHOLE request rather than trimming it: the cap is a property of the
 * request, so choosing which files to drop would be arbitrary, and silently
 * validating a subset would report a changeset as checked when it was not.
 */
export function batchTooLarge(buffers: readonly BufferToValidate[]): Declined | undefined {
  if (buffers.length > MAX_BATCH_FILES) {
    return {
      code: 'too_large',
      reason:
        `The request has ${buffers.length} files, above the ${MAX_BATCH_FILES} file limit. ` +
        `Nothing was checked — split it into smaller batches.`,
    };
  }

  const bytes = buffers.reduce(
    (total, buffer) => total + Buffer.byteLength(buffer.content, 'utf8'),
    0,
  );
  if (bytes > MAX_BATCH_BYTES) {
    return {
      code: 'too_large',
      reason:
        `The request totals ${Math.round(bytes / 1024)} KiB, above the ${Math.round(
          MAX_BATCH_BYTES / 1024,
        )} KiB limit. Validation costs about 61 ms per KiB, so checking this would take minutes. ` +
        `Nothing was checked — split it into smaller batches.`,
    };
  }

  return undefined;
}
