import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { AppCache } from '@platformos/platformos-check-node';

import { runValidateCode, TOOL_TEXT, VALIDATE_CODE_INPUT } from './validate-code.js';
import { SERVER_INSTRUCTIONS } from './instructions.js';
import { BLOCKING_CHECKS } from '../result/blocking.js';
import { IMPACT_DEADLINE_MS, type SupervisorContext } from '../context.js';
import { MIN_LINT_DEADLINE_MS, lintDeadlineMs } from '../cost-model.js';
import { MAX_BUFFER_BYTES } from '../adapter-input.js';
import { MAX_BATCH_BYTES, MAX_BATCH_FILES } from '../validate/batch-bounds.js';
import { GraphCache } from '../graph-cache/graph-cache.js';
import type { ValidateAdapters } from '../validate/validate-buffers.js';
import type {
  NotApplicableReason,
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
 * Adapters are always injected, so nothing here touches a real project — which
 * matters under fake timers, where real config I/O would never settle.
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

const diagnostic = (
  check: string,
  severity: ValidateCodeDiagnostic['severity'] = 'error',
): ValidateCodeDiagnostic => ({ check, severity, message: `${check} fired`, line: 1, column: 1 });

/** Adapters whose lint returns the given diagnostics per caller key. */
const adaptersFor = (
  byFile: Record<string, ValidateCodeDiagnostic[]> = {},
): Partial<ValidateAdapters> => ({
  lint: async ({ buffers }) => ({
    diagnostics: new Map(buffers.map((b) => [b.filePath, byFile[b.filePath] ?? []])),
    ignored: new Set<string>(),
  }),
  impact: async () => COMPUTED,
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
          lint: async ({ buffers }) => ({
            diagnostics: new Map(buffers.map((b) => [b.filePath, [warning]])),
            ignored: new Set<string>(),
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
            ignored: new Set<string>(),
          };
        },
        impact: async () => COMPUTED,
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
          return {
            diagnostics: new Map(buffers.map((b) => [b.filePath, []])),
            ignored: new Set<string>(),
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
    // `check()` skips ignored files silently, so "no offenses" would mean "never
    // looked at" — the write gate approving a file nothing checked.
    const result = await validateOne('{% if %}{{ unclosed', {
      // The LINT seam reports this — it holds the config. There is no separate
      // ignore adapter to stub, which is the point: one source of truth.
      lint: async () => ({ diagnostics: new Map(), ignored: new Set([PAGE]) }),
      impact: async () => COMPUTED,
    });

    expect(result.status).toEqual('not_applicable');
    expect(result.not_applicable_reason).toEqual('ignored');
    expect(result.must_fix_before_write).toBe(false);
  });

  it('never reaches the lint for a file the pure gate already declined', async () => {
    // The pure gate is synchronous and runs first, so an off-project path costs no
    // I/O at all — no lint pass, and therefore no config load.
    let linted = false;
    await validateOne(
      'x',
      {
        lint: async () => {
          linted = true;
          return { diagnostics: new Map(), ignored: new Set<string>() };
        },
        impact: async () => COMPUTED,
      },
      '/etc/passwd',
    );

    expect(linted).toBe(false);
  });

  it('loads the project ONCE for a whole multi-file request', async () => {
    // The config-exclusion answer rides along with the single lint pass rather than
    // costing a second config load, so one pass IS one load.
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
            ignored: new Set<string>(),
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
          ignored: new Set<string>(),
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
   * TASK-22. Results are keyed by the caller's `file_path` string, but buffers are
   * overlaid and deduplicated by normalized URI (last one wins). Two entries naming
   * one file therefore used to lint ONE buffer and report its verdict for BOTH — so
   * the losing buffer was never validated yet came back with a status, and reversing
   * the argument order flipped which one was lied about.
   *
   * This is the eval's exact reproduction (FINDINGS.md F-13, group `X-dup-keys`): a
   * broken buffer and a clean one under the same path returned `status: "ok"` for
   * both, i.e. a false approval manufactured with no check involved at all.
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
    // The refusal is decidable from the request alone, so it must cost nothing —
    // and, more importantly, no buffer may be linted when we will not report its
    // result honestly.
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
    // The guard must not cost the legitimate case, including the mixed
    // relative/absolute spelling the caller-string keying exists to support.
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
    // The bug this closes: a fixed 60 s deadline against a cap that admitted ~115 s
    // of work, so the worst legal batch timed out — returning `timed_out` for EVERY
    // file, which is no validation at all, silently. The deadline now scales with
    // the bytes admitted, so being still-running at the floor is CORRECT here.
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
      // The message must quote the deadline actually applied, not the floor — it is
      // the only place the caller can see how long it was held.
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
            ignored: new Set<string>(),
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
          return {
            diagnostics: new Map(buffers.map((b) => [b.filePath, []])),
            ignored: new Set<string>(),
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
    // `mode` was removed; an agent mid-session must not start failing over a
    // parameter that never did anything.
    const parsed = schema.safeParse({ file_path: PAGE, content: 'x', mode: 'quick' });

    expect(parsed.success).toBe(true);
    expect(parsed.success && Object.keys(parsed.data).sort()).toEqual(['content', 'file_path']);
  });
});

/**
 * The description and the server instructions ARE the agent's entire understanding
 * of this tool. A wrong or stale claim there is worse than a bug in the code: it
 * converts "I do not know" into false confidence, silently.
 *
 * These pin the claims most likely to rot, and the ones whose rotting is dangerous.
 */
describe('validate_code: the agent-facing surface', () => {
  const { VALIDATE_CODE_DESCRIPTION } = TOOL_TEXT;

  it('states the either/or rule exactly ONCE, in the description', () => {
    // It used to be repeated in all three parameter descriptions — three copies of
    // one rule, in the exact place an agent is deciding what to send.
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
    // This assertion was the exact inverse until `YAMLSyntaxError` landed (TASK-21).
    // The description advertised "Liquid/GraphQL/YAML" while nothing checked a .yml
    // at all, so it was narrowed to two languages on purpose; the third is back
    // because the claim became true, not because the wording was inconvenient.
    // Coverage is still not total — see the instructions, which say what is and is
    // not checked for YAML.
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

  it('states what YAML coverage now IS, and what it still is not', () => {
    // Previously this pinned the opposite claim — 'YAML SYNTAX IS NOT VALIDATED' —
    // which was true and load-bearing until `YAMLSyntaxError` landed. The danger has
    // moved rather than disappeared: an agent that reads "YAML is validated" may take
    // a clean model schema as a shape guarantee, which it is not. Both halves are
    // pinned so neither can quietly become the whole story.
    expect(SERVER_INSTRUCTIONS).toContain('one that does not parse is reported and blocks');
    expect(SERVER_INSTRUCTIONS).toContain('The SHAPE of a model');
    expect(SERVER_INSTRUCTIONS).not.toContain('YAML SYNTAX IS NOT VALIDATED');

    // A duplicated key USED to be listed here as not reported, which was true and
    // measured until `DuplicateYAMLKey` landed. The sentence had to change in the same
    // commit as the check, because an instruction that overstates what is NOT reported
    // turns a warning the agent receives into something it was told could not happen.
    // Both halves are pinned: that it is reported, and that it does not block.
    expect(SERVER_INSTRUCTIONS).toContain('A key defined TWICE');
    expect(SERVER_INSTRUCTIONS).toContain('does NOT block');
    expect(SERVER_INSTRUCTIONS).not.toContain('a duplicated name is not');
  });

  it('tells the agent to validate BEFORE writing', () => {
    expect(SERVER_INSTRUCTIONS).toContain('BEFORE writing');
  });

  it('only advertises specific blocking behaviour that the gate still has', () => {
    // The instructions single out two constructs as blocking because both are easy
    // to trip over and one is deploy-fatal. Naming a specific rule is more useful
    // than "and more" — and more dangerous, because prose outlives the code it
    // describes. This ties each named claim to the set that has to back it.
    expect({
      jsonLiteral: SERVER_INSTRUCTIONS.includes('must use DOUBLE quotes'),
      hashAssign: SERVER_INSTRUCTIONS.includes('needs a Hash with a key or an Array'),
      yamlParse: SERVER_INSTRUCTIONS.includes('one that does not parse is reported and blocks'),
      backedBy: [
        BLOCKING_CHECKS.has('JsonLiteralQuoteStyle'),
        BLOCKING_CHECKS.has('InvalidHashAssignTarget'),
        BLOCKING_CHECKS.has('YAMLSyntaxError'),
      ],
    }).toEqual({
      jsonLiteral: true,
      hashAssign: true,
      yamlParse: true,
      backedBy: [true, true, true],
    });
  });

  it('describes the size refusal in terms of BOTH bounds it can come from', () => {
    // `too_large` used to say "split the file", which is the wrong instruction for a
    // request that is legal per file and over the batch cap — the caller would shrink
    // files that were never the problem.
    expect(SERVER_INSTRUCTIONS).toContain('or the request as a whole');
  });

  it('explains that errors[] can be non-empty while the gate is false', () => {
    // The single most confusing thing about the result, and the one an agent is
    // most likely to get wrong by assuming error => blocked.
    expect(SERVER_INSTRUCTIONS).toContain('must_fix_before_write is false');
  });

  it('does NOT tell an agent a malformed request is unfixable', () => {
    // `internal_error` covers two very different things, and three of its cases are
    // the CALLER's mistake: both input forms, neither, or one file listed twice.
    // The old wording — "a bug in the validator; retrying will not help" — told an
    // agent to give up on a request it could fix by deduplicating.
    expect(SERVER_INSTRUCTIONS).not.toContain('retrying will not help');
    expect(SERVER_INSTRUCTIONS).toContain('is yours\n                       to fix');
  });

  it('states the once-per-file rule, which the server enforces by refusing', () => {
    // `validate/batch-coherence.ts` declines a request naming one file twice, so the
    // rule has to be findable BEFORE the agent trips it.
    expect(SERVER_INSTRUCTIONS).toContain('List each file at most once');
    expect(TOOL_TEXT.VALIDATE_CODE_DESCRIPTION).toContain('List each file at most once');
  });

  it('says columns are UTF-16 code units, which is not inferable', () => {
    // Verified behaviour: an emoji advances the column by 2. An agent counting code
    // points misplaces every column after one.
    expect(SERVER_INSTRUCTIONS).toContain('UTF-16 code units');
  });

  it('scopes the ordering claim to each list rather than across all three', () => {
    // `assembleResult` sorts, THEN partitions, so concatenating errors + warnings +
    // infos does not walk the file in order. The old wording implied it did.
    expect(SERVER_INSTRUCTIONS).toContain('WITHIN ITSELF');
  });

  it('explains that a computing blast radius is not "nothing depends on this"', () => {
    // Zeroed dependents during the graph build read exactly like a real answer.
    expect(SERVER_INSTRUCTIONS).toContain('NOT a claim that nothing depends');
  });

  it('names filter arity among what is checked, now that it blocks', () => {
    expect(SERVER_INSTRUCTIONS).toContain('wrong number\n            of arguments');
  });

  it('states BOTH halves of the filter rule, which is a rule and not a symmetry', () => {
    // Filters are accepted where the platform parses a full Liquid VARIABLE and refused
    // where it parses a bare EXPRESSION — measured per operand against `--dry-run`,
    // because it follows each Ruby tag's own markup parsing rather than anything an
    // agent could infer. Stating only the blocking half would leave an agent avoiding
    // eleven constructs that are fine; stating only the permissive half would let it
    // write a condition the converter rejects, which fails the whole changeset.
    //
    // Behaviour for both halves is pinned end to end in `blocking-emission.spec.ts`;
    // this pins that the agent is TOLD, and that the blocking half is really blocking.
    expect({
      refused: SERVER_INSTRUCTIONS.includes('FILTER INSIDE A CONDITION'),
      accepted: SERVER_INSTRUCTIONS.includes('A filter in a tag OPERAND is fine'),
      backedBy: BLOCKING_CHECKS.has('LiquidHTMLSyntaxError'),
    }).toEqual({ refused: true, accepted: true, backedBy: true });
  });

  it('names the YAML DIALECT, because key identity is not inferable without it', () => {
    // The linter parses YAML 1.2 (npm `yaml`); the platform parses YAML 1.1 (Ruby
    // Psych). An agent that reads `yes:` and `true:` as two keys — which they are in
    // every JS parser it has ever seen — writes a file that silently loses a value.
    expect(SERVER_INSTRUCTIONS).toContain('YAML 1.1');
    expect(SERVER_INSTRUCTIONS).toContain('can still be ONE key');
  });
});
