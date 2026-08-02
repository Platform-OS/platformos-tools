import { describe, expect, it } from 'vitest';

import { DuplicateYAMLKey } from './index';
import { YAMLSyntaxError } from '../yaml-syntax-error';
import { check, MockApp } from '../../test';
import { findDuplicateKeys } from '../../yaml/duplicate-keys';

/**
 * A repeated YAML key deploys and works — the platform keeps the LAST value. This check
 * exists for what that costs: the earlier value is gone, and nothing else says so.
 *
 * THE MEASUREMENT BEHIND THE MESSAGE. "Last-wins" was asserted in three places in this
 * repository before it was ever measured; every one of those claims rode along in a
 * sentence about `--dry-run` ACCEPTING a duplicate-key file, which answers a different
 * question. It was settled on 2026-08-02 by deploying a translations file with a key
 * repeated at the top level and inside a nested map, then reading both back:
 *
 *   ```
 *     top=[SECOND]  nested=[SECOND]  absent=[translation missing: ...]
 *   ```
 *
 * The absent-key control is what makes it conclusive — a key that resolves to nothing
 * renders differently, so `SECOND` is a real resolution and not a fallback.
 *
 * THE SILENCE CASES BELOW ARE THE POINT OF THIS FILE. Every one of them is legal YAML
 * that a naive string comparison would report, and reporting legal input is the failure
 * mode that cost this server four evaluation rounds.
 */
