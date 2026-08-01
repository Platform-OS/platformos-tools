import { describe, expect, it } from 'vitest';

import { YAMLSyntaxError } from './index';
import { check, MockApp } from '../../test';

/**
 * The gap this closes: a malformed `.yml` used to produce NO diagnostic at all, in
 * every YAML directory the linter admits, while the deploy converter rejected the
 * same file and failed the whole changeset with it.
 *
 * Two properties are load-bearing and are asserted as whole values:
 *
 *   1. it fires for EVERY admitted YAML file type, not only the one with existing
 *      checks — the four types are separate `PlatformOSFileType`s and only
 *      translations had any coverage, which is how three of them were missed twice;
 *   2. the offense carries a REAL position. Reporting 0:0 for every parse failure
 *      would satisfy "reports something" while leaving an agent to find the problem
 *      by eye, and the position is exactly what the previous parse layer discarded.
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
  const BAD_INDENT = 'name: car\nproperties:\n - name: make\n   type: string\n  year: 1\n';

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
      'app/schema/a.yml': 'en:\n  hello: [unclosed\n   bad: : :\n',
    });

    expect(offenses.length).toBeGreaterThan(1);
    expect(offenses.map((offense) => offense.check)).toEqual(offenses.map(() => 'YAMLSyntaxError'));
  });

  it('reports an unterminated construct at end of input without running past it', async () => {
    // `yaml` points one PAST the last character here. An unclamped range would
    // address a position the file does not have.
    const source = 'name: "oops\n';

    expect(await offensesFor({ 'app/schema/a.yml': source })).toEqual([
      {
        check: 'YAMLSyntaxError',
        message: 'Missing closing "quote',
        start: { line: 0, character: 11 },
        end: { line: 0, character: 11 },
      },
    ]);
  });

  it('stays silent on YAML that parses', async () => {
    // Every shape a real project actually contains, including the two that look
    // degenerate. An empty translations file is common and must not be an error.
    expect(
      await offensesFor({
        'app/schema/valid.yml': 'name: car\nproperties:\n  - name: make\n    type: string\n',
        'app/translations/en.yml': 'en:\n  hello: Hello\n',
        'app/translations/empty.yml': '',
        'app/translations/comment_only.yml': '# nothing here\n',
        'app/transactable_types/nested.yml':
          'name: t\nproperties:\n  - name: a\n    type: array\n    items:\n      type: string\n',
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
    expect(await offensesFor({ 'app/schema/multi.yml': 'name: a\n---\nname: b\n' })).toEqual([]);
  });

  it('still reports a real syntax error in the FIRST document of a multi-document file', async () => {
    // The other half of that decision: dropping `MULTIPLE_DOCS` must not drop
    // everything else. Document one is parsed, so its errors are still caught.
    //
    // Documents after the first are NOT parsed and their errors are invisible. That
    // is a property of the parser rather than of this filter — `yaml` reports
    // `MULTIPLE_DOCS` INSTEAD OF a syntax error in document two, never alongside it
    // — so the filter loses no diagnostic that was ever available.
    expect(
      (await offensesFor({ 'app/schema/multi.yml': 'name: [a\n---\nname: b\n' })).map(
        (offense) => offense.message,
      ),
    ).toEqual(['Flow sequence in block collection must be sufficiently indented and end with a ]']);
  });
});
