import { describe, expect, it } from 'vitest';

import { capToBudget } from './response-budget.js';
import { MAX_RESPONSE_DIAGNOSTIC_BYTES } from '../cost-model.js';
import { UNAVAILABLE_IMPACT } from './impact-states.js';
import type { ValidateCodeDiagnostic, ValidateCodeResult } from './types.js';

/**
 * The response bound, tested where it is decidable: as a pure function over finished
 * results.
 */

const diagnostic = (
  line: number,
  severity: ValidateCodeDiagnostic['severity'],
  check = 'SomeCheck',
  padding = '',
): ValidateCodeDiagnostic => ({
  check,
  severity,
  message: `finding at ${line}${padding}`,
  line,
  column: 1,
});

const resultWith = (
  errors: ValidateCodeDiagnostic[],
  warnings: ValidateCodeDiagnostic[] = [],
  infos: ValidateCodeDiagnostic[] = [],
  blocked = errors.length > 0,
): ValidateCodeResult => ({
  status: errors.length > 0 ? 'error' : warnings.length > 0 ? 'warning' : 'ok',
  must_fix_before_write: blocked,
  errors,
  warnings,
  infos,
  impact: UNAVAILABLE_IMPACT(),
});

const many = (count: number, severity: ValidateCodeDiagnostic['severity'] = 'error') =>
  Array.from({ length: count }, (_, index) => diagnostic(index + 1, severity));

/** What a diagnostic list costs in the response, billed the way `costOf` bills it. */
const bytesOf = (entries: ValidateCodeDiagnostic[]): number =>
  entries.reduce((bytes, entry) => bytes + Buffer.byteLength(JSON.stringify(entry), 'utf8') + 1, 0);

/** Serialized size of the diagnostics a capped result actually carries. */
const diagnosticBytes = (results: Map<string, ValidateCodeResult>): number => {
  let bytes = 0;
  for (const result of results.values()) {
    bytes += bytesOf(result.errors) + bytesOf(result.warnings) + bytesOf(result.infos);
  }
  return bytes;
};