describe('Module: DuplicateYAMLKey', () => {
  const offensesFor = async (source: string) =>
    (await check({ 'app/translations/en/app.yml': source }, [DuplicateYAMLKey])).map((offense) => ({
      message: offense.message,
      start: { line: offense.start.line, character: offense.start.character },
      end: { line: offense.end.line, character: offense.end.character },
    }));

  const discarded = (key: string, survivorLine: number) =>
    `Duplicate key '${key}': this value is discarded because the same key is defined again ` +
    `on line ${survivorLine}, and the platform keeps the last one.`;

  it('reports a top-level duplicate, anchored on the DISCARDED entry', async () => {
    // The range covers `name: car` — the entry that does nothing — rather than the one
    // that wins. Anchoring on the later occurrence would point the author at the working
    // value and invite them to delete it.
    expect(await offensesFor('name: car\nname: van\n')).toEqual([
      {
        message: discarded('name', 2),
        start: { line: 0, character: 0 },
        end: { line: 0, character: 9 },
      },
    ]);
  });

  it('reports a duplicate nested inside a property', async () => {
    expect(await offensesFor('properties:\n  make: ford\n  make: audi\n')).toEqual([
      {
        message: discarded('make', 3),
        start: { line: 1, character: 2 },
        end: { line: 1, character: 12 },
      },
    ]);
  });

  it('reports a duplicate inside a sequence item', async () => {
    // Sequences hold maps, so the walk has to descend through them. Measured: this
    // resolves to `{a: 2}`, exactly like a duplicate anywhere else.
    expect(await offensesFor('items:\n  - a: 1\n    a: 2\n')).toEqual([
      {
        message: discarded('a', 3),
        start: { line: 1, character: 4 },
        end: { line: 1, character: 8 },
      },
    ]);
  });

  it('reports EVERY discarded occurrence, each naming the one that survives', async () => {
    // Three occurrences means two discards, and both point at the last entry rather than
    // at the next one — pairwise shadowing is accurate about the mechanism and useless
    // about the outcome, which is that only line 3 survives.
    expect(await offensesFor('a: 1\na: 2\na: 3\n')).toEqual([
      {
        message: discarded('a', 3),
        start: { line: 0, character: 0 },
        end: { line: 0, character: 4 },
      },
      {
        message: discarded('a', 3),
        start: { line: 1, character: 0 },
        end: { line: 1, character: 4 },
      },
    ]);
  });

  it('reports a duplicate whose entries have no value', async () => {
    // `a:` twice is still a key written twice. There is no value to lose, but the author
    // wrote something that does nothing, which is the same defect.
    expect(await offensesFor('a:\na:\n')).toEqual([
      {
        message: discarded('a', 2),
        start: { line: 0, character: 0 },
        end: { line: 0, character: 2 },
      },
    ]);
  });

  describe('legal YAML it must stay silent about', () => {
    it('says nothing about distinct keys', async () => {
      expect(await offensesFor('name: car\nmodel: van\n')).toEqual([]);
    });

    it('says nothing about the same key in DIFFERENT mappings', async () => {
      // `title` under two parents is not a duplicate — this is the single most common
      // shape in a translations file, and reporting it would make the check unusable.
      expect(await offensesFor('en:\n  a:\n    title: one\n  b:\n    title: two\n')).toEqual([]);
    });

    it('says nothing about a number key and a string key that look alike', async () => {
      // `1` and `"1"` are one key in a JS object and TWO in a Ruby Hash, and the platform
      // is the authority. Comparing by source text would report this; comparing by
      // resolved type and value does not.
      expect(await offensesFor('1: a\n"1": b\n')).toEqual([]);
    });

    it('says nothing about scalars that resolve to different types', async () => {
      // YAML 1.2 resolves `yes` to a string and `true` to a boolean.
      expect(await offensesFor('yes: a\ntrue: b\n')).toEqual([]);
    });

    it('says nothing about repeated merge keys', async () => {
      // `<<` is repeatable under YAML 1.1 merge semantics and what the platform does
      // with it has NOT been measured. Silence is the safe direction until it is.
      expect(await offensesFor('base: &b\n  x: 1\nm:\n  <<: *b\n  <<: *b\n')).toEqual([]);
    });

    it('says nothing about an anchor and its alias', async () => {
      expect(await offensesFor('a: &x 1\nb: *x\n')).toEqual([]);
    });

    it('says nothing about a file that does not parse, even when it ALSO has a duplicate', async () => {
      // An unparseable document belongs to YAMLSyntaxError alone. A second opinion on a
      // file the author must already fix is noise, and the offsets would be untrustworthy.
      //
      // THE DUPLICATE IN THIS FIXTURE IS LOAD-BEARING. An earlier version used a broken
      // file with no duplicate in it, which passes whether or not the guard exists —
      // there was nothing to report either way. Deleting the guard did not fail a single
      // test. The fixture now contains a real duplicate that the parser still recovers
      // enough to see, so the silence is the guard's doing rather than the input's.
      const broken = 'a: 1\na: 2\nb: [unclosed\n';
      expect(await offensesFor(broken)).toEqual([]);

      // The control: the file really is broken, and the duplicate really is findable —
      // so neither half of the assertion above is vacuous.
      expect(
        (await check({ 'app/translations/en/app.yml': broken }, [YAMLSyntaxError])).length > 0,
      ).toBe(true);
      expect(findDuplicateKeys(broken).map((entry) => entry.key)).toEqual(['a']);
    });

    it('says nothing about an empty file', async () => {
      expect(await offensesFor('')).toEqual([]);
    });
  });

  it('reports across every admitted YAML file type', async () => {
    // The check is registered for SourceCodeType.YAML, so it should reach all four types
    // the engine admits. Pinned as the whole set rather than one example, because a
    // routing change that quietly dropped a type is exactly the kind of gap that survives.
    const app: MockApp = {
      'app/model_schemas/car.yml': 'name: car\nname: van\n',
      'app/transactable_types/item.yml': 'name: car\nname: van\n',
      'app/user_profile_types/buyer.yml': 'name: car\nname: van\n',
      'app/translations/en/app.yml': 'name: car\nname: van\n',
    };

    expect(
      (await check(app, [DuplicateYAMLKey]))
        .map((offense) => offense.uri.slice(offense.uri.indexOf('/app/') + 1))
        .sort(),
    ).toEqual([
      'app/model_schemas/car.yml',
      'app/transactable_types/item.yml',
      'app/translations/en/app.yml',
      'app/user_profile_types/buyer.yml',
    ]);
  });
});
