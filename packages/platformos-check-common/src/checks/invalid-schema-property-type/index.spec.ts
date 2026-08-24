import { SCHEMA_PROPERTY_TYPES } from '@platformos/platformos-common';
import { describe, expect, it } from 'vitest';
import { InvalidSchemaPropertyType } from '.';
import { check, messagesOf } from '../../test';

const SCHEMA = 'app/schema/thing.yml';
const USER = 'app/user.yml';
const TRANSLATIONS = 'app/translations/en.yml';

const VALID_TYPES = `Must be one of: ${SCHEMA_PROPERTY_TYPES.join(', ')}`;

const report = async (files: Record<string, string>) =>
  messagesOf(await check(files, [InvalidSchemaPropertyType]));

/**
 * Measured by REAL deploys — `--dry-run` accepts every rejected case below, because it
 * returns before the nested `CustomAttributeConverter` runs. That gap is why the platform
 * was recorded as accepting unknown property types.
 */
describe('InvalidSchemaPropertyType', () => {
  /**
   * Pinned exactly, not derived. Every other assertion here reads the constant, so a type
   * silently added or dropped would move the tests with it — this is the one place a
   * transcription error has to argue with a literal. Source:
   * `CustomAttributes::CustomAttribute::VALID_ATTRIBUTE_TYPES`, confirmed by the deploy
   * error, which enumerates the set it accepts.
   */
  it('publishes exactly the types the platform names in its own rejection', () => {
    expect([...SCHEMA_PROPERTY_TYPES]).toEqual([
      'string',
      'integer',
      'float',
      'decimal',
      'datetime',
      'time',
      'date',
      'binary',
      'boolean',
      'array',
      'address',
      'file',
      'photo',
      'text',
      'geojson',
      'upload',
    ]);
  });
  it('reports a type the platform does not accept', async () => {
    // Deploy: `Attribute type `not_a_real_type` is not allowed.`
    expect(
      await report({
        [SCHEMA]: 'name: thing\nproperties:\n  - name: t\n    type: not_a_real_type\n',
      }),
    ).toEqual([`Invalid property type 'not_a_real_type'. ${VALID_TYPES}`]);
  });

  it('reports a valid type in the wrong case, which the platform compares literally', async () => {
    // Deploy: `Attribute type `String` is not allowed.` — the model's `inclusion:` is
    // case-sensitive, so this is as fatal as a made-up name.
    expect(
      await report({ [SCHEMA]: 'name: thing\nproperties:\n  - name: t\n    type: String\n' }),
    ).toEqual([`Invalid property type 'String'. ${VALID_TYPES}`]);
  });

  it('accepts every published type, and still reports one that is not', async () => {
    // Derived from the constant rather than restated, so a type added to the platform and
    // to the list cannot fail here — while a list that stopped matching the check would.
    const valid = SCHEMA_PROPERTY_TYPES.map(
      (type, index) => `  - name: p${index}\n    type: ${type}\n`,
    ).join('');

    expect(await report({ [SCHEMA]: `name: thing\nproperties:\n${valid}` })).toEqual([]);

    // The control: the same document with one bad entry appended must still report, so the
    // silence above cannot come from the check simply never running.
    expect(
      await report({
        [SCHEMA]: `name: thing\nproperties:\n${valid}  - name: bad\n    type: nope\n`,
      }),
    ).toEqual([`Invalid property type 'nope'. ${VALID_TYPES}`]);
  });

  it('reports each bad property separately', async () => {
    expect(
      await report({
        [SCHEMA]:
          'name: thing\nproperties:\n  - name: a\n    type: nope\n  - name: b\n    type: string\n  - name: c\n    type: alsonope\n',
      }),
    ).toEqual([
      `Invalid property type 'nope'. ${VALID_TYPES}`,
      `Invalid property type 'alsonope'. ${VALID_TYPES}`,
    ]);
  });

  it('checks user.yml, which shares the same converter', async () => {
    // Measured on the live instance: `app/user.yml` rejects with the identical error.
    expect(
      await report({ [USER]: 'properties:\n  - name: t\n    type: not_a_real_type\n' }),
    ).toEqual([`Invalid property type 'not_a_real_type'. ${VALID_TYPES}`]);
  });

  it('says nothing about a YAML file whose properties are not converted', async () => {
    // ROOT-level `properties`, deliberately: nested under a locale key nothing would be
    // found whether the file-type filter existed or not, which makes the test vacuous.
    // A translation file is YAML and is NOT converted by `CustomAttributeConverter`.
    const source = 'properties:\n  - name: t\n    type: nope\n';

    expect(await report({ [TRANSLATIONS]: source })).toEqual([]);
    // The control: the identical document IS reported where the converter does run.
    expect(await report({ [SCHEMA]: source })).toEqual([
      `Invalid property type 'nope'. ${VALID_TYPES}`,
    ]);
  });

  it.each([
    ['no properties key at all', 'name: thing\n'],
    ['an empty properties sequence', 'name: thing\nproperties: []\n'],
    ['a property that declares no type', 'name: thing\nproperties:\n  - name: t\n'],
    [
      'a Liquid-interpolated type',
      'name: thing\nproperties:\n  - name: t\n    type: "{{ context.type }}"\n',
    ],
  ])('stays silent on %s', async (_label, source) => {
    expect(await report({ [SCHEMA]: source })).toEqual([]);
  });

  it('leaves an unparseable document to YAMLSyntaxError', async () => {
    // Reporting a second opinion on a document that does not parse adds noise, and the
    // offsets would be untrustworthy besides.
    expect(
      await report({ [SCHEMA]: 'name: thing\nproperties:\n  - name: t\n    type: [unclosed\n' }),
    ).toEqual([]);
  });
});