describe('Unit: capToBudget', () => {
  it('leaves a result that fits completely untouched, with NO truncation field', async () => {
    // The presence of `truncated` has to be a reliable signal. A stub emitted on
    // every response would make an agent inspect it to learn nothing, which is the
    // same reasoning that removed the permanently-empty fields from this contract.
    const results = new Map([['a.liquid', resultWith(many(3))]]);

    const capped = capToBudget(results);

    expect(capped.get('a.liquid')).toEqual(results.get('a.liquid'));
    expect(capped.get('a.liquid')!.truncated).toBeUndefined();
  });

  it('NEVER softens the gate: the blocking error may be withheld, the verdict may not', async () => {
    // The case the whole design exists for. One thousand findings where the ONLY
    // blocking one sorts last, so any cap that recomputed the verdict from what it
    // returned would flip `must_fix_before_write` to false and tell the agent to
    // write a file the server knows is broken.
    const errors = [...many(999), diagnostic(1000, 'error', 'MissingPartial')];
    const results = new Map([['a.liquid', resultWith(errors, [], [], true)]]);

    const capped = capToBudget(results, 500);
    const result = capped.get('a.liquid')!;

    expect({
      blocked: result.must_fix_before_write,
      status: result.status,
      returnedFewer: result.errors.length < errors.length,
      blockingOneWithheld: !result.errors.some((error) => error.check === 'MissingPartial'),
      total: result.truncated!.errors!.total,
    }).toEqual({
      blocked: true,
      status: 'error',
      returnedFewer: true,
      blockingOneWithheld: true,
      total: 1000,
    });
  });

  it('reports the true total per affected bucket, distinguishable from what it returned', async () => {
    const results = new Map([
      ['a.liquid', resultWith(many(50), many(40, 'warning'), many(30, 'info'))],
    ]);

    const capped = capToBudget(results, 900);
    const result = capped.get('a.liquid')!;

    expect({
      errors: result.truncated!.errors,
      returnedErrors: result.errors.length,
      warnings: result.truncated!.warnings,
      infos: result.truncated!.infos,
    }).toEqual({
      errors: { returned: result.errors.length, total: 50 },
      returnedErrors: result.errors.length,
      warnings: { returned: 0, total: 40 },
      infos: { returned: 0, total: 30 },
    });
  });

  it('names only the buckets it actually withheld from', async () => {
    // A bucket that came back whole must not appear. Otherwise "which of my lists is
    // partial" becomes a question an agent answers by comparing numbers.
    const results = new Map([['a.liquid', resultWith(many(2), many(400, 'warning'))]]);

    const capped = capToBudget(results, 800);
    const truncated = capped.get('a.liquid')!.truncated!;

    expect({
      errors: truncated.errors,
      warnings: truncated.warnings !== undefined,
      infos: truncated.infos,
    }).toEqual({ errors: undefined, warnings: true, infos: undefined });
  });

  it('slices the WARNINGS bucket to exactly what the budget bought, and reports the true total', async () => {
    // The one bucket the rest of this file leaves undefended: every other warnings assertion
    // reads a total or a presence, and both survive returning the whole list unsliced. The
    // budget is derived from the entries, so "twelve fit" is arithmetic rather than a guess.
    const warnings = many(40, 'warning');
    const admitted = 12;
    const results = new Map([['a.liquid', resultWith([], warnings)]]);

    const capped = capToBudget(results, bytesOf(warnings.slice(0, admitted)));
    const result = capped.get('a.liquid')!;

    expect({
      status: result.status,
      must_fix_before_write: result.must_fix_before_write,
      errors: result.errors,
      warnings: result.warnings,
      infos: result.infos,
      truncated: result.truncated!.warnings,
    }).toEqual({
      status: 'warning',
      must_fix_before_write: false,
      errors: [],
      warnings: warnings.slice(0, admitted),
      infos: [],
      truncated: { returned: admitted, total: warnings.length },
    });
  });

  it('spends the budget on errors before any info, across every file', async () => {
    // Severity-major allocation. A file that is nothing but infos must not consume
    // the budget a LATER file's errors need — note the noisy file is listed first, so
    // a purely round-robin allocation would serve it before seeing the errors at all.
    const results = new Map([
      ['noisy.liquid', resultWith([], [], many(500, 'info'))],
      ['broken.liquid', resultWith(many(20))],
    ]);

    const capped = capToBudget(results, 1_500);

    expect({
      errorsWithheld: capped.get('broken.liquid')!.truncated?.errors !== undefined,
      infosReturned: capped.get('noisy.liquid')!.infos.length,
    }).toEqual({ errorsWithheld: true, infosReturned: 0 });
  });

  it('still serves infos once every error fits, so lower severities are not starved needlessly', async () => {
    // The other half of the same rule. Errors first must not mean infos never.
    const results = new Map([
      ['noisy.liquid', resultWith([], [], many(500, 'info'))],
      ['broken.liquid', resultWith(many(20))],
    ]);

    const capped = capToBudget(results, 20_000);

    expect({
      errorsWhole: capped.get('broken.liquid')!.truncated,
      someInfos: capped.get('noisy.liquid')!.infos.length > 0,
      infosPartial: capped.get('noisy.liquid')!.truncated?.infos?.total,
    }).toEqual({ errorsWhole: undefined, someInfos: true, infosPartial: 500 });
  });

  it('shares the budget round-robin, so one loud file cannot starve the others', async () => {
    // The realistic batch shape: one file with a cascading failure and three ordinary
    // ones. Every file must come back with something to act on.
    const results = new Map([
      ['cascade.liquid', resultWith(many(2000))],
      ['b.liquid', resultWith(many(3))],
      ['c.liquid', resultWith(many(3))],
      ['d.liquid', resultWith(many(3))],
    ]);

    const capped = capToBudget(results, 2_000);

    expect([
      capped.get('b.liquid')!.errors.length,
      capped.get('c.liquid')!.errors.length,
      capped.get('d.liquid')!.errors.length,
    ]).toEqual([3, 3, 3]);
  });

  it('keeps the HEAD of each list, so what survives is the top of the file', async () => {
    // Diagnostics arrive ordered by line and column, and a cascade's root cause is
    // almost always the first entry. Returning a scattered sample would also make
    // "returned 12 of 300" meaningless about WHICH twelve.
    const results = new Map([['a.liquid', resultWith(many(100))]]);

    const capped = capToBudget(results, 400);
    const lines = capped.get('a.liquid')!.errors.map((error) => error.line);

    expect(lines).toEqual(Array.from({ length: lines.length }, (_, index) => index + 1));
  });

  it('closes a bucket at the first entry that does not fit, rather than skipping it', async () => {
    // Contiguity again, from the other direction: a huge entry in the middle must
    // stop the list there instead of being stepped over to collect smaller ones.
    const errors = [
      diagnostic(1, 'error'),
      diagnostic(2, 'error', 'SomeCheck', 'x'.repeat(5_000)),
      diagnostic(3, 'error'),
    ];
    const results = new Map([['a.liquid', resultWith(errors)]]);

    const capped = capToBudget(results, 1_000);

    expect(capped.get('a.liquid')!.errors.map((error) => error.line)).toEqual([1]);
  });

  it('always returns one error per file, even when a single entry exceeds the whole budget', async () => {
    // A blocked write with an empty `errors` list names a problem and then refuses to
    // say what it is. The guarantee is bounded to one entry per file.
    const enormous = [
      diagnostic(1, 'error', 'MissingPartial', 'x'.repeat(50_000)),
      diagnostic(2, 'error'),
    ];
    const results = new Map([['a.liquid', resultWith(enormous, [], [], true)]]);

    const capped = capToBudget(results, 100);
    const result = capped.get('a.liquid')!;

    expect({
      returned: result.errors.length,
      firstCheck: result.errors[0].check,
      blocked: result.must_fix_before_write,
      total: result.truncated!.errors!.total,
    }).toEqual({ returned: 1, firstCheck: 'MissingPartial', blocked: true, total: 2 });
  });

  it('bounds the REQUEST, not each file, so a 50-file batch cannot multiply the cap', async () => {
    // The bound that per-file capping alone would miss, and the reason the batch form
    // needed its own answer: 50 files under a per-file cap is 50x the intended size.
    const results = new Map(
      Array.from(
        { length: 50 },
        (_, index) => [`f${index}.liquid`, resultWith(many(500))] as const,
      ),
    );

    const capped = capToBudget(results);

    // The guarantee costs one error per file on top of the budget; that overshoot is
    // bounded by the file cap and is asserted rather than hidden.
    expect(diagnosticBytes(capped)).toBeLessThan(MAX_RESPONSE_DIAGNOSTIC_BYTES * 1.5);
  });

  it('leaves a not_applicable result exactly as it was', async () => {
    // Nothing to withhold, and nothing that should acquire a truncation field.
    const declined: ValidateCodeResult = {
      status: 'not_applicable',
      not_applicable_reason: 'too_large',
      must_fix_before_write: false,
      errors: [],
      warnings: [],
      infos: [],
      impact: UNAVAILABLE_IMPACT(),
      next_step: 'refused',
    };

    expect(capToBudget(new Map([['a.liquid', declined]])).get('a.liquid')).toEqual(declined);
  });

  it('preserves the caller order of the map, so a batch still lines up with its request', async () => {
    const results = new Map([
      ['z.liquid', resultWith(many(2))],
      ['a.liquid', resultWith(many(2))],
      ['m.liquid', resultWith(many(2))],
    ]);

    expect([...capToBudget(results).keys()]).toEqual(['z.liquid', 'a.liquid', 'm.liquid']);
  });
});
