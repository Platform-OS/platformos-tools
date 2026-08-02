import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { path as pathUtils } from '@platformos/platformos-check-common';
import { AppCache } from '@platformos/platformos-check-node';

import { MAX_BUFFER_BYTES } from '../adapter-input.js';
import { MAX_RESPONSE_DIAGNOSTIC_BYTES, maxResponseBytes } from '../cost-model.js';
import type { SupervisorContext } from '../context.js';
import { GraphCache } from '../graph-cache/graph-cache.js';
import type { ValidateCodeResult, ValidateFilesResult } from '../result/types.js';
import { runValidateCode } from '../transport/validate-code.js';
import { MAX_BATCH_FILES } from './batch-bounds.js';

/**
 * The response bound, measured end to end on the shapes that motivated it.
 *
 * `result/response-budget.spec.ts` proves the allocator's rules over synthetic
 * results. This file answers the question that only the whole pipeline can: what does
 * the WORST LEGAL REQUEST actually return now, in bytes.
 *
 * BEFORE, measured on this build with the cap removed:
 *
 *   ```
 *     128 KiB single buffer   4 228 diagnostics    634 KiB   ~162 000 tokens
 *     266 KiB, 4-file batch   8 784 diagnostics  1 313 KiB   ~336 000 tokens
 *   ```
 *
 * Every dimension of the REQUEST was bounded and the RESPONSE was bounded by nothing,
 * at roughly six times the size of the input that produced it. One legal call could
 * return more tokens than most context windows hold — with no error, and nothing in
 * the payload saying anything unusual had happened.
 *
 * WHAT IS ASSERTED, and why it is a relationship rather than a number: the exact byte
 * count depends on message wording that check-common owns, so pinning it would make
 * this file fail on edits that change nothing about the bound. `maxResponseBytes`
 * states the arithmetic; these cases check the real payload against it.
 */
describe('Integration: the response is bounded, and says so when it withholds', () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'mcp-sup-bound-'));
    mkdirSync(join(projectDir, '.git'));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  const ctx = (): SupervisorContext => ({
    projectDir,
    graphCache: new GraphCache({ rootUri: pathUtils.toUri(projectDir) }),
    appCache: new AppCache(),
    log: () => {},
  });

  /**
   * A buffer of exactly `bytes` made of one repeated offending construct, padded with
   * spaces.
   *
   * Both details are deliberate and both were fixture errors during round 4: a tail
   * that cuts a tag in half raises a syntax error that short-circuits every other
   * check and collapses the diagnostic count to one, and a buffer one byte over the
   * cap is refused outright — which reads like a server bug rather than a bad
   * fixture.
   */
  const brokenBuffer = (bytes: number): string => {
    const unit = "{{ 'a' | no_such_filter_xyz }}\n";
    const whole = unit.repeat(Math.floor(bytes / unit.length));
    return whole + ' '.repeat(bytes - whole.length);
  };

  const bytesOf = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), 'utf8');

  it('bounds the worst legal SINGLE call, and reports the true total', async () => {
    const result = (await runValidateCode(ctx(), {
      file_path: 'app/views/pages/index.liquid',
      content: brokenBuffer(MAX_BUFFER_BYTES),
    })) as ValidateCodeResult;

    expect({
      status: result.status,
      // The gate is computed before anything is withheld — this is the assertion that
      // a shortened list has not become an approval.
      blocked: result.must_fix_before_write,
      withinBound: bytesOf(result) <= maxResponseBytes(1),
      returnedMatchesList: result.truncated!.errors!.returned === result.errors.length,
      // Thousands were found; the response says so rather than implying the short
      // list is everything.
      totalExceedsReturned: result.truncated!.errors!.total > result.errors.length,
      hasNote: result.truncated!.note.length > 0,
    }).toEqual({
      status: 'error',
      blocked: true,
      withinBound: true,
      returnedMatchesList: true,
      totalExceedsReturned: true,
      hasNote: true,
    });
  }, 120_000);

  it('bounds the worst legal BATCH as a request, not per file', async () => {
    // The shape a per-file cap alone would miss: the file count multiplies whatever
    // each file is allowed, and this is the largest count the batch form admits.
    const files = Array.from({ length: MAX_BATCH_FILES }, (_, index) => ({
      file_path: `app/views/pages/p${index}.liquid`,
      content: brokenBuffer(4_096),
    }));

    const result = (await runValidateCode(ctx(), { files })) as ValidateFilesResult;

    const diagnosticBytes = result.files.reduce(
      (sum, entry) =>
        sum +
        [...entry.result.errors, ...entry.result.warnings, ...entry.result.infos].reduce(
          (inner, diagnostic) => inner + bytesOf(diagnostic) + 1,
          0,
        ),
      0,
    );

    expect({
      blocked: result.must_fix_before_write,
      everyFilePresent: result.files.length === MAX_BATCH_FILES,
      // Round-robin: no file may be starved by a louder one, so each still carries
      // something the agent can act on.
      everyFileHasAnError: result.files.every((entry) => entry.result.errors.length > 0),
      everyFileDeclaresItsTotal: result.files.every(
        (entry) => (entry.result.truncated?.errors?.total ?? 0) > entry.result.errors.length,
      ),
      diagnosticsWithinBudget: diagnosticBytes <= MAX_RESPONSE_DIAGNOSTIC_BYTES * 1.5,
      wholeResponseWithinBound: bytesOf(result) <= maxResponseBytes(MAX_BATCH_FILES),
    }).toEqual({
      blocked: true,
      everyFilePresent: true,
      everyFileHasAnError: true,
      everyFileDeclaresItsTotal: true,
      diagnosticsWithinBudget: true,
      wholeResponseWithinBound: true,
    });
  }, 120_000);

  it('does not touch a realistic call: no truncation field, nothing withheld', async () => {
    // The measured common case — a small broken edit — costs a few hundred bytes and
    // is three orders of magnitude below the cap. A bound that changed this would be
    // solving the tail at the expense of the path taken before every write.
    const result = (await runValidateCode(ctx(), {
      file_path: 'app/views/pages/index.liquid',
      content: "{% render 'no_such_partial' %}\n{{ 'a' | no_such_filter_xyz }}\n",
    })) as ValidateCodeResult;

    expect({
      blocked: result.must_fix_before_write,
      truncated: result.truncated,
      errorsReturned: result.errors.length,
      underOneKiB: bytesOf(result) < 1024,
    }).toEqual({
      blocked: true,
      truncated: undefined,
      errorsReturned: 2,
      underOneKiB: true,
    });
  }, 60_000);
});
