import { describe, expect, it } from 'vitest';

import { MAX_BATCH_BYTES, MAX_BATCH_FILES, batchTooLarge } from './batch-bounds.js';
import type { BufferToValidate } from './validate-buffers.js';

/**
 * The request-level caps, tested directly. `validate-code.spec.ts` reaches them only
 * incidentally, which left both boundaries unpinned.
 *
 * Refusal prose is not asserted: `batchTooLarge` is the subject here, so restating its own
 * sentence would prove only that it was copied correctly.
 */

const buffer = (index: number, content: string): BufferToValidate => ({
  filePath: `app/views/pages/p${index}.liquid`,
  content,
});

/** Total bytes, by the same measure the cap bills. */
const bytesOf = (buffers: readonly BufferToValidate[]): number =>
  buffers.reduce((total, entry) => total + Buffer.byteLength(entry.content, 'utf8'), 0);

/** Buffers totalling EXACTLY `bytes`, split in two — these caps only run above one buffer. */
const totalling = (bytes: number): BufferToValidate[] => {
  const second = Math.floor(bytes / 2);
  return [buffer(0, 'a'.repeat(bytes - second)), buffer(1, 'a'.repeat(second))];
};

/** `count` buffers of one byte each, so nothing but the file count can refuse them. */
const tinyFiles = (count: number): BufferToValidate[] =>
  Array.from({ length: count }, (_, index) => buffer(index, 'x'));

describe('Unit: batchTooLarge', () => {
  describe('the total-byte cap', () => {
    it('ADMITS a request totalling exactly MAX_BATCH_BYTES', () => {
      // Inclusive boundary, matching `bufferTooLarge`'s. The measured total rides along so a
      // drifting fixture cannot quietly weaken this into "comfortably under the cap".
      const buffers = totalling(MAX_BATCH_BYTES);

      expect({ total: bytesOf(buffers), refusal: batchTooLarge(buffers) }).toEqual({
        total: MAX_BATCH_BYTES,
        refusal: undefined,
      });
    });

    it('REFUSES a request one byte over MAX_BATCH_BYTES', () => {
      const buffers = totalling(MAX_BATCH_BYTES + 1);

      expect({ total: bytesOf(buffers), refusal: batchTooLarge(buffers)?.code }).toEqual({
        total: MAX_BATCH_BYTES + 1,
        refusal: 'too_large',
      });
    });

    it('counts BYTES, not string length, so multi-byte content cannot slip past', () => {
      // '€' is 3 bytes, so a `content.length` cap would admit three times the intended size —
      // and every file in a request that big comes back `timed_out`, unchecked.
      const perBuffer = Math.floor(MAX_BATCH_BYTES / 6) + 1;
      const buffers = [buffer(0, '€'.repeat(perBuffer)), buffer(1, '€'.repeat(perBuffer))];
      const characters = buffers.reduce((total, entry) => total + entry.content.length, 0);

      expect({
        aLengthCapWouldAdmitIt: characters <= MAX_BATCH_BYTES,
        theByteCapDoesNot: bytesOf(buffers) > MAX_BATCH_BYTES,
        refusal: batchTooLarge(buffers)?.code,
      }).toEqual({ aLengthCapWouldAdmitIt: true, theByteCapDoesNot: true, refusal: 'too_large' });
    });
  });

  describe('the file-count cap', () => {
    // One-byte buffers, with `wellUnderTheByteCap` asserted alongside, so only the count can
    // be what answered.

    it('ADMITS exactly MAX_BATCH_FILES files', () => {
      const buffers = tinyFiles(MAX_BATCH_FILES);

      expect({
        files: buffers.length,
        wellUnderTheByteCap: bytesOf(buffers) <= MAX_BATCH_BYTES,
        refusal: batchTooLarge(buffers),
      }).toEqual({ files: MAX_BATCH_FILES, wellUnderTheByteCap: true, refusal: undefined });
    });

    it('REFUSES one file more than MAX_BATCH_FILES', () => {
      const buffers = tinyFiles(MAX_BATCH_FILES + 1);

      expect({
        files: buffers.length,
        wellUnderTheByteCap: bytesOf(buffers) <= MAX_BATCH_BYTES,
        refusal: batchTooLarge(buffers)?.code,
      }).toEqual({ files: MAX_BATCH_FILES + 1, wellUnderTheByteCap: true, refusal: 'too_large' });
    });
  });

  it('answers with the FILE-COUNT refusal when a request breaks BOTH caps', () => {
    // No single-cap request can show precedence, and it is not cosmetic: splitting by BYTES
    // can still leave too many files. The oracle is the same function asked about a count-only
    // violation at the same file count, non-null asserted so it cannot silently be `undefined`.
    const overBoth = [...totalling(MAX_BATCH_BYTES + 1), ...tinyFiles(MAX_BATCH_FILES)];
    const byCountAlone = batchTooLarge(tinyFiles(overBoth.length))!;

    expect({ refusal: batchTooLarge(overBoth), oracle: byCountAlone.code }).toEqual({
      refusal: byCountAlone,
      oracle: 'too_large',
    });
  });

  it('gives the two caps DIFFERENT reasons, since both carry the same `code`', () => {
    // Both carry `too_large`, so only the prose names which bound was hit. Collapsed into one
    // message, a 51-file request gets told to get under a byte limit it is already far below.
    const byCount = batchTooLarge(tinyFiles(MAX_BATCH_FILES + 1))!;
    const byBytes = batchTooLarge(totalling(MAX_BATCH_BYTES + 1))!;

    expect({
      codes: [byCount.code, byBytes.code],
      reasonsDiffer: byCount.reason !== byBytes.reason,
    }).toEqual({ codes: ['too_large', 'too_large'], reasonsDiffer: true });
  });
});
