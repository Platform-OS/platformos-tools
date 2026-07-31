import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { AppCache } from '@platformos/platformos-check-node';

import { runValidateCode, VALIDATE_CODE_INPUT } from './validate-code.js';
import { IMPACT_DEADLINE_MS, LINT_DEADLINE_MS, type SupervisorContext } from '../context.js';
import { MAX_BUFFER_BYTES } from '../adapter-input.js';
import { MAX_BATCH_BYTES, MAX_BATCH_FILES } from '../validate/batch-bounds.js';
import { GraphCache } from '../graph-cache/graph-cache.js';
import type { ValidateAdapters } from '../validate/validate-buffers.js';
import type {
  ValidateCodeDiagnostic,
  ValidateCodeImpact,
  ValidateCodeResult,
  ValidateFilesResult,
} from '../result/types.js';

/**
 * `validate_code` is the supervisor's ENTIRE surface: one file via
 * `file_path`/`content`, or several via `files`. Both forms drive the same
 * orchestrator (`validateBuffers`), so this file pins the TOOL contract — shape
 * adaptation, the write gate, refusals, and bounded work.
 *
 * Adapters are always injected, so nothing here touches a real project. `ignored`
 * in particular MUST be stubbed: under fake timers real config I/O never settles.
 */
const ctx = (log: SupervisorContext['log'] = () => {}): SupervisorContext => ({
  projectDir: '/srv/app',
  graphCache: new GraphCache({ rootUri: 'file:///srv/app' }),
  appCache: new AppCache(),
  log,
});

const COMPUTED: ValidateCodeImpact = {
  scope: 'direct',
  status: 'computed',
  dependents: { total: 0, by_kind: {}, sample: [] },
};

const NOT_IGNORED = async () => new Set<string>();

const diagnostic = (
  check: string,
  severity: ValidateCodeDiagnostic['severity'] = 'error',
): ValidateCodeDiagnostic => ({ check, severity, message: `${check} fired`, line: 1, column: 1 });

/** Adapters whose lint returns the given diagnostics per caller key. */
const adaptersFor = (
  byFile: Record<string, ValidateCodeDiagnostic[]> = {},
): Partial<ValidateAdapters> => ({
  lint: async ({ buffers }) =>
    new Map(buffers.map((buffer) => [buffer.filePath, byFile[buffer.filePath] ?? []])),
  impact: async () => COMPUTED,
  ignored: NOT_IGNORED,
});

const PAGE = 'app/views/pages/index.liquid';
const PARTIAL = 'app/views/partials/promo.liquid';

/** Narrow the union return to the single-file shape. */
const single = (result: ValidateCodeResult | ValidateFilesResult): ValidateCodeResult => {
  expect('files' in result).toBe(false);
  return result as ValidateCodeResult;
};

/** Narrow the union return to the multi-file shape. */
const batch = (result: ValidateCodeResult | ValidateFilesResult): ValidateFilesResult => {
  expect('files' in result).toBe(true);
  return result as ValidateFilesResult;
};

const validateOne = (
  content = '<div></div>',
  overrides: Partial<ValidateAdapters> = adaptersFor(),
  file_path = PAGE,
) => runValidateCode(ctx(), { file_path, content }, overrides).then(single);

describe('validate_code: the single-file form', () => {
  it('returns the FLAT result shape — no files[] wrapper for one file', async () => {
    const result = await validateOne();

    expect(result.status).toEqual('ok');
    expect(Object.keys(result).sort()).toEqual([
      'errors',
      'impact',
      'infos',
      'must_fix_before_write',
      'status',
      'warnings',
    ]);
  });

  it('passes diagnostics and impact straight through', async () => {
    const warning = diagnostic('SomeCheck', 'warning');
    const result = await validateOne('<div></div>', adaptersFor({ [PAGE]: [warning] }));

    expect(result).toEqual({
      status: 'warning',
      must_fix_before_write: false,
      errors: [],
      warnings: [warning],
      infos: [],
      impact: COMPUTED,
    });
  });

  it('degrades a failing impact to unavailable, preserving the lint output', async () => {
    const logs: string[] = [];
    const warning = diagnostic('SomeCheck', 'warning');
    const result = single(
      await runValidateCode(
        ctx((message) => logs.push(message)),
        { file_path: PAGE, content: '<div></div>' },
        {
          lint: async ({ buffers }) => new Map(buffers.map((b) => [b.filePath, [warning]])),
          impact: async () => {
            throw new Error('boom');
          },
          ignored: NOT_IGNORED,
        },
      ),
    );

    expect(result.warnings).toEqual([warning]);
    expect(result.impact.status).toEqual('unavailable');
    expect(logs.some((line) => line.includes('blast-radius failed'))).toBe(true);
  });

  it('propagates a lint failure — the primary gate is never silently dropped', async () => {
    const failure = new Error('lint exploded');

    await expect(
      runValidateCode(
        ctx(),
        { file_path: PAGE, content: 'x' },
        {
          lint: async () => {
            throw failure;
          },
          impact: async () => COMPUTED,
          ignored: NOT_IGNORED,
        },
      ),
    ).rejects.toThrow(failure);
  });
});

