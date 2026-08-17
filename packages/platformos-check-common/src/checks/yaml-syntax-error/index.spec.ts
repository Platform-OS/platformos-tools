import { describe, expect, it } from 'vitest';

import { YAMLSyntaxError } from './index';
import { DuplicateYAMLKey } from '../duplicate-yaml-key';
import { check, MockApp, runYAMLCheck } from '../../test';

/**
 * The gap this closes: a malformed `.yml` used to produce NO diagnostic at all, in
 * every YAML directory the linter admits, while the deploy converter rejected the
 * same file and failed the whole changeset with it.
 */
describe('Module: YAMLSyntaxError', () => {
  const offensesFor = async (app: MockApp) =>
    (await check(app, [YAMLSyntaxError])).map((offense) => ({
      check: offense.check,
      message: offense.message,
      start: { line: offense.start.line, character: offense.start.character },
      end: { line: offense.end.line, character: offense.end.character },
    }));

  /** Invalid: the second property sits one column left of the first sequence item. */
  const BAD_INDENT = `name: car
properties:
 - name: make
   type: string
  year: 1
`;

  it('reports a parse failure at the position it happened', async () => {
    expect(await offensesFor({ 'app/schema/car.yml': BAD_INDENT })).toEqual([
      {
        check: 'YAMLSyntaxError',
        message: 'Sequence item without - indicator',
        start: { line: 4, character: 0 },
        end: { line: 4, character: 1 },
      },
    ]);
  });

  it('fires for every YAML file type the linter admits, not only translations', async () => {
    // The four members of `YAML_FILE_TYPES`. Three of them have no other check of
    // any kind, so before this one they were entirely unvalidated; the fourth
    // (translations) had two CONTENT checks, both of which bail on an unparseable
    // document — which is why it was mistaken for covered.
    const app: MockApp = {
      'app/schema/a.yml': BAD_INDENT,
      'app/model_schemas/b.yml': BAD_INDENT,
      'app/custom_model_types/c.yml': BAD_INDENT,
      'app/transactable_types/d.yml': BAD_INDENT,
      'app/user_profile_types/e.yml': BAD_INDENT,
      'app/translations/en.yml': BAD_INDENT,
    };

    const byFile = (await check(app, [YAMLSyntaxError])).map((offense) =>
      offense.uri.slice(offense.uri.indexOf('/app/') + 1),
    );

    expect(byFile.sort()).toEqual([
      'app/custom_model_types/c.yml',
      'app/model_schemas/b.yml',
      'app/schema/a.yml',
      'app/transactable_types/d.yml',
      'app/translations/en.yml',
      'app/user_profile_types/e.yml',
    ]);
  });

  it('reports each independent failure the parser recovers from', async () => {
    // The parser keeps going after an error, so one document can carry several. Only
    // the first would be reported if this took `errors[0]`, which is what the parse
    // layer used to do.
    const offenses = await offensesFor({
      'app/schema/a.yml': `en:
  hello: [unclosed
   bad: : :
`,
    });

    expect(offenses.length).toBeGreaterThan(1);
    expect(offenses.map((offense) => offense.check)).toEqual(offenses.map(() => 'YAMLSyntaxError'));
  });

  it('reports an unterminated construct at end of input without running past it', async () => {
    // `yaml` reports `[length, length + 1]` for an unterminated construct — one PAST
    // the last character. The parse layer clamps that to the source, and the position
    // is then the empty last line the trailing newline opens: line 1, character 0.
    const source = 'name: "oops\n';

    expect(await offensesFor({ 'app/schema/a.yml': source })).toEqual([
      {
        check: 'YAMLSyntaxError',
        message: 'Missing closing "quote',
        start: { line: 1, character: 0 },
        end: { line: 1, character: 0 },
      },
    ]);
  });

  it('stays silent on YAML that parses', async () => {
    // Every shape a real project actually contains, including the two that look
    // degenerate. An empty translations file is common and must not be an error.
    expect(
      await offensesFor({
        'app/schema/valid.yml': `name: car
properties:
  - name: make
    type: string
`,
        'app/translations/en.yml': `en:
  hello: Hello
`,
        'app/translations/empty.yml': '',
        'app/translations/comment_only.yml': '# nothing here\n',
        'app/transactable_types/nested.yml': `name: t
properties:
  - name: a
    type: array
    items:
      type: string
`,
      }),
    ).toEqual([]);
  });

  it('stays silent on a multi-document file, which is valid YAML', async () => {
    // MEASURED, and it is the one case that could have shipped a false BLOCK.
    // `parseDocument` raises `MULTIPLE_DOCS` here — not because the file is broken
    // (it hands back a fully parsed first document) but because it was asked for one
    // document and found several. Multi-document YAML is valid YAML, so objecting to
    // it would refuse a write over our own calling convention. `toYAMLNode` drops
    // that error specifically; this pins the decision.
    expect(
      await offensesFor({
        'app/schema/multi.yml': `name: a
---
name: b
`,
      }),
    ).toEqual([]);
  });

  it('still reports a real syntax error in the FIRST document of a multi-document file', async () => {
    // The other half of that decision: dropping `MULTIPLE_DOCS` must not drop
    // everything else. Document one is parsed, so its errors are still caught.
    expect(
      (
        await offensesFor({
          'app/schema/multi.yml': `name: [a
---
name: b
`,
        })
      ).map((offense) => offense.message),
    ).toEqual(['Flow sequence in block collection must be sufficiently indented and end with a ]']);
  });
});

