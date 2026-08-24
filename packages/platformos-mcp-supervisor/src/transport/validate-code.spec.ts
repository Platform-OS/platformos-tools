import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { SourceCodeType, toSourceCode } from '@platformos/platformos-check-common';
// From `platformos-common`, the single owner of what a path IS; check-common no longer
// re-exports it (`guards/identity-ownership.spec.ts` fails on a re-export growing back).
import { PlatformOSFileType, isSupportedSourceFile } from '@platformos/platformos-common';

import { runValidateCode, TOOL_TEXT, VALIDATE_CODE_INPUT } from './validate-code.js';
import { SERVER_INSTRUCTIONS } from './instructions.js';
import { BLOCKING_CHECKS } from '../result/blocking.js';
import { IMPACT_DEADLINE_MS, type SupervisorContext } from '../context.js';
import {
  MAX_RESPONSE_DIAGNOSTIC_BYTES,
  MIN_LINT_DEADLINE_MS,
  lintDeadlineMs,
  maxResponseBytes,
} from '../cost-model.js';
import { MAX_BUFFER_BYTES } from '../adapter-input.js';
import { MAX_BATCH_BYTES, MAX_BATCH_FILES } from '../validate/batch-bounds.js';
import type { LintNotCheckedStatus } from '../lint/lint-batch.js';
import { allChecks } from '@platformos/platformos-check-common';
import { checkDocs } from '../check-docs.js';
import type { DocsetVocabulary } from '../enrich/enrich.js';
import type { ValidateAdapters } from '../validate/validate-buffers.js';
import type {
  NotApplicableReason,
  ValidateCodeDiagnostic,
  ValidateCodeImpact,
  ValidateCodeResult,
  ValidateFilesResult,
} from '../result/types.js';

/**
 * `validate_code` is the supervisor's ENTIRE surface: one file via `file_path`/`content`,
 * or several via `files`. Both forms drive the same orchestrator (`validateBuffers`), so
 * this file pins the TOOL contract — shape adaptation, the write gate, refusals, and
 * bounded work.
 */
const ctx = (log: SupervisorContext['log'] = () => {}): SupervisorContext => ({
  projectDir: '/srv/app',
  log,
});

const COMPUTED: ValidateCodeImpact = {
  scope: 'direct',
  status: 'computed',
  dependents: { total: 0, by_kind: {}, sample: [] },
};

const diagnostic = (
  check: string,
  severity: ValidateCodeDiagnostic['severity'] = 'error',
): ValidateCodeDiagnostic => ({ check, severity, message: `${check} fired`, line: 1, column: 1 });

/**
 * The same diagnostic AS RETURNED — enrichment attaches the check's documentation URL on
 * the way out. Derived from the registry rather than pasted.
 */
const enriched = (
  check: string,
  severity: ValidateCodeDiagnostic['severity'] = 'error',
): ValidateCodeDiagnostic => {
  const url = checkDocs(check)?.url;
  return url ? { ...diagnostic(check, severity), see_also: url } : diagnostic(check, severity);
};

/**
 * Adapters whose lint returns the given diagnostics per caller key.
 *
 * ALL THREE seams are stubbed, the docset included: left to its default it resolves the
 * process docset over the network, which no test here is about. The empty vocabulary is
 * what they assume — `see_also` still attaches, and no symbol resolves to a signature.
 */
const adaptersFor = (
  byFile: Record<string, ValidateCodeDiagnostic[]> = {},
): Partial<ValidateAdapters> => ({
  lint: async ({ buffers }) => ({
    diagnostics: new Map(buffers.map((b) => [b.filePath, byFile[b.filePath] ?? []])),
    notChecked: new Map(),
  }),
  impact: async () => COMPUTED,
  docset: async () => ({ filters: [], tags: [], objects: [] }),
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

/**
 * A real temp project on disk, plus the operations the INTEGRATION groups below perform on
 * it. Those groups inject no adapters — they drive the same call path the MCP handler takes.
 *
 * Call it in a `describe` body: it registers the per-test setup and teardown on that suite,
 * so each case gets its own directory.
 */
function tempProject(prefix: string) {
  let projectDir = '';

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), prefix));
    // A `.git` directory is how the project root is recognized.
    mkdirSync(join(projectDir, '.git'));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  const context = (): SupervisorContext => ({
    projectDir,
    log: () => {},
  });

  return {
    context,

    write(files: Record<string, string> = {}) {
      for (const [relativePath, source] of Object.entries(files)) {
        const absolute = join(projectDir, relativePath);
        mkdirSync(dirname(absolute), { recursive: true });
        writeFileSync(absolute, source, 'utf8');
      }
    },

    /** Real adapters: the same call path the MCP handler takes. */
    async validate(filePath: string, content: string): Promise<ValidateCodeResult> {
      return (await runValidateCode(context(), {
        file_path: filePath,
        content,
      })) as ValidateCodeResult;
    },
  };
}

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
          lint: async ({ buffers }) => ({
            diagnostics: new Map(buffers.map((b) => [b.filePath, [warning]])),
            notChecked: new Map(),
          }),
          impact: async () => {
            throw new Error('boom');
          },
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
          return {
            diagnostics: new Map(buffers.map((b) => [b.filePath, []])),
            notChecked: new Map(),
          };
        },
        impact: async () => COMPUTED,
      },
    );

    expect([calls, sawBuffers]).toEqual([1, 3]);
  });

  /**
   * The blast radius reads the project per REQUEST, not per file, and the proof has to be
   * identity: every buffer is handed the SAME `ProjectScan`, whose `sources()` is memoized.
   * A scan built per buffer returns identical answers and simply multiplies the I/O.
   */
  it('shares ONE project scan across the batch, rather than one per file', async () => {
    const scans = new Set<unknown>();

    await validateMany(
      [
        { file_path: PAGE, content: 'a' },
        { file_path: PARTIAL, content: 'b' },
        { file_path: 'app/views/layouts/theme.liquid', content: 'c' },
      ],
      {
        lint: async ({ buffers }) => ({
          diagnostics: new Map(buffers.map((b) => [b.filePath, []])),
          notChecked: new Map(),
        }),
        impact: async (_params, scan) => {
          scans.add(scan);
          return COMPUTED;
        },
      },
    );

    // Identity is the assertion: `ProjectScan.sources()` is memoized per object, so one
    // object means one project read (pinned in `project-scan.spec.ts`).
    expect(scans.size).toEqual(1);
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
    expect(result.files[1].result.errors).toEqual([enriched('MissingPartial')]);
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
          return {
            diagnostics: new Map(buffers.map((b) => [b.filePath, []])),
            notChecked: new Map(),
          };
        },
        impact: async () => {
          calls.push('impact');
          return COMPUTED;
        },
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
    // `check()` skips ignored files silently, so "no offenses" would mean "never looked
    // at" — the write gate approving a file nothing checked.
    const result = await validateOne('{% if %}{{ unclosed', {
      // The LINT seam reports this — it holds the config. There is no separate ignore
      // adapter to stub, which is the point: one source of truth.
      lint: async () => ({
        diagnostics: new Map(),
        notChecked: new Map<string, LintNotCheckedStatus>([[PAGE, 'excluded-by-config']]),
      }),
      impact: async () => COMPUTED,
    });

    expect(result.status).toEqual('not_applicable');
    expect(result.not_applicable_reason).toEqual('ignored');
    expect(result.must_fix_before_write).toBe(false);
  });

  it('never reaches the lint for a file the pure gate already declined', async () => {
    // The pure gate is synchronous and runs first, so an off-project path costs no I/O.
    let linted = false;
    await validateOne(
      'x',
      {
        lint: async () => {
          linted = true;
          return { diagnostics: new Map(), notChecked: new Map() };
        },
        impact: async () => COMPUTED,
      },
      '/etc/passwd',
    );

    expect(linted).toBe(false);
  });

  it('loads the project ONCE for a whole multi-file request', async () => {
    // The config-exclusion answer rides along with the single lint pass, so one pass IS
    // one config load.
    let passes = 0;
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
        lint: async ({ buffers }) => {
          passes++;
          return {
            diagnostics: new Map(buffers.map((b) => [b.filePath, []])),
            notChecked: new Map(),
          };
        },
        impact: async () => COMPUTED,
      },
    );

    expect(passes).toEqual(1);
  });
});