describe('validate_code: the multi-file form', () => {
  const validateMany = (
    files: Array<{ file_path: string; content: string }>,
    overrides: Partial<ValidateAdapters> = adaptersFor(),
  ) => runValidateCode(ctx(), { files }, overrides).then(batch);

  it('returns one entry per requested file, in order', async () => {
    const result = await validateMany([
      { file_path: PAGE, content: 'a' },
      { file_path: PARTIAL, content: 'b' },
    ]);

    expect(result.files.map((entry) => entry.file_path)).toEqual([PAGE, PARTIAL]);
    expect(result.files.map((entry) => entry.result.status)).toEqual(['ok', 'ok']);
  });

  it('lints the whole request in a SINGLE pass, not once per file', async () => {
    let calls = 0;
    let sawBuffers = 0;
    await validateMany(
      [
        { file_path: PAGE, content: 'a' },
        { file_path: PARTIAL, content: 'b' },
        { file_path: 'app/views/layouts/theme.liquid', content: 'c' },
      ],
      {
        lint: async ({ buffers }) => {
          calls++;
          sawBuffers = buffers.length;
          return new Map(buffers.map((b) => [b.filePath, []]));
        },
        impact: async () => COMPUTED,
        ignored: NOT_IGNORED,
      },
    );

    expect([calls, sawBuffers]).toEqual([1, 3]);
  });

  it('gates the whole changeset when ANY file blocks', async () => {
    const result = await validateMany(
      [
        { file_path: PAGE, content: 'a' },
        { file_path: PARTIAL, content: 'b' },
      ],
      adaptersFor({ [PARTIAL]: [diagnostic('MissingPartial')] }),
    );

    expect(result.must_fix_before_write).toBe(true);
    expect(result.files.map((e) => e.result.must_fix_before_write)).toEqual([false, true]);
  });

  it('does NOT gate on a non-blocking error, however many files carry one', async () => {
    const result = await validateMany(
      [
        { file_path: PAGE, content: 'a' },
        { file_path: PARTIAL, content: 'b' },
      ],
      adaptersFor({
        [PAGE]: [diagnostic('PartialCallArguments')],
        [PARTIAL]: [diagnostic('ImgWidthAndHeight')],
      }),
    );

    expect(result.must_fix_before_write).toBe(false);
    // De-escalation of the GATE, not suppression: both are still errors.
    expect(result.files.map((e) => e.result.status)).toEqual(['error', 'error']);
  });

  it('keys results by the caller’s own path string, relative or absolute', async () => {
    const absolute = '/srv/app/app/views/pages/index.liquid';
    const result = await validateMany([
      { file_path: PAGE, content: 'a' },
      { file_path: absolute, content: 'b' },
    ]);

    expect(result.files.map((e) => e.file_path)).toEqual([PAGE, absolute]);
  });
});