/**
 * Cases carried over from an independently-written second implementation of this check.
 * They are kept because each one is a MEASUREMENT, not a
 * preference — the message shape, the terminator, and the multi-problem file were all
 * measured against real projects.
 */
describe('Module: YAMLSyntaxError (message shape and document structure)', () => {
  const messagesOf = async (source: string) =>
    (await runYAMLCheck(YAMLSyntaxError, source, 'app/translations/en.yml')).map(
      (offense) => offense.message,
    );

  it('reports nothing for a file YAML reads cleanly', async () => {
    expect(
      await messagesOf(`en:
  hello: Hello
`),
    ).toEqual([]);
  });

  it("reports the parser's complaint without its trailing line/column suffix", async () => {
    // The position travels structurally on the offense, so the prose must not repeat it.
    expect(await messagesOf('en:\n\thello: Hi\n')).toEqual(['Tabs are not allowed as indentation']);
  });

  it('reports an unterminated string', async () => {
    expect(
      await messagesOf(`en:
  hello: "unterminated
`),
    ).toEqual(['Missing closing "quote']);
  });

  /**
   * A `---` terminator is what half the world's YAML generators emit, and Ruby reads such
   * a file as one document plus an empty one. Reporting it cost 88 offenses on one real
   * project — 83 model schemas, the instance config and three translation files — for
   * nothing.
   */
  it('does not report a trailing document terminator', async () => {
    expect(
      await messagesOf(`---
en:
  hello: Hello
---
`),
    ).toEqual([]);
  });

  it('reports every complaint about a file nothing else will lint, not just the first', async () => {
    // Every other YAML reader declines a file the parser complains about, so this is the
    // only diagnostic such a file gets — it has to name each problem.
    expect(
      await messagesOf(`pt-BR:
  hello: :
  bad yaml`),
    ).toEqual([
      'Nested mappings are not allowed in compact mappings',
      'Implicit map keys need to be followed by map values',
    ]);
  });
});

/**
 * The SILENCE this check promises, with the controls that make it non-vacuous.
 */
describe('Module: YAMLSyntaxError (duplicate keys belong to DuplicateYAMLKey)', () => {
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

  const DUPLICATED_TRANSLATION = `en:
  hello: Hello
  hello: Hi
`;

  /**
   * Every admitted YAML file type. ONE extension, because there is only one:
   * `REFERENCE_EXTENSIONS` excludes `.yaml` deliberately — every YAML model in the backend
   * anchors `\.yml\z` — so `app/translations/en.yaml` is never deployed. That exclusion is owned
   * and tested by `platformos-common`'s `path-utils.spec.ts`.
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

  it('stays silent even when the file also ends with a document terminator', async () => {
    expect(
      await runYAMLCheck(
        YAMLSyntaxError,
        `---
en:
  hello: Hello
  hello: Hi
---
`,
        'app/translations/en.yml',
      ),
    ).toEqual([]);
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

  it('CONTROL: still reports a genuine syntax error in a file that ALSO has a duplicate key', async () => {
    // Suppressing `DUPLICATE_KEY` must not suppress the failure classes the check exists
    // for, and a file carrying both is the case where a too-broad suppression hides one.
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

  it('CONTROL: the same file is not silent overall — DuplicateYAMLKey reports it', async () => {
    const offenses = await runYAMLCheck(
      DuplicateYAMLKey,
      DUPLICATED_TRANSLATION,
      'app/translations/en.yml',
    );

    expect(offenses.map((offense) => ({ check: offense.check, message: offense.message }))).toEqual(
      [
        {
          check: 'DuplicateYAMLKey',
          message:
            "Duplicate key 'hello': this value is discarded because the same key is defined " +
            'again on line 3, and the platform keeps the last one.',
        },
      ],
    );
  });
});