describe('validate_code: bounded work', () => {
  it('refuses an oversized buffer BEFORE parsing', async () => {
    const calls: string[] = [];
    const result = await validateOne('a'.repeat(MAX_BUFFER_BYTES + 1), {
      lint: async ({ buffers }) => {
        calls.push('lint');
        return {
          diagnostics: new Map(buffers.map((b) => [b.filePath, []])),
          notChecked: new Map(),
        };
      },
      impact: async () => COMPUTED,
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

  /**
   * Results are keyed by the caller's `file_path` string, but buffers are overlaid and
   * deduplicated by normalized URI (last one wins), so two entries naming one file would
   * lint ONE buffer and report its verdict for BOTH — a false approval with no check
   * involved, whose direction flipped with the argument order.
   */
  it.each([
    ['broken buffer first', '{{ x | no_such_filter }}', '<p>clean</p>'],
    ['clean buffer first', '<p>clean</p>', '{{ x | no_such_filter }}'],
  ])('refuses two entries naming the same file — %s', async (_order, first, second) => {
    const files = [
      { file_path: PARTIAL, content: first },
      { file_path: PARTIAL, content: second },
    ];

    const result = batch(
      await runValidateCode(ctx(), { files }, adaptersFor({ [PARTIAL]: [diagnostic('X')] })),
    );

    // Every entry is declined, and NONE is reported as checked-and-clean.
    expect(result.files.map((e) => e.result.status)).toEqual(['not_applicable', 'not_applicable']);
    expect(result.files.map((e) => e.result.not_applicable_reason)).toEqual([
      'internal_error',
      'internal_error',
    ]);
    expect(result.must_fix_before_write).toBe(false);
    expect(result.next_step).toContain(PARTIAL);
  });

  it('refuses aliased spellings of one file, which collide only after normalization', async () => {
    const files = [
      { file_path: PARTIAL, content: '{{ x | no_such_filter }}' },
      { file_path: `/srv/app/${PARTIAL}`, content: '<p>clean</p>' },
    ];

    const result = batch(await runValidateCode(ctx(), { files }, adaptersFor()));

    expect(result.files.map((e) => e.result.not_applicable_reason)).toEqual([
      'internal_error',
      'internal_error',
    ]);
  });

  it('never reaches the lint for a self-contradictory request', async () => {
    // The refusal is decidable from the request alone, and no buffer may be linted when
    // we will not report its result honestly.
    const lint = vi.fn();

    await runValidateCode(
      ctx(),
      {
        files: [
          { file_path: PARTIAL, content: 'a' },
          { file_path: PARTIAL, content: 'b' },
        ],
      },
      { ...adaptersFor(), lint },
    );

    expect(lint).not.toHaveBeenCalled();
  });

  it('still validates a batch that names each file once', async () => {
    // The guard must not cost the legitimate case, including the mixed relative/absolute
    // spelling the caller-string keying exists to support.
    const files = [
      { file_path: PAGE, content: 'a' },
      { file_path: `/srv/app/${PARTIAL}`, content: 'b' },
    ];

    const result = batch(await runValidateCode(ctx(), { files }, adaptersFor()));

    expect(result.files.map((e) => e.result.status)).toEqual(['ok', 'ok']);
    expect(result.files.map((e) => e.file_path)).toEqual([PAGE, `/srv/app/${PARTIAL}`]);
  });

  it('returns a determinate timed_out result when the lint never settles', async () => {
    vi.useFakeTimers();
    try {
      const pending = runValidateCode(
        ctx(),
        { file_path: PAGE, content: '<div></div>' },
        { lint: () => new Promise(() => {}), impact: async () => COMPUTED },
      );

      await vi.advanceTimersByTimeAsync(MIN_LINT_DEADLINE_MS + 1);
      const result = single(await pending);

      expect(result.not_applicable_reason).toEqual('timed_out');
      // A timeout is OUR failure, not a verdict on the file — it must not block.
      expect(result.must_fix_before_write).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives a large batch the LONGER deadline its size earns, not the floor', async () => {
    // The deadline scales with the bytes admitted, so being still-running at the floor is
    // CORRECT here; a fixed deadline against a larger cap returned `timed_out` for EVERY
    // file in the worst legal batch.
    const big = 'x'.repeat(100 * 1024);
    const files = [
      { file_path: PAGE, content: big },
      { file_path: PARTIAL, content: big },
    ];
    const earned = lintDeadlineMs(2 * 100 * 1024);
    expect(earned).toBeGreaterThan(MIN_LINT_DEADLINE_MS);

    vi.useFakeTimers();
    try {
      let settled = false;
      const pending = runValidateCode(
        ctx(),
        { files },
        {
          lint: () => new Promise(() => {}),
          impact: async () => COMPUTED,
        },
      ).then((value) => {
        settled = true;
        return value;
      });

      await vi.advanceTimersByTimeAsync(MIN_LINT_DEADLINE_MS + 1);
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(earned - MIN_LINT_DEADLINE_MS);
      const result = batch(await pending);

      expect(result.files.map((entry) => entry.result.not_applicable_reason)).toEqual([
        'timed_out',
        'timed_out',
      ]);
      // The message must quote the deadline actually applied, not the floor — it is the
      // only place the caller can see how long it was held.
      expect(
        result.files.map((entry) =>
          entry.result.next_step?.startsWith(
            `Validation exceeded ${Math.round(earned / 1000)} s and was abandoned`,
          ),
        ),
      ).toEqual([true, true]);
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
        },
      );

      await vi.advanceTimersByTimeAsync(MIN_LINT_DEADLINE_MS + 1);
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
    expect(IMPACT_DEADLINE_MS).toBeLessThan(MIN_LINT_DEADLINE_MS);

    vi.useFakeTimers();
    try {
      const pending = runValidateCode(
        ctx(),
        { file_path: PAGE, content: 'x' },
        {
          lint: async ({ buffers }) => ({
            diagnostics: new Map(buffers.map((b) => [b.filePath, []])),
            notChecked: new Map(),
          }),
          impact: () => new Promise(() => {}),
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
    // Serializing them would add the whole blast-radius cost to every call. Asserted by
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
          return {
            diagnostics: new Map(buffers.map((b) => [b.filePath, []])),
            notChecked: new Map(),
          };
        },
        impact: async () => {
          impactSawLintRunning = lintStarted;
          releaseLint();
          return COMPUTED;
        },
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
    // `mode` was removed; an agent mid-session must not start failing over a parameter
    // that never did anything.
    const parsed = schema.safeParse({ file_path: PAGE, content: 'x', mode: 'quick' });

    expect(parsed.success).toBe(true);
    expect(parsed.success && Object.keys(parsed.data).sort()).toEqual(['content', 'file_path']);
  });
});

/**
 * The description and the server instructions ARE the agent's entire understanding of this
 * tool, so a stale claim there converts "I do not know" into false confidence. These pin
 * the claims most likely to rot, and the ones whose rotting is dangerous.
 */
describe('validate_code: the agent-facing surface', () => {
  const { VALIDATE_CODE_DESCRIPTION } = TOOL_TEXT;

  it('states the either/or rule exactly ONCE, in the description', () => {
    // One rule, stated once, in the place an agent is deciding what to send.
    const inParams = Object.values(VALIDATE_CODE_INPUT).filter((field) =>
      /omit|never both|either/i.test((field as { description?: string }).description ?? ''),
    );

    expect(inParams).toEqual([]);
    expect(VALIDATE_CODE_DESCRIPTION).toContain('EITHER one file OR several — never both');
  });

  it('shows a concrete example of BOTH input forms', () => {
    // An agent copies examples. Prose alone leaves the nesting ambiguous.
    expect(VALIDATE_CODE_DESCRIPTION).toContain('"file_path": "app/views/partials/card.liquid"');
    expect(VALIDATE_CODE_DESCRIPTION).toContain('"files": [');
  });

  it('claims YAML only now that YAML syntax is actually validated', () => {
    // Coverage is not total — see the instructions, which say what is and is not checked
    // for YAML.
    expect(VALIDATE_CODE_DESCRIPTION).toContain('Liquid, GraphQL and YAML');
  });

  it('says plainly that a false gate is not a correctness guarantee', () => {
    expect(VALIDATE_CODE_DESCRIPTION).toContain('not a guarantee of correctness');
  });

  it('says not_applicable is neither approval nor refusal', () => {
    expect(VALIDATE_CODE_DESCRIPTION).toContain('neither approval nor refusal');
  });
});

describe('server instructions', () => {
  it('documents EVERY not_applicable_reason the code can return', () => {
    // A reason the agent has never heard of is a reason it cannot act on. This fails
    // the moment someone adds a code without documenting it.
    const documented: NotApplicableReason[] = [
      'outside_project',
      'unsupported_type',
      'ignored',
      'too_large',
      'timed_out',
      'internal_error',
    ];

    for (const reason of documented) {
      expect(SERVER_INSTRUCTIONS).toContain(reason);
    }
  });
  /**
   * "The SHAPE of a model schema is not checked" is a SILENCE, so no diagnostic can carry
   * it and an agent reading a clean YAML result as a shape guarantee is the false
   * confidence this text exists to prevent. `instructions-coverage.spec.ts` holds the
   * behavioural half.
   */
  it('keeps the YAML claim no diagnostic can deliver, and drops the one that fires', () => {
    expect({
      keptTheSilence: SERVER_INSTRUCTIONS.includes('The SHAPE of a model schema is not checked'),
      droppedWhatFires: SERVER_INSTRUCTIONS.includes('one that does not parse is reported'),
    }).toEqual({ keptTheSilence: true, droppedWhatFires: false });
  });

  it('tells the agent to validate BEFORE writing', () => {
    expect(SERVER_INSTRUCTIONS).toContain('BEFORE writing');
  });
  /**
   * THE INVARIANT: the instructions name NO platform rule at all. Every such rule fires a
   * real diagnostic that carries its check's documentation URL, so prose here would be a
   * staler second copy paid for in context on every session. Each phrase below is one that
   * was once required; re-adding a gotcha fails here and is pointed at the check that owns
   * it.
   */
  it('restates no platform rule — the diagnostics carry those, with links', () => {
    const reintroduced = [
      'must use DOUBLE quotes',
      'needs a Hash with a key or an Array',
      'end in a BRACKET',
      'rejected by the converter',
      'YAML 1.1',
      'hash_add_key',
      'content_for_layout',
    ].filter((phrase) => SERVER_INSTRUCTIONS.includes(phrase));

    expect(reintroduced).toEqual([]);
  });

  it('states the coverage it DOES claim as a derived count, not a hand-written list', () => {
    // Derived from the registry, so it cannot describe a build that no longer exists.
    expect(SERVER_INSTRUCTIONS).toContain(`${allChecks.length} checks run against your buffer`);
  });

  it('describes the size refusal in terms of BOTH bounds it can come from', () => {
    // "Split the file" is the wrong instruction for a request that is legal per file and
    // over the batch cap — the caller would shrink files that were never the problem.
    expect(SERVER_INSTRUCTIONS).toContain('or the request as a whole');
  });

  it('explains that errors[] can be non-empty while the gate is false', () => {
    // The single most confusing thing about the result: error does not imply blocked.
    expect(SERVER_INSTRUCTIONS).toContain('must_fix_before_write is false');
  });

  it('does NOT tell an agent a malformed request is unfixable', () => {
    // `internal_error` covers two different things, and three of its cases are the
    // CALLER's mistake — both input forms, neither, or one file listed twice — which are
    // worth retrying once fixed.
    expect(SERVER_INSTRUCTIONS).not.toContain('retrying will not help');
    expect(SERVER_INSTRUCTIONS).toContain(`is yours
                       to fix`);
  });

  it('states the once-per-file rule, which the server enforces by refusing', () => {
    // `validate/batch-coherence.ts` declines a request naming one file twice, so the rule
    // has to be findable BEFORE the agent trips it.
    expect(SERVER_INSTRUCTIONS).toContain('List each file at most once');
    expect(TOOL_TEXT.VALIDATE_CODE_DESCRIPTION).toContain('List each file at most once');
  });

  it('says columns are UTF-16 code units, which is not inferable', () => {
    // Verified behaviour: an emoji advances the column by 2, so an agent counting code
    // points misplaces every column after one.
    expect(SERVER_INSTRUCTIONS).toContain('UTF-16 code units');
  });

  it('scopes the ordering claim to each list rather than across all three', () => {
    // `assembleResult` sorts, THEN partitions, so concatenating errors + warnings + infos
    // does not walk the file in order.
    expect(SERVER_INSTRUCTIONS).toContain('WITHIN ITSELF');
  });

  it('explains that an unavailable blast radius is not "nothing depends on this"', () => {
    // Zeroed dependents on a failed or timed-out lookup read exactly like a real answer.
    expect(SERVER_INSTRUCTIONS).toContain('NOT a claim that nothing depends');
  });
});

/**
 * Every member of `BLOCKING_CHECKS` must actually be able to block a write.
 */

/** A project on disk, plus the buffer under edit, that must produce one code. */
interface EmissionFixture {
  /** Files written to the temp project before the call. */
  project?: Record<string, string>;
  filePath: string;
  content: string;
  /**
   * Every distinct check in `errors[]`, sorted. Usually just the code under test;
   * where a second check fires on the same construct that is stated, not filtered
   * out, so a fixture growing an unexpected finding fails here.
   */
  errors: string[];
}

/**
 * Fixtures are MINIMAL on purpose: the smallest buffer that produces the code, so a failure
 * points at the check rather than at whichever of six constructs broke.
 *
 * Positions and message text are NOT asserted — they belong to check-common and are pinned
 * by its own specs.
 */
const EMITS: Record<string, EmissionFixture> = {
  LiquidHTMLSyntaxError: {
    filePath: PAGE,
    content: '{% if true %}\n',
    errors: ['LiquidHTMLSyntaxError'],
  },

  MissingPartial: {
    filePath: PAGE,
    content: "{% render 'no_such_partial' %}\n",
    errors: ['MissingPartial'],
  },

  UnknownFilter: {
    filePath: PAGE,
    content: "{{ 'a' | no_such_filter_xyz }}\n",
    errors: ['UnknownFilter'],
  },

  FilterArity: {
    // `upcase` takes the piped input and nothing else; three positional arguments
    // is `Liquid::ArgumentError` at runtime.
    filePath: PAGE,
    content: "{{ 'a' | upcase: 1, 2, 3 }}\n",
    errors: ['FilterArity'],
  },

  JsonLiteralQuoteStyle: {
    // Single-quoted key in an assign JSON literal. `{{ o }}` only keeps the buffer
    // free of an unrelated `UnusedAssign` warning.
    filePath: PAGE,
    content: "{% assign o = {'k': 1} %}{{ o }}\n",
    errors: ['JsonLiteralQuoteStyle'],
  },

  InvalidWriteTarget: {
    // The two tags are separated. What this fixture proves is that a reported offense
    // reaches the gate and blocks; the detection itself is check-common's business.
    filePath: PAGE,
    content: `{% assign x = 5 %}
{% hash_assign x['k'] = 'v' %}
`,
    errors: ['InvalidWriteTarget'],
  },

  InvalidFrontmatterSyntax: {
    // Measured: `Body contains invalid YAML: found a tab character that violates indentation`.
    filePath: PAGE,
    content: '---\nslug: probe\n\tlayout: application\n---\n<p>hi</p>\n',
    errors: ['InvalidFrontmatterSyntax'],
  },

  UnknownFrontmatterField: {
    // MEASURED: `pos-cli deploy --dry-run` REJECTS with `Unknown properties: bogus_key.`
    filePath: PAGE,
    content: '---\nbogus_key: true\n---\n<p>hi</p>\n',
    errors: ['UnknownFrontmatterField'],
  },

  InvalidFrontmatterValue: {
    // Measured: `Request method 'POST' is not allowed. Valid methods: delete, get, …`.
    // Upper case on purpose — the platform compares literally, and this spelling used to
    // reach the gate as `status: ok`.
    filePath: PAGE,
    content: '---\nmethod: POST\n---\n<p>hi</p>\n',
    errors: ['InvalidFrontmatterValue'],
  },

  MissingLayout: {
    // MEASURED: `Layout Could not find Layout with layout: no_such_layout`.
    filePath: PAGE,
    content: '---\nlayout: no_such_layout\n---\n<p>hi</p>\n',
    errors: ['MissingLayout'],
  },

  MissingFrontmatterAssociation: {
    // Measured by a REAL deploy: `tries to assign authorization_policies which do not
    // exist`. `--dry-run` accepts this file.
    filePath: PAGE,
    content: '---\nauthorization_policies:\n  - no_such_policy\n---\n<p>hi</p>\n',
    errors: ['MissingFrontmatterAssociation'],
  },

  MissingContentForLayout: {
    filePath: 'app/views/layouts/application.liquid',
    content: '<html><body></body></html>\n',
    errors: ['MissingContentForLayout'],
  },

  MissingRenderPartialArguments: {
    // A DOCUMENTED partial: the `{% doc %}` block is an explicit contract, and this
    // blocking check owns it ALONE. `PartialCallArguments` deliberately does not fire here
    // — it covers only partials with no contract — so one mistake produces one finding.
    // Asserting the exact error list is what makes that observed rather than restated; the
    // control that `PartialCallArguments` still fires at all lives immediately below.
    project: {
      'app/views/partials/card.liquid': `{% doc %}
  @param title {string} Title
{% enddoc %}
{{ title }}
`,
    },
    filePath: PAGE,
    content: "{% render 'card' %}\n",
    errors: ['MissingRenderPartialArguments'],
  },

  YAMLSyntaxError: {
    // A model schema whose second property sits one column left of the sequence item above
    // it. `--dry-run` rejects this and fails the whole changeset.
    filePath: 'app/schema/car.yml',
    content: `name: car
properties:
 - name: make
   type: string
  year: 1
`,
    errors: ['YAMLSyntaxError'],
  },

  GraphQLCheck: {
    filePath: 'app/graphql/broken.graphql',
    content: 'query { no_such_root_field { id } }\n',
    errors: ['GraphQLCheck'],
  },

  GraphQLVariablesCheck: {
    // Passes a variable the operation does not declare, and omits the one it
    // requires — both are the same code.
    project: {
      'app/graphql/get_thing.graphql': 'query get_thing($id: ID!) { records { results { id } } }\n',
    },
    filePath: PAGE,
    content: "{% graphql g = 'get_thing', wrong_var: 1 %}\n",
    errors: ['GraphQLVariablesCheck'],
  },
};

/**
 * Codes REMOVED from `BLOCKING_CHECKS` because nothing this server accepts can produce
 * them, with the buffers that prove it.
 */
interface UnreachableProof {
  filePath: string;
  /** Content that WOULD produce the code, if the file were ever checked. */
  content: string;
}

const NEVER_REACHES_THE_GATE: Record<string, UnreachableProof> = {
  ValidJSON: { filePath: 'app/config.json', content: 'not a json value at all\n' },
  JSONSyntaxError: { filePath: 'app/views/pages/data.json', content: '{ "a": ,\n' },
};

/**
 * Whitespace between two Liquid tags, varied — the axis a fixture cannot exercise by being
 * minimal.
 */
const TAGS_APART = /%\}\s+\{%/g;
const TAGS_TOGETHER = /%\}\{%/g;

/** The distinct spellings of `content` that differ only in inter-tag whitespace. */
function adjacencyVariants(content: string): string[] {
  return [
    ...new Set([
      content,
      content.replace(TAGS_APART, '%}{%'),
      content.replace(
        TAGS_TOGETHER,
        `%}
{%`,
      ),
    ]),
  ];
}

describe('Integration: every blocking check can actually block', () => {
  const { write, validate } = tempProject('mcp-sup-emission-');

  it('has a fixture for every member of BLOCKING_CHECKS, and none for a non-member', () => {
    // The exhaustiveness guard: adding a member without evidence that it fires fails HERE,
    // rather than in production where a check that emits nothing is indistinguishable from
    // a clean file. There is no second list to fall back into.
    expect(Object.keys(EMITS).sort()).toEqual([...BLOCKING_CHECKS].sort());
  });

  it('does not gate on the two removed codes, however the buffer is spelled', () => {
    // Guards the removal itself: re-adding either without making `.json` reachable puts
    // back a member that cannot ever fire.
    expect(Object.keys(NEVER_REACHES_THE_GATE).map((code) => BLOCKING_CHECKS.has(code))).toEqual([
      false,
      false,
    ]);
  });

  for (const [code, fixture] of Object.entries(EMITS)) {
    it(`emits ${code} from a real buffer, and it blocks the write`, async () => {
      write(fixture.project);

      const result = await validate(fixture.filePath, fixture.content);

      expect({
        blocked: result.must_fix_before_write,
        status: result.status,
        errors: [...new Set(result.errors.map((error) => error.check))].sort(),
      }).toEqual({
        blocked: true,
        status: 'error',
        errors: [...fixture.errors].sort(),
      });
    });
  }

  /**
   * `hash_assign` is deprecated, so the fixture above pins the gate against the spelling an
   * author is being told to STOP writing. `assign` and `function` reach the same runtime
   * setter — measured, every container × subscript combination identical — and both carry a
   * second rule in `<<`, which needs an Array and refuses a Hash.
   */
  it('blocks a subscript write and an append through assign and function too', async () => {
    // `{% function %}` names a partial, so it needs a real one — otherwise `MissingPartial`
    // joins the verdict and the assertion stops being about this check. A function partial
    // hands its value back through `{% return %}`; without one it returns nil.
    write({ 'app/views/partials/p.liquid': "{% return 'x' %}\n" });

    const buffers = [
      // A subscript write onto a String. The runtime raises "x is abc, expected Hash or Array".
      `{% assign x = 'abc' %}{% assign x['k'] = 'v' %}`,
      // A DOT target onto the same String, which `hash_assign` cannot even parse and `assign`
      // can — so this shape is reachable only through `assign`.
      `{% assign x = 'abc' %}{% assign x.k = 'v' %}`,
      // An append onto a Hash. The runtime raises "x is {}, expected Array".
      `{% parse_json x %}{}{% endparse_json %}{% assign x << 1 %}`,
      // The same two rules under `function`, whose write semantics were measured rather
      // than assumed unmeasurable.
      `{% assign x = 'abc' %}{% function x['k'] = 'p' %}`,
      `{% parse_json x %}{}{% endparse_json %}{% function x << 'p' %}`,
    ];

    const verdicts = [];
    for (const content of buffers) {
      const result = await validate(PAGE, content);
      verdicts.push({
        blocked: result.must_fix_before_write,
        status: result.status,
        errors: [...new Set(result.errors.map((error) => error.check))].sort(),
      });
    }

    expect(verdicts).toEqual(
      buffers.map(() => ({
        blocked: true,
        status: 'error',
        errors: ['InvalidWriteTarget'],
      })),
    );
  });

  /**
   * THE CONTROL for the silence in the `MissingRenderPartialArguments` fixture, which
   * asserts `PartialCallArguments` does NOT fire for a DOCUMENTED partial. An assertion
   * that something does not fire is worth nothing alone — a check that had stopped working
   * entirely would satisfy it — so this proves the same code still fires on the case it
   * does own, from the same pipeline, and still does not gate the write.
   */
  it('PartialCallArguments still fires for an UNDOCUMENTED partial, and does not block', async () => {
    // No `{% doc %}` block, so the required param is INFERRED from the undefined
    // variable the partial reads. That inference is exactly why the code must not gate a
    // write: it is a heuristic, and the runtime failure it predicts is a nil value.
    write({ 'app/views/partials/bare.liquid': '{{ title }}\n' });

    const result = await validate(PAGE, "{% render 'bare' %}\n");

    expect({
      blocked: result.must_fix_before_write,
      status: result.status,
      errors: [...new Set(result.errors.map((error) => error.check))].sort(),
    }).toEqual({
      blocked: false,
      // Still an `error` in the list — de-escalation of the GATE, not suppression of
      // the finding. The agent is told; it is simply not stopped.
      status: 'error',
      errors: ['PartialCallArguments'],
    });
  });

  it('records which fixtures actually exercise tag adjacency', () => {
    // Not an exemption list — an OBSERVATION, pinned so it cannot drift silently. A fixture
    // rewritten into a single tag stops testing the axis, and stating today's answer is the
    // only way to notice.
    const withAxis = Object.entries(EMITS)
      .filter(([, fixture]) => adjacencyVariants(fixture.content).length > 1)
      .map(([code]) => code);

    expect(withAxis).toEqual(['InvalidWriteTarget']);
  });

  for (const [code, fixture] of Object.entries(EMITS)) {
    it(`${code}: inter-tag whitespace does not change the verdict`, async () => {
      write(fixture.project);
      const variants = adjacencyVariants(fixture.content);

      const verdicts = [];
      for (const content of variants) {
        const result = await validate(fixture.filePath, content);
        verdicts.push({
          blocked: result.must_fix_before_write,
          errors: [...new Set(result.errors.map((error) => error.check))].sort(),
        });
      }

      // Stated as AGREEMENT: every spelling must produce the SAME verdict, and the
      // expectation is written once, so a check that behaves differently across shapes
      // fails here instead of being encoded as though it were intended.
      const agreed = { blocked: true, errors: [...fixture.errors].sort() };
      expect(verdicts).toEqual(variants.map(() => agreed));
    });
  }

  for (const [code, proof] of Object.entries(NEVER_REACHES_THE_GATE)) {
    it(`cannot reach ${code}: the only files that produce it are never checked`, async () => {
      const result = await validate(proof.filePath, proof.content);

      expect({
        status: result.status,
        reason: result.not_applicable_reason,
        blocked: result.must_fix_before_write,
        errors: result.errors,
      }).toEqual({
        status: 'not_applicable',
        reason: 'unsupported_type',
        blocked: false,
        errors: [],
      });
    });
  }

  /**
   * The server instructions name filters-in-conditions as a blocking construct and
   * filters-in-tag-operands as explicitly NOT reported. Both halves are pinned HERE, through
   * the real pipeline, because prose cannot fail.
   */
  const FILTER_REFUSED_BY_THE_CONVERTER = [
    "{% if 'a' | upcase == 'A' %}y{% endif %}\n",
    "{% unless 'a' | upcase == 'A' %}y{% endunless %}\n",
    "{% if false %}n{% elsif 'a' | upcase == 'A' %}y{% endif %}\n",
    "{% for i in 'a,b' | split: ',' %}{{ i }}{% endfor %}\n",
  ];

  const FILTER_ACCEPTED_BY_THE_CONVERTER = [
    "{% cache 'k' | append: '1' %}x{% endcache %}\n",
    "{% log 'msg' | upcase %}\n",
    "{% yield 'slot' | upcase %}\n",
    "{% redirect_to '/p' | append: '/x' %}\n",
    "{% case 'a' | upcase %}{% when 'A' %}y{% endcase %}\n",
    "{% cycle 'a' | upcase, 'b' %}\n",
  ];

  it('blocks a filter inside a condition, exactly as the instructions claim', async () => {
    const verdicts = [];
    for (const content of FILTER_REFUSED_BY_THE_CONVERTER) {
      const result = await validate(PAGE, content);
      verdicts.push({
        blocked: result.must_fix_before_write,
        errors: [...new Set(result.errors.map((error) => error.check))],
      });
    }

    // The block here is OVER-DETERMINED, measured by sabotage: deleting
    // `checkFilterInCondition` leaves it green (a truthiness heuristic fires instead), and
    // so does widening the grammar (stage 2 then throws). So this pins the CLAIM the
    // instructions make — these constructs block — not which rule produces it. That is
    // pinned in check-common's `InvalidConditionalNode.spec.ts`.
    expect(verdicts).toEqual(
      FILTER_REFUSED_BY_THE_CONVERTER.map(() => ({
        blocked: true,
        errors: ['LiquidHTMLSyntaxError'],
      })),
    );
  });

  /**
   * A space between a variable and its key path is a PARSE ERROR on the platform in a write target
   * and legal in a read, so the gate has to split them. `pos-cli deploy --dry-run` REJECTS the write
   * forms 2/2 with their space-free controls accepted — the whole changeset, not one file. Which
   * spellings parse is pinned in `liquid-html-parser`'s `assign-target-spacing.spec.ts`; this pins
   * the verdict an agent actually receives.
   */
  const SPACED_WRITE_TARGET = [
    `{% assign h = '{}' | parse_json %}{% assign h ['k'] = 9 %}\n`,
    `{% assign h = '{}' | parse_json %}{% assign h .k = 9 %}\n`,
    `{% assign h = '{}' | parse_json %}{% hash_assign h ['k'] = 9 %}\n`,
    `{% function r ['k'] = 'lib/x' %}\n`,
  ];

  const SPACED_READ = [
    `{% assign h = '{}' | parse_json %}{{ h ['k'] }}\n`,
    `{% assign h = '{}' | parse_json %}{{ h.a [0] }}\n`,
    `{% assign h = '{}' | parse_json %}{% assign v = h ['k'] %}{{ v }}\n`,
    `{% assign h = '{}' | parse_json %}{% echo h ['k'] %}\n`,
  ];

  it('blocks a spaced WRITE target, which the deploy converter rejects', async () => {
    const verdicts = [];
    for (const content of SPACED_WRITE_TARGET) {
      const result = await validate(PAGE, content);
      verdicts.push({
        blocked: result.must_fix_before_write,
        errors: [...new Set(result.errors.map((error) => error.check))],
      });
    }

    expect(verdicts).toEqual(
      SPACED_WRITE_TARGET.map(() => ({ blocked: true, errors: ['LiquidHTMLSyntaxError'] })),
    );
  });

  it('does not block the same spacing in a READ, which the platform resolves correctly', async () => {
    // The control for the test above. Refusing every spaced subscript would pass without it.
    const verdicts = [];
    for (const content of SPACED_READ) {
      const result = await validate(PAGE, content);
      verdicts.push({
        blocked: result.must_fix_before_write,
        errors: [...new Set(result.errors.map((error) => error.check))],
      });
    }

    expect(verdicts).toEqual(SPACED_READ.map(() => ({ blocked: false, errors: [] })));
  });

  it('does not BLOCK a filter in a tag operand, but does warn that it has no effect', async () => {
    // The control for the test above, in both halves.
    const verdicts = [];
    for (const content of FILTER_ACCEPTED_BY_THE_CONVERTER) {
      const result = await validate(PAGE, content);
      verdicts.push({
        blocked: result.must_fix_before_write,
        errors: result.errors,
        warnings: [...new Set(result.warnings.map((warning) => warning.check))],
      });
    }

    expect(verdicts).toEqual(
      FILTER_ACCEPTED_BY_THE_CONVERTER.map(() => ({
        blocked: false,
        errors: [],
        warnings: ['FilterWithoutEffect'],
      })),
    );
  });

  /**
   * The instructions promise two things about tag argument types, both pinned here because
   * prose cannot fail: an argument the documentation TYPES warns and does not block, and an
   * argument it says nothing about is not reported at all.
   */
  it('warns on a mistyped tag argument and stays silent on an undocumented one, as the instructions claim', async () => {
    const typed = await validate(
      PAGE,
      `{% assign y = 'a,b' | split: ',' %}{% for x in y limit: 'ten' %}{{ x }}{% endfor %}\n`,
    );
    const alsoTyped = await validate(PAGE, `{% cache 'k', expire: 'soon' %}body{% endcache %}\n`);
    const undocumented = await validate(
      PAGE,
      `{% cache 'k', not_in_the_docs: 'soon' %}body{% endcache %}\n`,
    );

    const verdict = (result: Awaited<ReturnType<typeof validate>>) => ({
      blocked: result.must_fix_before_write,
      warnings: [...new Set(result.warnings.map((warning) => warning.check))],
    });

    expect({
      typed: verdict(typed),
      alsoTyped: verdict(alsoTyped),
      undocumented: verdict(undocumented),
    }).toEqual({
      typed: { blocked: false, warnings: ['ValidTagArgumentTypes'] },
      alsoTyped: { blocked: false, warnings: ['ValidTagArgumentTypes'] },
      undocumented: { blocked: false, warnings: [] },
    });
  });

  /**
   * The FILTER half of the same promise, and the half the instructions have to be careful
   * about. A core Liquid filter COERCES rather than refuses — `{{ 5 | upcase }}` renders,
   * measured against a live instance — so nothing is reported about it, whether or not the
   * docset yet separates `object` (a Hash) from `untyped` (several types accepted).
   */
  it('never blocks on a filter argument, and stays silent on one that coerces, as the instructions claim', async () => {
    const coercing = await validate(PAGE, `{{ 5 | upcase }}\n`);
    const wrongHash = await validate(PAGE, `{{ 123 | hash_add_key: 'k', 'v' }}\n`);

    expect({
      coercing: {
        blocked: coercing.must_fix_before_write,
        warnings: [...new Set(coercing.warnings.map((warning) => warning.check))],
      },
      wrongHash: { blocked: wrongHash.must_fix_before_write },
    }).toEqual({
      coercing: { blocked: false, warnings: [] },
      wrongHash: { blocked: false },
    });
  });

  /**
   * The instructions promise two things about duplicate YAML keys, and this pins BOTH
   * against the real pipeline.
   */
  it('reports a duplicate YAML key with the same spelling, without blocking', async () => {
    const previouslyMissed = ['y', '0X10', '1e3', '.inf', '.nan', '1:30', '2026-01-01'];

    const verdicts = [];
    for (const token of previouslyMissed) {
      const result = await validate(
        'app/translations/en.yml',
        `en:\n  ${token}: x\n  ${token}: y\n`,
      );
      verdicts.push({
        blocked: result.must_fix_before_write,
        warnings: [...new Set(result.warnings.map((warning) => warning.check))],
      });
    }

    expect(verdicts).toEqual(
      previouslyMissed.map(() => ({ blocked: false, warnings: ['DuplicateYAMLKey'] })),
    );
  });

  it('stays silent on the look-alike pairs it cannot decide, which is why the instructions say so', async () => {
    // Each is ONE key to Psych and TWO to npm `yaml`, with no reconciliation available —
    // `1:30` is 5400 to Ruby and 90 here. Reported as a gap in the instructions rather than
    // guessed at, because a duplicate claimed where the platform keeps two keys invites
    // deleting a working key.
    const undecidable: Array<[string, string]> = [
      ['1:30', '5400'],
      ['"0X10"', '0X10'],
      ['"1e3"', '1e3'],
      ['"y"', 'y'],
    ];

    const warnings = [];
    for (const [first, second] of undecidable) {
      const result = await validate(
        'app/translations/en.yml',
        `en:\n  ${first}: x\n  ${second}: y\n`,
      );
      warnings.push(result.warnings.map((warning) => warning.check));
    }

    expect(warnings).toEqual(undecidable.map(() => []));
  });

  it('routes no supported file type to the JSON checks, which is WHY those two were removed', () => {
    // The cause behind the two results above, asserted structurally so it does not rest on
    // two hand-picked paths: every extension `isSupportedSourceFile` admits, paired with
    // the type check-common parses it as.
    const rootUri = 'file:///p';
    const samples = [
      'file:///p/app/views/pages/index.liquid',
      'file:///p/app/graphql/get_thing.graphql',
      'file:///p/app/translations/en.yml',
      'file:///p/app/model_schemas/thing.yml',
      // THE NEGATIVE CONTROL: `.yaml` reads as a YAML file to every human and is not a
      // platformOS extension — every YAML model on the backend anchors `\.yml\z` — so it is
      // refused, and it is also the one sample that reaches the JSON fallback. A list of
      // nothing but `true` rows could not tell the two halves of the invariant apart.
      'file:///p/app/model_schemas/thing.yaml',
    ];

    expect(
      samples.map((uri) => [isSupportedSourceFile(uri, rootUri), toSourceCode(uri, '').type]),
    ).toEqual([
      [true, SourceCodeType.LiquidHtml],
      [true, SourceCodeType.GraphQL],
      [true, SourceCodeType.YAML],
      [true, SourceCodeType.YAML],
      [false, SourceCodeType.JSON],
    ]);
  });
});

/**
 * Every member of `BLOCKING_CHECKS` must stay SILENT on input the platform accepts.
 *
 * The mirror of the "can actually block" group above; between them they state the whole
 * promise. The half defended here shipped a false block once already: `yaml` defaults
 * `uniqueKeys` to `true`, so a duplicated key that `--dry-run` accepts became
 * `must_fix_before_write: true` while two documents stated, from correct measurement, that
 * duplicates are not reported. Prose cannot fail.
 *
 * THE ASYMMETRY THAT JUSTIFIES THE COST. A missed detection returns a broken file the agent
 * finds out about later; a FALSE BLOCK is an unappealable refusal, with no override. Every
 * one found so far was found by an external evaluator driving a live instance, never by a
 * suite — this file is how that becomes a CI failure instead.
 *
 * WHAT MAKES A FIXTURE ADMISSIBLE: only input whose validity was ESTABLISHED. Every entry
 * records the oracle that settled it (see {@link Oracle}), because a fixture asserted valid
 * on its author's confidence pins a guess.
 *
 * WHY THE WHOLE PIPELINE. Silence has two independent causes — the check declining to
 * report, and the supervisor never routing the file to it — and only the first is
 * interesting here. End to end, a fixture that goes quiet because routing broke fails in
 * the emission suite instead of passing quietly in this one.
 *
 * CONTROLS LIVE IN THE EMISSION SUITE, deliberately not duplicated: an assertion that
 * nothing was reported is satisfied equally well by a check that stopped working. The
 * single exception is the YAML control below, because suppressing `DUPLICATE_KEY` is the
 * specific edit that could widen into hiding a real parse failure.
 */

/**
 * What established that a fixture is valid input. Never a guess, and never "it looks
 * fine" — each value names a thing that was actually run.
 */
type Oracle =
  /** `pos-cli deploy --dry-run` accepted this shape. Round-4 evaluation, O1c. */
  | 'dry-run'
  /** Executed through `liquid_exec` and rendered. Round-4 evaluation, O1a. */
  | 'runtime'
  /**
   * Follows from the filter vocabulary the platform PUBLISHES — name, arity and return
   * type, each derived upstream from the Ruby signature and shipped in `filters.json`. No
   * table in this repository answers any of the three.
   */
  | 'generated-data'
  /**
   * Valid because the thing it references exists in the fixture project — the partial
   * is written to disk, the operation declares the variable being passed, the layout
   * outputs `content_for_layout`. Nothing external is being claimed.
   */
  | 'by-construction'
  /** Valid against the project's GraphQL schema, which the check validates against. */
  | 'schema';

interface SilenceFixture {
  /** Names the shape, so a failure says which one. */
  name: string;
  /** Files written to the temp project before the call. */
  project?: Record<string, string>;
  filePath: string;
  content: string;
  oracle: Oracle;
}

const SCHEMA = 'app/schema/thing.yml';
const TRANSLATIONS = 'app/translations/en.yml';

/** Nesting deep enough to be unusual, shallow enough to be a real file. */
const deeplyNested = (levels: number): string => {
  let out = '';
  for (let index = 0; index < levels; index++) out += `${'  '.repeat(index)}k${index}:\n`;
  return `${out}${'  '.repeat(levels)}leaf: 1\n`;
};

/**
 * Valid-but-unusual YAML, imported from the round-4 evaluation rather than re-derived.
 *
 * That round deployed 52 shapes individually through `--dry-run` and the converter accepted
 * 50; the two it refused are the duplicate-key case, included for that reason. Re-deriving
 * the corpus would mean re-running a live instance or guessing.
 */
const VALID_YAML: Record<string, string> = {
  anchor_and_alias: `base: &b
  a: 1
other: *b
`,
  merge_key: `base: &b
  a: 1
child:
  <<: *b
  c: 2
`,
  merge_key_multi_source: `a: &a
  x: 1
b: &b
  y: 2
c:
  <<: [*a, *b]
`,
  block_scalar_literal: `name: |
  line one
  line two
`,
  block_scalar_folded: `name: >
  folded text here
`,
  block_scalar_strip: `name: |-
  no trailing newline
`,
  block_scalar_keep: 'name: |+\n  keep\n\n',
  block_scalar_explicit_indent: `name: |2
   two space indent
`,
  explicit_tags: `a: !!str 5
b: !!int "7"
c: !!seq [1, 2]
`,
  custom_tag: 'a: !mytag foo\n',
  quoted_scalar_with_colon: 'a: "x: y"\n',
  quoted_scalar_with_hash: "a: 'c # d'\n",
  quoted_scalar_with_tab: 'a: "tab\there"\n',
  empty_document: '',
  comments_only: '# nothing here\n',
  byte_order_mark: '\uFEFFname: car\n',
  crlf_line_endings: 'name: car\r\nother: 1\r\n',
  document_start_marker: `---
name: car
`,
  document_end_marker: `name: car
...
`,
  multi_document: `name: a
---
name: b
`,
  bare_scalar: 'just a string\n',
  top_level_sequence: `- 1
- 2
`,
  deep_nesting: deeplyNested(60),
  very_long_line: `name: ${'x'.repeat(20000)}\n`,
  non_ascii_keys: `zażółć: gęślą
ключ: значение
`,
  emoji_key_and_value: `"🎉": party
value: "🚀"
`,
  yaml_directive: `%YAML 1.2
---
name: car
`,
  complex_key: `? [a, b]
: value
`,
  flow_collections: 'a: {b: 1, c: [1, 2]}\n',
  infinity_and_nan: `a: .inf
b: -.inf
c: .nan
`,
  octal_and_hex: `a: 0o14
b: 0x1F
`,
  timestamps: `a: 2026-01-01
b: 2026-01-01T12:00:00Z
`,
  empty_values: `a:
b:
`,
  explicit_nulls: `a: ~
b: null
`,
  duplicate_key_top_level: `name: car
name: van
`,
  duplicate_key_nested: `name: car
properties:
  make: ford
  make: audi
`,
};

/** Every shape, in a model schema and in a translation file. */
const yamlFixtures = (): SilenceFixture[] =>
  Object.entries(VALID_YAML).flatMap(([name, content]) => [
    { name, filePath: SCHEMA, content, oracle: 'dry-run' as const },
    { name: `${name} (translations)`, filePath: TRANSLATIONS, content, oracle: 'dry-run' as const },
  ]);

const EXISTING_PARTIALS = {
  'app/views/partials/card.liquid': 'card body\n',
  'app/lib/helper.liquid': 'helper body\n',
};

const DOCUMENTED_PARTIAL = {
  'app/views/partials/card.liquid': `{% doc %}
  @param title {string} Title
{% enddoc %}
{{ title }}
`,
};

const GRAPHQL_OPERATION = {
  'app/graphql/get_thing.graphql':
    'query get_thing($id: ID!) { records(per_page: 10) { results { id } } }\n',
};

/**
 * Keyed by blocking check. The keys are pinned against `BLOCKING_CHECKS` below, so a
 * member added without must-stay-silent coverage fails here rather than shipping with
 * only half its promise defended.
 */
const STAYS_SILENT: Record<string, SilenceFixture[]> = {
  YAMLSyntaxError: yamlFixtures(),

  LiquidHTMLSyntaxError: [
    // Liquid the parser must accept. `by-construction` because the claim is only that
    // these parse — the evaluations render pages built from exactly these constructs.
    {
      name: 'if block',
      filePath: PAGE,
      content: '{% if true %}x{% endif %}\n',
      oracle: 'by-construction',
    },
    {
      name: 'whitespace control',
      filePath: PAGE,
      content: '{%- if true -%}x{%- endif -%}\n',
      oracle: 'by-construction',
    },
    {
      name: 'liquid tag',
      filePath: PAGE,
      content: `{% liquid
  assign a = 1
  echo a
%}
`,
      oracle: 'by-construction',
    },
    {
      name: 'raw block',
      filePath: PAGE,
      content: '{% raw %}{{ not_liquid }}{% endraw %}\n',
      oracle: 'by-construction',
    },
    {
      name: 'case block',
      filePath: PAGE,
      content: '{% assign x = 1 %}{% case x %}{% when 1 %}a{% else %}b{% endcase %}\n',
      oracle: 'by-construction',
    },
    {
      name: 'for over a range',
      filePath: PAGE,
      content: '{% for i in (1..3) %}{{ i }}{% endfor %}\n',
      oracle: 'by-construction',
    },
    {
      name: 'liquid inside an html attribute',
      filePath: PAGE,
      content: '<div data-x="{{ 1 }}">{{ 2 }}</div>\n',
      oracle: 'by-construction',
    },
    {
      name: 'comment block',
      filePath: PAGE,
      content: '{% comment %}hi{% endcomment %}\n',
      oracle: 'by-construction',
    },
    {
      name: 'nested tags',
      filePath: PAGE,
      content: '{% if true %}{% for i in (1..2) %}{{ i }}{% endfor %}{% endif %}\n',
      oracle: 'by-construction',
    },
    {
      name: 'filter chain',
      filePath: PAGE,
      content: "{{ 'a' | upcase | downcase }}\n",
      oracle: 'generated-data',
    },
  ],

  MissingPartial: [
    {
      name: 'render a partial that exists',
      project: EXISTING_PARTIALS,
      filePath: PAGE,
      content: "{% render 'card' %}\n",
      oracle: 'by-construction',
    },
    {
      name: 'function against app/lib',
      project: EXISTING_PARTIALS,
      filePath: PAGE,
      content: "{% function res = 'helper' %}{{ res }}\n",
      oracle: 'by-construction',
    },
  ],

  UnknownFilter: [
    // The vocabulary is generated data, so a documented filter is valid by
    // measurement rather than by recognition.
    {
      name: 'documented filters',
      filePath: PAGE,
      content: "{{ 'a' | upcase }}{{ 'B' | downcase }}{{ 1 | plus: 2 }}\n",
      oracle: 'generated-data',
    },
    // Liquid's own filters, which the docs API used to omit while the runtime accepted
    // them. Reporting one is a false block on working code; the platform publishing the
    // whole vocabulary is what replaced the local list of six names that prevented it.
    {
      name: 'undocumented but valid: sum',
      filePath: PAGE,
      content: "{% assign arr = '1,2' | split: ',' %}{{ arr | sum }}\n",
      oracle: 'generated-data',
    },
    {
      name: 'undocumented but valid: where',
      filePath: PAGE,
      content: "{% assign arr = '1,2' | split: ',' %}{{ arr | where: 'k', 'v' }}\n",
      oracle: 'generated-data',
    },
  ],

  FilterArity: [
    // Argument counts the measured table permits, at both ends of a range.
    {
      name: 'exactly the minimum',
      filePath: PAGE,
      content: "{{ 'a' | upcase }}\n",
      oracle: 'generated-data',
    },
    {
      name: 'exactly two',
      filePath: PAGE,
      content: "{{ 'a' | append: 'b' }}\n",
      oracle: 'generated-data',
    },
    {
      name: 'inside a range',
      filePath: PAGE,
      content: "{{ 'a' | default: 'd' }}\n",
      oracle: 'generated-data',
    },
    // `array_map` is one of four filters the generator could not determine and left
    // ABSENT rather than guessed. A filter with no measured arity must produce nothing,
    // whatever it is passed — the property the check was admitted to the blocking set on.
    {
      name: 'a filter with no measured arity',
      filePath: PAGE,
      content: "{% assign arr = '1,2' | split: ',' %}{{ arr | array_map: 'k' }}\n",
      oracle: 'generated-data',
    },
  ],

  JsonLiteralQuoteStyle: [
    {
      name: 'double-quoted object literal',
      filePath: PAGE,
      content: '{% assign o = {"k": "v"} %}{{ o }}\n',
      oracle: 'dry-run',
    },
    {
      name: 'double-quoted array literal',
      filePath: PAGE,
      content: '{% assign a = ["x", "y"] %}{{ a }}\n',
      oracle: 'dry-run',
    },
    // Single quotes are only a defect INSIDE a JSON literal. An ordinary
    // single-quoted string is the common case and must never be touched.
    {
      name: 'an ordinary single-quoted string',
      filePath: PAGE,
      content: "{% assign s = 'plain' %}{{ s }}\n",
      oracle: 'dry-run',
    },
  ],

  GraphQLCheck: [
    // A FIXTURE ERROR WORTH RECORDING. Both of these began as `records { results { id } }`;
    // the schema requires `per_page`, so the check reported them and the "silence"
    // fixtures were simply wrong. An observation about the input, read as an observation
    // about the tool.
    {
      name: 'valid query with a declared variable',
      filePath: 'app/graphql/get_thing.graphql',
      content:
        'query get_thing($per_page: Int!) { records(per_page: $per_page) { results { id } } }\n',
      oracle: 'schema',
    },
    {
      name: 'valid query with no variables',
      filePath: 'app/graphql/plain.graphql',
      content: 'query plain { records(per_page: 10) { results { id } } }\n',
      oracle: 'schema',
    },
  ],

  GraphQLVariablesCheck: [
    {
      name: 'passes the declared variable',
      project: GRAPHQL_OPERATION,
      filePath: PAGE,
      content: "{% graphql g = 'get_thing', id: 1 %}{{ g }}\n",
      oracle: 'by-construction',
    },
  ],

  InvalidWriteTarget: [
    // From the round-4 structural set: 31 cases, zero false blocks, each run in both
    // tag spacings. These are the shapes the runtime ACCEPTS — a Hash takes a key, an
    // Array takes an index — which is exactly the distinction the check models.
    {
      name: 'hash with a key',
      filePath: PAGE,
      content: `{% assign h = '{}' | parse_json %}
{% hash_assign h['k'] = 'v' %}
`,
      oracle: 'runtime',
    },
    {
      name: 'array with an index',
      filePath: PAGE,
      content: `{% assign a = '1,2' | split: ',' %}
{% hash_assign a[0] = 'v' %}
`,
      oracle: 'runtime',
    },
    // A variable subscript cannot be resolved statically, so the accessor is unknown
    // and the check must decline rather than guess.
    {
      name: 'variable subscript',
      filePath: PAGE,
      content: `{% assign h = '{}' | parse_json %}
{% assign k = 'a' %}
{% hash_assign h[k] = 'v' %}
`,
      oracle: 'runtime',
    },
    // Never assigned in this file. It raises at runtime HERE, but in a partial the same
    // variable legitimately arrives as a render argument, so silence is deliberate.
    {
      name: 'target never assigned in this file',
      filePath: PAGE,
      content: "{% hash_assign x['k'] = 'v' %}\n",
      oracle: 'by-construction',
    },
    // `assign` writes into a Hash too, and is what an author should reach for now that
    // `hash_assign` is deprecated. The same accepted shapes, under the tag that is not
    // going away — plus the two `assign` has and `hash_assign` does not.
    {
      name: 'assign: hash with a key',
      filePath: PAGE,
      content: `{% assign h = '{}' | parse_json %}
{% assign h['k'] = 'v' %}
`,
      oracle: 'runtime',
    },
    {
      name: 'assign: array with an index',
      filePath: PAGE,
      content: `{% assign a = '1,2' | split: ',' %}
{% assign a[0] = 'v' %}
`,
      oracle: 'runtime',
    },
    // The shape a rule generalised from `hash_assign` would refuse. Measured with the hash
    // read back: it writes the key `k`. `hash_assign h.k` raises a PARSE-time syntax error,
    // and that difference is notation, not semantics.
    {
      name: 'assign: DOT target on a hash, which hash_assign cannot parse',
      filePath: PAGE,
      content: `{% assign h = '{}' | parse_json %}
{% assign h.k = 'v' %}
`,
      oracle: 'runtime',
    },
    {
      name: 'assign: append to an array',
      filePath: PAGE,
      content: `{% assign a = '1,2' | split: ',' %}
{% assign a << 3 %}
`,
      oracle: 'runtime',
    },
    // The false block this suite exists to catch: a write INTO a hash does not replace
    // it, so the SECOND write must not be refused as a write onto the first one's value.
    {
      name: 'assign: two writes into the same hash',
      filePath: PAGE,
      content: `{% assign h = '{}' | parse_json %}
{% assign h['k'] = 'v' %}
{% hash_assign h['j'] = 'w' %}
`,
      oracle: 'runtime',
    },
  ],

  MissingRenderPartialArguments: [
    {
      name: 'passes the required parameter',
      project: DOCUMENTED_PARTIAL,
      filePath: PAGE,
      content: "{% render 'card', title: 'x' %}\n",
      oracle: 'by-construction',
    },
  ],

  InvalidFrontmatterSyntax: [
    {
      name: 'a well-formed block',
      filePath: PAGE,
      content: '---\nslug: probe\nmethod: get\n---\n<p>hi</p>\n',
      oracle: 'dry-run',
    },
    {
      name: 'a nested mapping and a sequence',
      filePath: PAGE,
      content: '---\nslug: probe\nmetadata:\n  title: Notes\n---\n<p>hi</p>\n',
      oracle: 'dry-run',
    },
  ],

  UnknownFrontmatterField: [
    {
      name: 'only keys the Page schema declares',
      filePath: PAGE,
      content: '---\nslug: probe\nmethod: get\n---\n<p>hi</p>\n',
      oracle: 'dry-run',
    },
    {
      name: 'a file type with no frontmatter schema takes arbitrary keys',
      filePath: 'app/migrations/20240101_seed.liquid',
      content: '---\nanything_at_all: 1\n---\n',
      oracle: 'dry-run',
    },
  ],

  InvalidFrontmatterValue: [
    {
      name: 'a method the platform accepts',
      filePath: PAGE,
      content: '---\nmethod: post\n---\n<p>hi</p>\n',
      oracle: 'dry-run',
    },
    {
      name: "layout: '' disables the layout, which is the supported spelling",
      filePath: PAGE,
      content: "---\nlayout: ''\n---\n<p>hi</p>\n",
      oracle: 'dry-run',
    },
  ],

  MissingLayout: [
    {
      name: 'a layout the project contains',
      project: {
        'app/views/layouts/application.liquid':
          '<html><body>{{ content_for_layout }}</body></html>\n',
      },
      filePath: PAGE,
      content: '---\nlayout: application\n---\n<p>hi</p>\n',
      oracle: 'dry-run',
    },
    {
      name: 'a Liquid-interpolated layout, which resolves at render time',
      filePath: PAGE,
      content: '---\nlayout: "{{ context.location }}"\n---\n<p>hi</p>\n',
      oracle: 'dry-run',
    },
  ],

  MissingFrontmatterAssociation: [
    {
      name: 'a policy the project contains',
      project: { 'app/authorization_policies/require_login.liquid': 'true\n' },
      filePath: PAGE,
      content: '---\nauthorization_policies:\n  - require_login\n---\n<p>hi</p>\n',
      oracle: 'dry-run',
    },
    {
      name: 'no association array at all',
      filePath: PAGE,
      content: '---\nslug: probe\n---\n<p>hi</p>\n',
      oracle: 'dry-run',
    },
  ],

  MissingContentForLayout: [
    {
      name: 'layout outputs content_for_layout',
      filePath: 'app/views/layouts/application.liquid',
      content: '<html><body>{{ content_for_layout }}</body></html>\n',
      oracle: 'by-construction',
    },
  ],
};

describe('Integration: every blocking check stays silent on input the platform accepts', () => {
  const { write, validate } = tempProject('mcp-sup-silence-');

  /**
   * What a fixture must produce. `blocked` covers the whole gate rather than the one
   * code, so a fixture that trips a DIFFERENT blocking check fails too — which is
   * correct, because such a fixture is not valid input after all.
   */
  const observe = async (code: string, fixture: SilenceFixture) => {
    write(fixture.project);
    const result = await validate(fixture.filePath, fixture.content);
    const everyDiagnostic = [...result.errors, ...result.warnings, ...result.infos];
    return {
      name: fixture.name,
      blocked: result.must_fix_before_write,
      fromCheck: everyDiagnostic
        .filter((diagnostic) => diagnostic.check === code)
        .map(({ check, message }) => `${check}: ${message}`),
    };
  };

  const silent = (fixture: SilenceFixture) => ({
    name: fixture.name,
    blocked: false,
    fromCheck: [] as string[],
  });

  it('has must-stay-silent coverage for every member of BLOCKING_CHECKS', () => {
    // The exhaustiveness guard: a new blocking code must arrive with BOTH halves of its
    // promise — a fixture in the emission suite proving it fires, and at least one here
    // proving where it does not.
    expect(Object.keys(STAYS_SILENT).sort()).toEqual([...BLOCKING_CHECKS].sort());
  });

  it('has at least one fixture per member, with the corpus size pinned per code', () => {
    // Pinned, not merely non-empty: the cheapest way to make a failure disappear is to
    // delete the case that produced it, so a changed count has to be changed here too.
    expect(
      Object.fromEntries(
        Object.entries(STAYS_SILENT).map(([code, fixtures]) => [code, fixtures.length]),
      ),
    ).toEqual({
      YAMLSyntaxError: 72,
      LiquidHTMLSyntaxError: 10,
      MissingPartial: 2,
      UnknownFilter: 3,
      FilterArity: 4,
      JsonLiteralQuoteStyle: 3,
      GraphQLCheck: 2,
      GraphQLVariablesCheck: 1,
      InvalidWriteTarget: 9,
      MissingRenderPartialArguments: 1,
      MissingContentForLayout: 1,
      InvalidFrontmatterSyntax: 2,
      UnknownFrontmatterField: 2,
      InvalidFrontmatterValue: 2,
      MissingLayout: 2,
      MissingFrontmatterAssociation: 2,
    });
  });

  it('records the oracle behind every fixture, and which codes rest on which', () => {
    // An OBSERVATION, pinned so provenance cannot quietly weaken. `by-construction` is the
    // weakest claim available, so a code drifting toward it is a real loss of evidence.
    const oraclesByCode = Object.fromEntries(
      Object.entries(STAYS_SILENT).map(([code, fixtures]) => [
        code,
        [...new Set(fixtures.map((fixture) => fixture.oracle))].sort(),
      ]),
    );

    expect(oraclesByCode).toEqual({
      YAMLSyntaxError: ['dry-run'],
      LiquidHTMLSyntaxError: ['by-construction', 'generated-data'],
      MissingPartial: ['by-construction'],
      UnknownFilter: ['generated-data'],
      FilterArity: ['generated-data'],
      JsonLiteralQuoteStyle: ['dry-run'],
      GraphQLCheck: ['schema'],
      GraphQLVariablesCheck: ['by-construction'],
      InvalidWriteTarget: ['by-construction', 'runtime'],
      MissingRenderPartialArguments: ['by-construction'],
      MissingContentForLayout: ['by-construction'],
      InvalidFrontmatterSyntax: ['dry-run'],
      UnknownFrontmatterField: ['dry-run'],
      InvalidFrontmatterValue: ['dry-run'],
      MissingLayout: ['dry-run'],
      MissingFrontmatterAssociation: ['dry-run'],
    });
  });

  for (const [code, fixtures] of Object.entries(STAYS_SILENT)) {
    it(`${code}: reports nothing, and blocks nothing, on valid input`, async () => {
      const observed = [];
      for (const fixture of fixtures) {
        observed.push(await observe(code, fixture));
      }

      // Whole-value across the entire corpus, so a failure names the shape and the
      // message it wrongly produced rather than just a count.
      expect(observed).toEqual(fixtures.map(silent));
    }, 120_000);
  }

  it('records which fixtures actually exercise tag adjacency', () => {
    // The same observation the emission suite pins, and measured rather than predicted:
    // `UnknownFilter` does NOT carry the axis, because its fixtures pair a `{% assign %}`
    // with an `{{ output }}` and the axis only exists between two `{% %}` tags.
    const withAxis = Object.entries(STAYS_SILENT)
      .filter(([, fixtures]) =>
        fixtures.some((fixture) => adjacencyVariants(fixture.content).length > 1),
      )
      .map(([code]) => code);

    expect(withAxis).toEqual(['LiquidHTMLSyntaxError', 'InvalidWriteTarget']);
  });

  for (const [code, fixtures] of Object.entries(STAYS_SILENT)) {
    const multiTag = fixtures.filter((fixture) => adjacencyVariants(fixture.content).length > 1);
    if (multiTag.length === 0) continue;

    it(`${code}: inter-tag whitespace does not break the silence`, async () => {
      const observed = [];
      const expected = [];
      for (const fixture of multiTag) {
        for (const content of adjacencyVariants(fixture.content)) {
          observed.push(await observe(code, { ...fixture, content }));
          expected.push(silent(fixture));
        }
      }

      expect(observed).toEqual(expected);
    }, 120_000);
  }

  it('still refuses YAML that genuinely does not parse, in every admitted location', async () => {
    // The one control kept here rather than left to the emission suite. Suppressing
    // `DUPLICATE_KEY` is an edit that could widen into hiding real parse failures, and
    // the whole YAML corpus above would pass just as happily if it had.
    const broken = `name: car
properties: [unclosed
`;
    const locations = [
      SCHEMA,
      TRANSLATIONS,
      'app/transactable_types/t.yml',
      'app/user_profile_types/u.yml',
    ];

    const observed = [];
    for (const filePath of locations) {
      const result = await validate(filePath, broken);
      observed.push({
        filePath,
        blocked: result.must_fix_before_write,
        errors: [...new Set(result.errors.map((error) => error.check))],
      });
    }

    // Expectation built from the INPUT list, not from what was observed — otherwise a
    // run that produced fewer results than locations would pass.
    expect(observed).toEqual(
      locations.map((filePath) => ({ filePath, blocked: true, errors: ['YAMLSyntaxError'] })),
    );
  }, 120_000);

  it('reports a duplicate key as a non-blocking WARNING, not as silence and not as a block', async () => {
    // Once `DuplicateYAMLKey` landed, "no diagnostic at all" and "no block" stopped being
    // the same claim, and only the second is the promise this server makes. So the absence
    // of a block is asserted together with the PRESENCE of the advisory: asserting only the
    // silence would let the check be deleted, asserting only the warning would let it drift
    // onto the write gate.
    const observed = [];
    for (const [name, content] of [
      [
        'top level',
        `name: car
name: van
`,
      ],
      [
        'nested',
        `name: car
properties:
  make: ford
  make: audi
`,
      ],
    ] as const) {
      const result = await validate(SCHEMA, content);
      observed.push({
        name,
        blocked: result.must_fix_before_write,
        errorChecks: [...new Set(result.errors.map((error) => error.check))],
        warningChecks: [...new Set(result.warnings.map((warning) => warning.check))],
      });
    }

    expect(observed).toEqual([
      { name: 'top level', blocked: false, errorChecks: [], warningChecks: ['DuplicateYAMLKey'] },
      { name: 'nested', blocked: false, errorChecks: [], warningChecks: ['DuplicateYAMLKey'] },
    ]);
  }, 120_000);

  it('reports a duplicate FRONTMATTER key the same way, in a .liquid file', async () => {
    // The Liquid-side counterpart of the case above. It travels a different route entirely —
    // `DuplicateYAMLKey` is a YAML-typed check and never sees a `.liquid` file — so the
    // promise has to be measured through this server separately rather than inferred.
    const result = await validate(
      'app/views/pages/dup.html.liquid',
      '---\nslug: first\nslug: second\n---\n<p>hi</p>\n',
    );

    expect({
      blocked: result.must_fix_before_write,
      errorChecks: [...new Set(result.errors.map((error) => error.check))],
      warningChecks: [...new Set(result.warnings.map((warning) => warning.check))],
    }).toEqual({
      blocked: false,
      errorChecks: [],
      warningChecks: ['DuplicateFrontmatterKey'],
    });
  }, 120_000);
});

/**
 * Every file type this server ADMITS must have at least one check that examines it.
 */

/** A file of this type, with content something is expected to object to. */
interface Examined {
  filePath: string;
  content: string;
  /** Extra directory spellings for the same type, all of which must behave alike. */
  alsoSpelled?: string[];
}

/** Marker for a type this server does NOT admit — it must decline, not approve. */
const NOT_ADMITTED = Symbol('not admitted');

const BROKEN_LIQUID = "{{ 'a' | no_such_filter_zzz }}\n";
const BROKEN_YAML = `name: car
properties:
 - name: make
   type: string
  year: 1
`;
const BROKEN_GRAPHQL = 'query { no_such_root_field { id } }\n';

const COVERAGE: Record<PlatformOSFileType, Examined | typeof NOT_ADMITTED> = {
  [PlatformOSFileType.Page]: { filePath: 'app/views/pages/i.liquid', content: BROKEN_LIQUID },
  [PlatformOSFileType.Layout]: { filePath: 'app/views/layouts/l.liquid', content: BROKEN_LIQUID },
  [PlatformOSFileType.Partial]: {
    filePath: 'app/views/partials/p.liquid',
    content: BROKEN_LIQUID,
    alsoSpelled: ['app/lib/c.liquid'],
  },
  [PlatformOSFileType.Authorization]: {
    filePath: 'app/authorization_policies/a.liquid',
    content: BROKEN_LIQUID,
  },
  [PlatformOSFileType.Email]: { filePath: 'app/emails/e.liquid', content: BROKEN_LIQUID },
  [PlatformOSFileType.ApiCall]: { filePath: 'app/api_calls/a.liquid', content: BROKEN_LIQUID },
  [PlatformOSFileType.Sms]: { filePath: 'app/smses/s.liquid', content: BROKEN_LIQUID },
  [PlatformOSFileType.Migration]: { filePath: 'app/migrations/m.liquid', content: BROKEN_LIQUID },
  [PlatformOSFileType.FormConfiguration]: {
    filePath: 'app/forms/f.liquid',
    content: BROKEN_LIQUID,
  },

  // The four that had nothing at all until `YAMLSyntaxError`.
  [PlatformOSFileType.Table]: {
    filePath: 'app/schema/c.yml',
    content: BROKEN_YAML,
    alsoSpelled: ['app/model_schemas/c.yml', 'app/custom_model_types/c.yml'],
  },
  [PlatformOSFileType.UserProfileType]: {
    filePath: 'app/user_profile_types/u.yml',
    content: BROKEN_YAML,
    alsoSpelled: ['app/instance_profile_types/u.yml', 'app/user_profile_schemas/u.yml'],
  },
  [PlatformOSFileType.TransactableType]: {
    filePath: 'app/transactable_types/t.yml',
    content: BROKEN_YAML,
  },
  [PlatformOSFileType.Translation]: {
    filePath: 'app/translations/en.yml',
    content: BROKEN_YAML,
  },

  // Admitted later than the four above, and the reason this file is a guard rather than a
  // record: each arrived as a `PlatformOSFileType` with no check written for it. They are
  // covered by `YAMLSyntaxError`, which examines any YAML source whatever directory it is in.
  [PlatformOSFileType.ActivityStreamsHandler]: {
    filePath: 'app/activity_streams/handlers/h.yml',
    content: BROKEN_YAML,
  },
  [PlatformOSFileType.ActivityStreamsGroupingHandler]: {
    filePath: 'app/activity_streams/grouping_handlers/g.yml',
    content: BROKEN_YAML,
  },

  // The two SINGLETONS: one file at a fixed path, not a directory of files. Spelled out
  // rather than derived from `getFixedFilePath` on purpose — if the platform ever renames
  // one, this fixture stops being classified and the test fails loudly, where a derived
  // path would quietly follow the rename and assert nothing about the old one.
  [PlatformOSFileType.InstanceConfig]: { filePath: 'app/config.yml', content: BROKEN_YAML },
  [PlatformOSFileType.UserSchema]: { filePath: 'app/user.yml', content: BROKEN_YAML },

  [PlatformOSFileType.GraphQL]: {
    filePath: 'app/graphql/g.graphql',
    content: BROKEN_GRAPHQL,
    alsoSpelled: ['app/graph_queries/g.graphql'],
  },

  // Assets are served, not linted: nothing here has a parser for an image, a stylesheet
  // or a `.js` file, and the `.css/.scss/.js.liquid` partials are excluded the same way.
  // Declining is the honest answer and is what makes the invariant above tractable: a
  // type with no checks must be OUT, not `ok`.
  [PlatformOSFileType.Asset]: NOT_ADMITTED,
};

/**
 * Real assets, in every spelling that matters.
 */
const REAL_ASSETS = [
  'app/assets/logo.png',
  'app/assets/site.css.liquid',
  'app/assets/app.js',
  'app/assets/manifest.json',
];

describe('Integration: every admitted file type is examined by something', () => {
  const { validate } = tempProject('mcp-sup-coverage-');

  const examined = (result: ValidateCodeResult) => ({
    status: result.status,
    examined: result.errors.length + result.warnings.length + result.infos.length > 0,
  });

  it('has a decision for every PlatformOSFileType, admitted or not', () => {
    // The runtime half of the exhaustiveness guard. `Record<PlatformOSFileType, …>`
    // already makes a new member a compile error; this repeats it with a message that
    // says what to do about it.
    expect(Object.keys(COVERAGE).sort()).toEqual(Object.values(PlatformOSFileType).sort());
  });

  for (const [fileType, fixture] of Object.entries(COVERAGE)) {
    if (fixture === NOT_ADMITTED) {
      it(`${fileType}: declined rather than approved, since nothing lints it`, async () => {
        const outcomes = [];
        for (const filePath of REAL_ASSETS) {
          const result = await validate(filePath, BROKEN_LIQUID);
          outcomes.push({
            status: result.status,
            reason: result.not_applicable_reason,
            blocked: result.must_fix_before_write,
            // The prose must say ASSET, not "not a platformOS source file". The file IS
            // deployed and served — it just has nothing to check — and an author who can
            // see a message is wrong stops reading the ones that are right.
            saysAsset: (result.next_step ?? '').includes('is an asset, not a source file'),
          });
        }

        expect(outcomes).toEqual(
          REAL_ASSETS.map(() => ({
            status: 'not_applicable',
            reason: 'unsupported_type',
            blocked: false,
            saysAsset: true,
          })),
        );
      });

      it(`${fileType}: a bare .liquid under assets/ is refused too, not blocked on`, async () => {
        // THE CASE THAT MADE THIS ROW A LIE, and the reason the gate now refuses assets by
        // TYPE rather than by extension. A bare `.liquid` has no response format, so
        // `sourceCodeTypeOf` falls back to `html.liquid`; the buffer was parsed as Liquid
        // and came back `must_fix_before_write: true` with `LiquidHTMLSyntaxError` — a
        // false block on a file the platform serves as bytes, for the syntax of a language
        // nothing there evaluates. `theme.css.liquid`, the form the platform DOES process,
        // was exempt the whole time.
        const result = await validate('app/assets/x.liquid', BROKEN_LIQUID);

        expect({
          status: result.status,
          reason: result.not_applicable_reason,
          blocked: result.must_fix_before_write,
        }).toEqual({ status: 'not_applicable', reason: 'unsupported_type', blocked: false });
      });
      continue;
    }

    it(`${fileType}: a broken buffer is objected to, so 'ok' would have meant something`, async () => {
      const spellings = [fixture.filePath, ...(fixture.alsoSpelled ?? [])];

      const results = [];
      for (const filePath of spellings) {
        results.push(examined(await validate(filePath, fixture.content)));
      }

      // Every directory spelling of one type must behave identically — a type that is
      // covered under `app/schema` and silent under `app/model_schemas` is still a
      // hole, just a harder one to notice.
      expect(results).toEqual(spellings.map(() => ({ status: 'error', examined: true })));
    });
  }

  it('covers every YAML family and directory spelling with YAMLSyntaxError specifically', async () => {
    // Pinned exactly, unlike the rest: these are the families that had NOTHING, and
    // the identity of the check that now covers them is the substance of the fix
    // rather than an implementation detail. If this ever reports a different code —
    // or none — the gap has reopened somewhere.
    const yamlFiles = [
      'app/schema/c.yml',
      'app/model_schemas/c.yml',
      'app/custom_model_types/c.yml',
      'app/user_profile_types/u.yml',
      'app/instance_profile_types/u.yml',
      'app/user_profile_schemas/u.yml',
      'app/transactable_types/t.yml',
      'app/translations/en.yml',
      'app/activity_streams/handlers/h.yml',
      'app/activity_streams/grouping_handlers/g.yml',
      'app/config.yml',
      'app/user.yml',
    ];

    const codes = [];
    for (const filePath of yamlFiles) {
      const result = await validate(filePath, BROKEN_YAML);
      codes.push([...new Set(result.errors.map((error) => error.check))]);
    }

    expect(codes).toEqual(yamlFiles.map(() => ['YAMLSyntaxError']));
  });
});

/**
 * The response bound, measured end to end on the shapes that motivated it.
 */
describe('Integration: the response is bounded, and says so when it withholds', () => {
  // Named `ctx` locally, shadowing the injected-adapter one above: this group calls
  // `runValidateCode` directly, because what it measures is the whole real response.
  const { context: ctx } = tempProject('mcp-sup-bound-');

  /**
   * A buffer of exactly `bytes` made of one repeated offending construct, padded with
   * spaces.
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
    // The measured common case — a small broken edit — is two orders of magnitude below
    // the 32 KiB diagnostic cap. A bound that changed this would be solving the tail at
    const result = (await runValidateCode(ctx(), {
      file_path: 'app/views/pages/index.liquid',
      content: `{% render 'no_such_partial' %}
{{ 'a' | no_such_filter_xyz }}
`,
    })) as ValidateCodeResult;

    expect({
      blocked: result.must_fix_before_write,
      truncated: result.truncated,
      errorsReturned: result.errors.length,
      underTwoKiB: bytesOf(result) < 2048,
    }).toEqual({
      blocked: true,
      truncated: undefined,
      errorsReturned: 2,
      underTwoKiB: true,
    });
  }, 60_000);
});

/**
 * Enrichment sits between the lint and the answer, and it must not be able to damage
 * either one.
 */
describe('validate_code: enrichment is bounded — it cannot cost findings or the gate', () => {
  const BROKEN = 'app/views/pages/broken.liquid';

  /** Adapters whose docset resolution is observable, and optionally broken. */
  const withDocset = (
    behaviour: { throws?: boolean } = {},
  ): { adapters: Partial<ValidateAdapters>; calls: () => number } => {
    let calls = 0;
    return {
      calls: () => calls,
      adapters: {
        lint: async ({ buffers }) => ({
          diagnostics: new Map(buffers.map((b) => [b.filePath, [diagnostic('MissingPartial')]])),
          sources: new Map(buffers.map((b) => [b.filePath, { startIndexes: [0] }])),
          notChecked: new Map(),
        }),
        impact: async () => COMPUTED,
        docset: async () => {
          calls += 1;
          if (behaviour.throws) throw new Error('docset unavailable');
          return { filters: [], tags: [], objects: [] };
        },
      },
    };
  };

  it('resolves the docset ONCE per request, however many files it carries', async () => {
    // The property the batch form exists for: a fixed cost must not become a per-file
    // cost. Counted rather than timed, so it cannot pass on a fast machine.
    const { adapters, calls } = withDocset();

    await runValidateCode(
      ctx(),
      {
        files: Array.from({ length: 5 }, (_, i) => ({
          file_path: `app/views/pages/p${i}.liquid`,
          content: 'x',
        })),
      },
      adapters,
    );

    expect(calls()).toEqual(1);
  });

  /**
   * A request with nothing to enrich must not pay to enrich it.
   */
  it('does not resolve the docset when there is nothing to enrich', async () => {
    let calls = 0;
    const adapters: Partial<ValidateAdapters> = {
      lint: async ({ buffers }) => ({
        diagnostics: new Map(buffers.map((b) => [b.filePath, []])),
        notChecked: new Map(),
      }),
      impact: async () => COMPUTED,
      docset: async () => {
        calls += 1;
        return { filters: [], tags: [], objects: [] };
      },
    };

    const clean = (await runValidateCode(
      ctx(),
      { file_path: BROKEN, content: 'x' },
      adapters,
    )) as ValidateCodeResult;
    const declined = (await runValidateCode(
      ctx(),
      { file_path: 'README.md', content: '# hi' },
      adapters,
    )) as ValidateCodeResult;

    // The answers are unaffected — this is about what was NOT done to produce them.
    expect({
      docsetResolutions: calls,
      cleanStatus: clean.status,
      declinedStatus: declined.status,
    }).toEqual({ docsetResolutions: 0, cleanStatus: 'ok', declinedStatus: 'not_applicable' });
  });

  it('still returns every finding, and the same gate, when the docset fails', async () => {
    const { adapters } = withDocset({ throws: true });

    const result = (await runValidateCode(
      ctx(),
      { file_path: BROKEN, content: 'x' },
      adapters,
    )) as ValidateCodeResult;

    // The finding survives, the gate is unchanged, and the diagnostic is simply
    // un-enriched — no `see_also`. A thrown enricher must not read as a clean file.
    expect({
      status: result.status,
      must_fix_before_write: result.must_fix_before_write,
      errors: result.errors,
    }).toEqual({
      status: 'error',
      must_fix_before_write: true,
      errors: [diagnostic('MissingPartial')],
    });
  });

  it('CONTROL: the same call enriches when the docset resolves', async () => {
    // Without this, the test above would pass with enrichment deleted entirely.
    const { adapters } = withDocset();

    const result = (await runValidateCode(
      ctx(),
      { file_path: BROKEN, content: 'x' },
      adapters,
    )) as ValidateCodeResult;

    expect(result.errors).toEqual([enriched('MissingPartial')]);
  });
});

/**
 * The one path a stub cannot stand in for: a REAL offense, resolved against the REAL tree
 * the lint captured, rendered into the answer.
 */
describe('validate_code: a hint survives the whole path, from a real lint to the answer', () => {
  const project = tempProject('mcp-sup-hint-e2e-');
  const PAGE_PATH = 'app/views/pages/hint.liquid';

  /** `{% for %}`'s published entry — the symbol a bad `limit:` argument is answered by. */
  const FOR_TAG: DocsetVocabulary = {
    filters: [],
    tags: [{ name: 'for', description: 'Iterates over an array.' }] as DocsetVocabulary['tags'],
    objects: [],
  };

  const validateWith = async (content: string, vocabulary: DocsetVocabulary) =>
    (await runValidateCode(
      project.context(),
      { file_path: PAGE_PATH, content },
      { docset: async () => vocabulary },
    )) as ValidateCodeResult;

  const findingFor = (result: ValidateCodeResult, check: string) =>
    [...result.errors, ...result.warnings, ...result.infos].find((d) => d.check === check);

  it('renders the published entry for the symbol the offense is about', async () => {
    const result = await validateWith(
      "{% for x in (1..3) limit: 'ten' %}{{ x }}{% endfor %}",
      FOR_TAG,
    );

    expect(findingFor(result, 'ValidTagArgumentTypes')?.hint).toEqual(
      '### for\nIterates over an array.\n\n---\n\n' +
        '[platformOS Reference](https://documentation.platformos.com/api-reference/liquid/loops#for)',
    );
  });

  it('CONTROL: the same finding, with the same tree, when the docset publishes nothing', async () => {
    // Proves the hint above came from the VOCABULARY rather than from anything the lint
    // or this test authored — and that a symbol with no entry degrades to no hint rather
    // than to an invented one. The finding itself is unchanged either way.
    const result = await validateWith("{% for x in (1..3) limit: 'ten' %}{{ x }}{% endfor %}", {
      filters: [],
      tags: [],
      objects: [],
    });

    const finding = findingFor(result, 'ValidTagArgumentTypes');
    expect({ found: finding !== undefined, hint: finding?.hint }).toEqual({
      found: true,
      hint: undefined,
    });
  });
});