describe('validate_code: per-file refusals (a request is never all-or-nothing)', () => {
  it('declines only the off-project file and still validates its siblings', async () => {
    const result = batch(
      await runValidateCode(
        ctx(),
        {
          files: [
            { file_path: '/etc/passwd', content: 'root:x:0:0' },
            { file_path: PAGE, content: 'a' },
          ],
        },
        adaptersFor({ [PAGE]: [diagnostic('MissingPartial')] }),
      ),
    );

    expect(result.files[0].result.not_applicable_reason).toEqual('outside_project');
    expect(result.files[1].result.errors).toEqual([diagnostic('MissingPartial')]);
    expect(result.must_fix_before_write).toBe(true);
  });

  it.each([
    ['outside the project', '/etc/passwd', 'outside_project'],
    ['an unsupported type', 'README.md', 'unsupported_type'],
  ])('declines a single file %s without linting', async (_label, file_path, reason) => {
    const calls: string[] = [];
    const result = await validateOne(
      'x',
      {
        lint: async ({ buffers }) => {
          calls.push('lint');
          return new Map(buffers.map((b) => [b.filePath, []]));
        },
        impact: async () => {
          calls.push('impact');
          return COMPUTED;
        },
        ignored: NOT_IGNORED,
      },
      file_path,
    );

    expect(result.status).toEqual('not_applicable');
    expect(result.not_applicable_reason).toEqual(reason);
    expect(result.must_fix_before_write).toBe(false);
    expect(calls).toEqual([]);
  });

  it('does NOT report ok for valid JSON at an off-project path (the false approval)', async () => {
    const result = await validateOne('{}', adaptersFor(), '/etc/shadow');

    expect(result.status).toEqual('not_applicable');
    expect(result.must_fix_before_write).toBe(false);
  });

  it('declines a config-IGNORED file rather than reporting it clean', async () => {
    // `check()` skips ignored files silently, so "no offenses" would mean "never
    // looked at" — the write gate approving a file nothing checked.
    const result = await validateOne('{% if %}{{ unclosed', {
      ...adaptersFor(),
      ignored: async () => new Set(['/srv/app/app/views/pages/index.liquid']),
    });

    expect(result.status).toEqual('not_applicable');
    expect(result.not_applicable_reason).toEqual('ignored');
    expect(result.must_fix_before_write).toBe(false);
  });

  it('never consults the config for a file the pure gate already declined', async () => {
    let consulted = false;
    await validateOne(
      'x',
      {
        ...adaptersFor(),
        ignored: async () => {
          consulted = true;
          return new Set<string>();
        },
      },
      '/etc/passwd',
    );

    expect(consulted).toBe(false);
  });

  it('consults the config ONCE for a whole multi-file request', async () => {
    let calls = 0;
    await runValidateCode(
      ctx(),
      {
        files: [
          { file_path: PAGE, content: 'a' },
          { file_path: PARTIAL, content: 'b' },
          { file_path: 'app/views/layouts/theme.liquid', content: 'c' },
        ],
      },
      {
        ...adaptersFor(),
        ignored: async () => {
          calls++;
          return new Set<string>();
        },
      },
    );

    expect(calls).toEqual(1);
  });
});

