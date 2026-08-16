import { describe, expect, it } from 'vitest';

import { DuplicateYAMLKey } from './index';
import { YAMLSyntaxError } from '../yaml-syntax-error';
import { check, MockApp } from '../../test';
import { findDuplicateKeys } from '../../yaml/duplicate-keys';

/**
 * A repeated YAML key deploys and works — the platform keeps the LAST value. This check exists
 * for what that costs: the earlier value is gone, and nothing else says so.
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
    expect(
      await offensesFor(`name: car
name: van
`),
    ).toEqual([
      {
        message: discarded('name', 2),
        start: { line: 0, character: 0 },
        end: { line: 0, character: 9 },
      },
    ]);
  });

  it('reports a duplicate nested inside a property', async () => {
    expect(
      await offensesFor(`properties:
  make: ford
  make: audi
`),
    ).toEqual([
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
    expect(
      await offensesFor(`items:
  - a: 1
    a: 2
`),
    ).toEqual([
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
    expect(
      await offensesFor(`a: 1
a: 2
a: 3
`),
    ).toEqual([
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

  it('reports the YAML 1.1 boolean family, which the platform collapses', async () => {
    // ROUND 5 FOUND THIS SILENT, and the silence was DOCUMENTED as correct: "YAML 1.2
    // resolves `yes` to a string and `true` to a boolean, so they are different keys."
    // True of npm `yaml`. False of the platform — Psych is a YAML 1.1 implementation and
    // resolves BOTH to boolean `true`, so `{true=>"b"}` has size 1 and the `yes:` value
    // is silently discarded. Exactly the data loss this check exists to report.
    expect([
      (
        await offensesFor(`yes: a
true: b
`)
      ).length,
      (
        await offensesFor(`on: a
true: b
`)
      ).length,
      (
        await offensesFor(`off: a
false: b
`)
      ).length,
      // 1.1 octal: `014` is 12, so this collides too. Also missed before.
      (
        await offensesFor(`014: a
12: b
`)
      ).length,
      // ...while `on:` and `off:` are different booleans and must NOT collide.
      (
        await offensesFor(`on: a
off: b
`)
      ).length,
    ]).toEqual([1, 1, 1, 1, 0]);
  });

  it('reports a duplicate whose entries have no value', async () => {
    // `a:` twice is still a key written twice. There is no value to lose, but the author
    // wrote something that does nothing, which is the same defect.
    expect(
      await offensesFor(`a:
a:
`),
    ).toEqual([
      {
        message: discarded('a', 2),
        start: { line: 0, character: 0 },
        end: { line: 0, character: 2 },
      },
    ]);
  });

  describe('legal YAML it must stay silent about', () => {
    it('says nothing about distinct keys', async () => {
      expect(
        await offensesFor(`name: car
model: van
`),
      ).toEqual([]);
    });

    it('says nothing about the same key in DIFFERENT mappings', async () => {
      // `title` under two parents is not a duplicate — this is the single most common
      // shape in a translations file, and reporting it would make the check unusable.
      expect(
        await offensesFor(`en:
  a:
    title: one
  b:
    title: two
`),
      ).toEqual([]);
    });

    it('says nothing about a number key and a string key that look alike', async () => {
      // `1` and `"1"` are one key in a JS object and TWO in a Ruby Hash, and the platform
      // is the authority. Comparing by source text would report this; comparing by
      // resolved type and value does not.
      expect(
        await offensesFor(`1: a
"1": b
`),
      ).toEqual([]);
    });

    it('says nothing about a number key and a FLOAT key at the same value', async () => {
      // `1` and `1.0` are numerically equal and are still two keys: Ruby's Hash uses
      // `eql?`, and `1.eql?(1.0)` is false. Measured — `{1=>'x', 1.0=>'y'}` has size 2.
      //
      // JS has one number type, so an identity built from `typeof` + `String()` made
      // these identical and reported a duplicate that does not exist. Round 5 found it.
      expect(
        await offensesFor(`1: x
1.0: y
`),
      ).toEqual([]);
    });

    it('says nothing about tokens the two parsers resolve differently', async () => {
      // The UNCOMPARABLE set, asserted as behaviour. Each of these is a spelling where
      // npm `yaml` and Psych disagree, so comparing it to anything risks a false
      // positive — `y` is a boolean to npm and a string to Psych, `1e3` a number to npm
      // and a string to Psych, `.inf` carries a null VALUE in npm which would collide
      // with a real `null:` key.
      expect([
        await offensesFor(`y: a
true: b
`),
        await offensesFor(`1e3: a
1000: b
`),
        await offensesFor(`.inf: a
null: b
`),
        await offensesFor(`0X10: a
16: b
`),
        await offensesFor(`1:30: a
5400: b
`),
      ]).toEqual([[], [], [], [], []]);
    });

    it('says nothing about repeated merge keys', async () => {
      // `<<` is repeatable under YAML 1.1 merge semantics and what the platform does
      // with it has NOT been measured. Silence is the safe direction until it is.
      expect(
        await offensesFor(`base: &b
  x: 1
m:
  <<: *b
  <<: *b
`),
      ).toEqual([]);
    });

    it('says nothing about an anchor and its alias', async () => {
      expect(
        await offensesFor(`a: &x 1
b: *x
`),
      ).toEqual([]);
    });

    it('says nothing about a file that does not parse, even when it ALSO has a duplicate', async () => {
      // An unparseable document belongs to YAMLSyntaxError alone. A second opinion on a
      // file the author must already fix is noise, and the offsets would be untrustworthy.
      const broken = `a: 1
a: 2
b: [unclosed
`;
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
      'app/model_schemas/car.yml': `name: car
name: van
`,
      'app/transactable_types/item.yml': `name: car
name: van
`,
      'app/user_profile_types/buyer.yml': `name: car
name: van
`,
      'app/translations/en/app.yml': `name: car
name: van
`,
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
