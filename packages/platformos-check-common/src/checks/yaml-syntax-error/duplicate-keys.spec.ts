import { describe, expect, it } from 'vitest';

import { YAMLSyntaxError } from './index';
import { MatchingTranslations } from '../matching-translations';
import { check, MockApp } from '../../test';

/**
 * A REPEATED KEY IS NOT A PARSE FAILURE. `pos-cli deploy --dry-run` accepts one at the
 * top level, inside a property, and in a translation file, and resolves it last-wins.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM `index.spec.ts`. That file proves the check
 * FIRES. This one proves where it must stay SILENT, and the distinction is the whole
 * lesson of the bug it was written for: `yaml` defaults `uniqueKeys` to `true`, so a
 * duplicated key became a hard refusal to write — while the check's own docstring and
 * the server's agent-facing instructions both stated, correctly and from measurement,
 * that duplicates are not reported. Two documents said it, no test asserted it, and
 * the suite stayed green for the entire time the code did the opposite.
 *
 * Prose cannot fail. That is the only reason this file is here rather than a sentence
 * in a comment, and it is why the assertions below name the empty array explicitly
 * instead of checking a count.
 *
 * THE CONTROLS MATTER AS MUCH AS THE SILENCE. A suppression wide enough to hide a real
 * syntax error would pass every "nothing was reported" assertion ever written, so each
 * section pairs its silence with a case that must still be reported.
 */
describe('Module: YAMLSyntaxError — duplicate keys are accepted, as the platform accepts them', () => {
  const offensesFor = async (app: MockApp) =>
    (await check(app, [YAMLSyntaxError])).map((offense) => ({
      uri: offense.uri.slice(offense.uri.indexOf('/app/') + 1),
      check: offense.check,
      message: offense.message,
    }));

  /** Both duplicate shapes the evaluation deployed and the converter accepted. */
  const TOP_LEVEL_DUPLICATE = `name: car
name: van
`;
  const NESTED_DUPLICATE = `name: car
properties:
  make: ford
  make: audi
`;

  /**
   * Every admitted YAML file type. ONE extension, because there is only one:
   * `REFERENCE_EXTENSIONS` excludes `.yaml` deliberately — every YAML model in the backend
   * anchors `\.yml\z` (`translation.rb:7`, `custom_model_type.rb:12`,
   * `instance_profile_type.rb:7`, `transactable_type.rb:7`,
   * `activity_streams/handler.rb:7`), so `app/translations/en.yaml` is never deployed.
   * That exclusion is owned and tested by `platformos-common`'s `path-utils.spec.ts`; it
   * is not re-asserted here.
   *
   * This loop USED to run over `['yml', 'yaml']`, on the premise that the second spelling
   * was "an untested path through the same gate". There is no such path, so the `.yaml`
   * half asserted silence over an app containing NOTHING — a suppression test that could
   * not fail. It passed for exactly as long as `getApp` tolerated a path it dropped.
   */
  const EVERY_YAML_LOCATION = [
    'app/schema/a',
    'app/model_schemas/b',
    'app/custom_model_types/c',
    'app/transactable_types/d',
    'app/user_profile_types/e',
    'app/translations/en',
  ];

  const appWith = (content: string): MockApp =>
    Object.fromEntries(EVERY_YAML_LOCATION.map((path) => [`${path}.yml`, content]));

  it('says nothing about a top-level duplicate in any admitted YAML file', async () => {
    expect(await offensesFor(appWith(TOP_LEVEL_DUPLICATE))).toEqual([]);
  });

  it('says nothing about a duplicate nested inside a property in any admitted YAML file', async () => {
    expect(await offensesFor(appWith(NESTED_DUPLICATE))).toEqual([]);
  });

  it('still reports a genuine syntax error in a file that ALSO has a duplicate key', async () => {
    // The control for the two assertions above. Suppressing `DUPLICATE_KEY` must not
    // suppress the failure classes the check exists for, and a file carrying both is
    // the case where a too-broad suppression would hide one.
    expect(
      await offensesFor({
        'app/schema/both.yml': `name: car
name: van
properties: [unclosed
`,
      }),
    ).toEqual([
      {
        uri: 'app/schema/both.yml',
        check: 'YAMLSyntaxError',
        message: 'Flow sequence in block collection must be sufficiently indented and end with a ]',
      },
    ]);
  });

  it('says nothing about an unknown property either, the other claim both documents make', async () => {
    // `instructions.ts` tells the agent that neither an unknown property nor a
    // duplicated name is reported, "because the platform accepts both". The duplicate
    // half of that sentence turned out to be false. This pins the other half so it
    // cannot rot the same way — schema SHAPE is deliberately not validated here.
    expect(
      await offensesFor({
        'app/schema/unknown.yml': `name: car
not_a_real_property: 1
properties:
  make: ford
`,
      }),
    ).toEqual([]);
  });
});

/**
 * The second half of the fix, and the reason the parser option alone was not enough.
 *
 * `js-yaml` — a DIFFERENT parser from the one above, used to load translations — also
 * rejects duplicate keys by default, and its callers treat a throw as "this file has
 * no translations". So removing the false block on its own produced a new false
 * report: a locale file with one repeated key contributed nothing, and every key in it
 * was announced as missing. The two readers now agree, both taking the last value.
 */
describe('Module: MatchingTranslations — a duplicate key does not empty a locale', () => {
  const messagesFor = async (app: MockApp) =>
    (await check(app, [MatchingTranslations])).map((offense) => ({
      uri: offense.uri.slice(offense.uri.indexOf('/app/') + 1),
      message: offense.message,
    }));

  it('reports nothing when the reference locale repeats a key', async () => {
    expect(
      await messagesFor({
        'app/translations/en.yml': `en:
  hello: Hello
  hello: Again
`,
        'app/translations/fr.yml': `fr:
  hello: Bonjour
`,
      }),
    ).toEqual([]);
  });

  it('reports nothing when the translated locale repeats a key', async () => {
    // The regression the parser fix introduced on its own: `fr.yml` HAS `hello`, twice,
    // and was told the translation for it was missing.
    expect(
      await messagesFor({
        'app/translations/en.yml': `en:
  hello: Hello
`,
        'app/translations/fr.yml': `fr:
  hello: Bonjour
  hello: Salut
`,
      }),
    ).toEqual([]);
  });

  it('reports nothing when both locales repeat a key', async () => {
    expect(
      await messagesFor({
        'app/translations/en.yml': `en:
  hello: Hello
  hello: Again
`,
        'app/translations/fr.yml': `fr:
  hello: Bonjour
  hello: Salut
`,
      }),
    ).toEqual([]);
  });

  it('STILL reports a genuinely missing translation, duplicates or not', async () => {
    // The control. Without it, the three assertions above would also pass if the check
    // had simply stopped working.
    expect(
      await messagesFor({
        'app/translations/en.yml': `en:
  hello: Hello
  hello: Again
  bye: Bye
`,
        'app/translations/fr.yml': `fr:
  hello: Bonjour
  hello: Salut
`,
      }),
    ).toEqual([
      { uri: 'app/translations/fr.yml', message: "The translation for 'bye' is missing" },
    ]);
  });
});