describe('validate_code: bounded work', () => {
  it('refuses an oversized buffer BEFORE parsing', async () => {
    const calls: string[] = [];
    const result = await validateOne('a'.repeat(MAX_BUFFER_BYTES + 1), {
      lint: async ({ buffers }) => {
        calls.push('lint');
        return new Map(buffers.map((b) => [b.filePath, []]));
      },
      impact: async () => COMPUTED,
      ignored: NOT_IGNORED,
    });

    expect(result.not_applicable_reason).toEqual('too_large');
    expect(result.must_fix_before_write).toBe(false);
    expect(calls).toEqual([]);
  });

  it('accepts a buffer exactly at the limit', async () => {
    expect((await validateOne('a'.repeat(MAX_BUFFER_BYTES))).status).toEqual('ok');
  });

  it('refuses a request over the total-byte cap, declining every entry', async () => {
    const perFile = MAX_BUFFER_BYTES; // each individually legal
    const files = Array.from({ length: Math.floor(MAX_BATCH_BYTES / perFile) + 1 }, (_, i) => ({
      file_path: `app/views/pages/p${i}.liquid`,
      content: 'a'.repeat(perFile),
    }));

    const result = batch(await runValidateCode(ctx(), { files }, adaptersFor()));

    expect(result.files.map((e) => e.result.not_applicable_reason)).toEqual(
      files.map(() => 'too_large'),
    );
    expect(result.must_fix_before_write).toBe(false);
  });

  it('returns a determinate timed_out result when the lint never settles', async () => {
    vi.useFakeTimers();
    try {
      const pending = runValidateCode(
        ctx(),
        { file_path: PAGE, content: '<div></div>' },
        { lint: () => new Promise(() => {}), impact: async () => COMPUTED, ignored: NOT_IGNORED },
      );

      await vi.advanceTimersByTimeAsync(LINT_DEADLINE_MS + 1);
      const result = single(await pending);

      expect(result.not_applicable_reason).toEqual('timed_out');
      // A timeout is OUR failure, not a verdict on the file — it must not block.
      expect(result.must_fix_before_write).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a lint abandoned by the deadline is observed, not left unhandled', async () => {
    vi.useFakeTimers();
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      const logs: string[] = [];
      let rejectLint: (error: Error) => void = () => {};
      const pending = runValidateCode(
        ctx((message) => logs.push(message)),
        { file_path: PAGE, content: 'x' },
        {
          lint: () =>
            new Promise((_, reject) => {
              rejectLint = reject;
            }),
          impact: async () => COMPUTED,
          ignored: NOT_IGNORED,
        },
      );

      await vi.advanceTimersByTimeAsync(LINT_DEADLINE_MS + 1);
      await pending;

      rejectLint(new Error('too late to matter'));
      await vi.advanceTimersByTimeAsync(1);
      vi.useRealTimers();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(logs.some((line) => line.includes('abandoned lint later failed'))).toBe(true);
      expect(unhandled).toEqual([]);
    } finally {
      vi.useRealTimers();
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('caps a stalled impact at ITS deadline, far below the lint deadline', async () => {
    expect(IMPACT_DEADLINE_MS).toBeLessThan(LINT_DEADLINE_MS);

    vi.useFakeTimers();
    try {
      const pending = runValidateCode(
        ctx(),
        { file_path: PAGE, content: 'x' },
        {
          lint: async ({ buffers }) => new Map(buffers.map((b) => [b.filePath, []])),
          impact: () => new Promise(() => {}),
          ignored: NOT_IGNORED,
        },
      );

      // One tick past the IMPACT deadline must settle the call.
      await vi.advanceTimersByTimeAsync(IMPACT_DEADLINE_MS + 1);
      const result = single(await pending);

      expect(result.status).toEqual('ok');
      expect(result.impact.status).toEqual('unavailable');
    } finally {
      vi.useRealTimers();
    }
  });

  it('runs lint and impact CONCURRENTLY, not one after the other', async () => {
    // Serializing them added the whole blast-radius cost to every call. Asserted by
    // observing that impact starts while the lint is still in flight.
    let lintStarted = false;
    let impactSawLintRunning = false;
    let releaseLint: () => void = () => {};
    const lintGate = new Promise<void>((resolve) => {
      releaseLint = resolve;
    });

    await runValidateCode(
      ctx(),
      { file_path: PAGE, content: 'x' },
      {
        lint: async ({ buffers }) => {
          lintStarted = true;
          await lintGate;
          return new Map(buffers.map((b) => [b.filePath, []]));
        },
        impact: async () => {
          impactSawLintRunning = lintStarted;
          releaseLint();
          return COMPUTED;
        },
        ignored: NOT_IGNORED,
      },
    );

    expect(impactSawLintRunning).toBe(true);
  });
});

describe('validate_code: input shape', () => {
  it('rejects a request carrying BOTH forms rather than guessing', async () => {
    const result = single(
      await runValidateCode(
        ctx(),
        { file_path: PAGE, content: 'a', files: [{ file_path: PARTIAL, content: 'b' }] },
        adaptersFor(),
      ),
    );

    expect(result.status).toEqual('not_applicable');
    expect(result.not_applicable_reason).toEqual('internal_error');
    expect(result.must_fix_before_write).toBe(false);
  });

  it('rejects a request carrying NEITHER form', async () => {
    const result = single(await runValidateCode(ctx(), {}, adaptersFor()));

    expect(result.not_applicable_reason).toEqual('internal_error');
  });

  it('rejects a half-specified single form', async () => {
    const result = single(await runValidateCode(ctx(), { file_path: PAGE }, adaptersFor()));

    expect(result.not_applicable_reason).toEqual('internal_error');
  });

  it('distinguishes internal_error from timed_out, so retry advice differs', async () => {
    // Reusing `timed_out` here would tell an agent to "retry with fewer files" for
    // something retrying cannot fix.
    const result = single(await runValidateCode(ctx(), {}, adaptersFor()));

    expect(result.not_applicable_reason).not.toEqual('timed_out');
  });
});

describe('VALIDATE_CODE_INPUT', () => {
  const schema = z.object(VALIDATE_CODE_INPUT);
  const parse = (args: unknown) => schema.safeParse(args).success;

  it('accepts the single form', () => {
    expect(parse({ file_path: PAGE, content: 'x' })).toBe(true);
  });

  it('accepts the multi form', () => {
    expect(parse({ files: [{ file_path: PAGE, content: 'x' }] })).toBe(true);
  });

  it('rejects a blank path in either form', () => {
    expect(parse({ file_path: '   ', content: 'x' })).toBe(false);
    expect(parse({ files: [{ file_path: '  ', content: 'x' }] })).toBe(false);
  });

  it('rejects an empty files array', () => {
    expect(parse({ files: [] })).toBe(false);
  });

  it('rejects a files array over the file-count cap at the protocol boundary', () => {
    const files = Array.from({ length: MAX_BATCH_FILES + 1 }, (_, i) => ({
      file_path: `app/views/pages/p${i}.liquid`,
      content: 'x',
    }));

    expect(parse({ files })).toBe(false);
  });

  it('advertises exactly the three accepted fields', () => {
    expect(Object.keys(VALIDATE_CODE_INPUT).sort()).toEqual(['content', 'file_path', 'files']);
  });

  it('TOLERATES a stale caller still sending mode, dropping it', () => {
    // `mode` was removed; an agent mid-session must not start failing over a
    // parameter that never did anything.
    const parsed = schema.safeParse({ file_path: PAGE, content: 'x', mode: 'quick' });

    expect(parsed.success).toBe(true);
    expect(parsed.success && Object.keys(parsed.data).sort()).toEqual(['content', 'file_path']);
  });
});
