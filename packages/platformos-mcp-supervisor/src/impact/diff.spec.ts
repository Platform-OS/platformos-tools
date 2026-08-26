import { describe, expect, it } from 'vitest';

import { introducedDiagnostics } from './diff.js';
import type { ValidateCodeDiagnostic } from '../result/types.js';

const at = (
  check: string,
  line: number,
  column: number,
  over: Partial<ValidateCodeDiagnostic> = {},
): ValidateCodeDiagnostic => ({
  check,
  severity: 'error',
  message: `${check} fired`,
  line,
  column,
  ...over,
});

describe('introducedDiagnostics', () => {
  it('returns only what the change added, dropping what was already there', () => {
    const preexisting = at('DeprecatedFrontmatterField', 1, 1);
    const caused = at('MissingRenderPartialArguments', 4, 12);

    expect(introducedDiagnostics([preexisting, caused], [preexisting])).toEqual([caused]);
  });

  it('returns nothing when the change added nothing, however many findings the file has', () => {
    const before = [at('UnknownFilter', 2, 5), at('ImgWidthAndHeight', 9, 1)];

    expect(introducedDiagnostics([...before], before)).toEqual([]);
  });

  /**
   * The reason identity is a POSITION and not a code. A dependant already carrying an
   * `UnknownFilter` far down the file must not absorb a new one the change caused at the
   * top — which is exactly what matching on the code alone does.
   */
  it('does not let a pre-existing finding mask a NEW one sharing its check code', () => {
    const old = at('UnknownFilter', 90, 3);
    const fresh = at('UnknownFilter', 3, 7);

    expect(introducedDiagnostics([fresh, old], [old])).toEqual([fresh]);
  });

  /**
   * A multiset, not a set: each `before` occurrence cancels exactly one `after` occurrence.
   * `GraphQLVariablesCheck` really does fire twice at one site — measured on a renamed
   * variable — so a third must still surface.
   */
  it('cancels one-for-one when a check fires several times at the same position', () => {
    const dup = () => at('GraphQLVariablesCheck', 1, 1);

    expect(introducedDiagnostics([dup(), dup(), dup()], [dup(), dup()])).toEqual([dup()]);
    expect(introducedDiagnostics([dup(), dup()], [dup(), dup()])).toEqual([]);
  });

  it('treats a finding the change REMOVED as no finding at all, never as negative news', () => {
    // The changeset fixing a dependant is not something to report; it is just absence.
    expect(introducedDiagnostics([], [at('MissingPartial', 1, 1)])).toEqual([]);
  });

  it('reports everything when the dependant was clean before', () => {
    const caused = [at('TranslationKeyExists', 1, 4), at('MissingPartial', 6, 2)];

    expect(introducedDiagnostics(caused, [])).toEqual(caused);
  });

  it('preserves the order the lint produced, which is reading order', () => {
    const first = at('A', 1, 1);
    const second = at('B', 5, 1);
    const third = at('C', 9, 1);

    expect(introducedDiagnostics([first, second, third], [])).toEqual([first, second, third]);
  });

  /**
   * Identity is (check, line, column) and NOT the message or the fix: the same defect can
   * be described differently once its cause changes — a `Did you mean …?` suggestion that
   * appears only when a near-miss key exists — and re-reporting it as new would be a false
   * positive on every request.
   */
  it('matches on position and code alone, ignoring message and fix drift', () => {
    const before = at('TranslationKeyExists', 2, 2, { message: 'missing key' });
    const after = at('TranslationKeyExists', 2, 2, {
      message: "missing key. Did you mean 'app.farewell'?",
      fix: {
        description: 'use the nearest key',
        edits: [{ start_index: 0, end_index: 1, new_text: 'x' }],
      },
    });

    expect(introducedDiagnostics([after], [before])).toEqual([]);
  });
});
