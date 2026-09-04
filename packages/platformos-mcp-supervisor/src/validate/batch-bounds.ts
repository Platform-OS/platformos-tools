/**
 * Caps on a multi-file request.
 *
 * The per-buffer bound (`MAX_BUFFER_BYTES`) is not enough on its own: a batch is a
 * new way to hand the server unbounded work, and N individually-legal buffers add
 * up. At the measured `LINT_MS_PER_KIB`, a request has to be bounded in total, not
 * just per file.
 */
import { LINT_MS_PER_KIB, MAX_LINT_DEADLINE_MS, maxBytesWithin } from '../cost-model.js';
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
 * DERIVED, not chosen: the largest request whose scaled deadline still fits inside the
 * ceiling the server is willing to wait (see `cost-model.ts`). Without any cap, 50 files
 * just under `MAX_BUFFER_BYTES` would be ~6 MiB — minutes of parsing.
 *
 * A round multiple of `MAX_BUFFER_BYTES` inherits none of that reasoning and drifts the
 * moment throughput moves, admitting a batch that cannot finish inside its deadline — and
 * every file in such a request comes back `timed_out`, unchecked and silently. Deriving it
 * means a change to the cost model moves this too; `cost-model.spec.ts` fails if the
 * arithmetic stops fitting. The worst legal batch measures ~10 s against the deadline it
 * earns; re-run `scripts/measure-lint-cost.mjs` to check the margin.
 */
export const MAX_BATCH_BYTES = maxBytesWithin(MAX_LINT_DEADLINE_MS);

/**
 * A refusal when the request exceeds its file-count or total-byte cap, else
 * `undefined`.
 *
 * Refuses the WHOLE request rather than trimming it: the cap is a property of the
 * request, so choosing which files to drop would be arbitrary, and silently
 * validating a subset would report a changeset as checked when it was not.
 */
export function batchTooLarge(buffers: readonly BufferToValidate[]): Declined | undefined {
  // UNREACHABLE OVER MCP — `VALIDATE_CODE_INPUT.files` caps the array with
  // `.max(MAX_BATCH_FILES)` first, and `runValidateCode` is not on the package's public
  // surface — so zero coverage here is the schema working, not a gap. Kept as defence-in-depth
  // because only this bound lives inside the function that promises it, and asked FIRST
  // because splitting a request by bytes can still leave too many files.
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
        )} KiB limit. Validation costs about ${LINT_MS_PER_KIB} ms per KiB, so checking this ` +
        `would take longer than this server will wait. Nothing was checked — split it into ` +
        `smaller batches.`,
    };
  }

  return undefined;
}
