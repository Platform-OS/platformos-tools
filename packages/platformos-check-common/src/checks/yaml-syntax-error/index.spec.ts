import { describe, expect, it } from 'vitest';

import { YAMLSyntaxError } from './index';
import { DuplicateYAMLKey } from '../duplicate-yaml-key';
import { check, MockApp, runYAMLCheck } from '../../test';

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
    // `yaml` reports `[length, length + 1]` for an unterminated construct — one PAST
    // the last character. The parse layer clamps that to the source, and the position
    // is then the empty last line the trailing newline opens: line 1, character 0.
    //
    // This asserted line 0, character 11 until `getPosition` learned to place an
    // end-of-input offset. It could not name the position after the last character,
    // so it named the last character instead, putting a whole class of parse errors —
    // every unterminated construct `yaml` reports — one place early.
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

/**
 * Cases carried over from the independently-written second implementation of this check
 * (master's, TASK-58/59 era). They are kept because each one is a MEASUREMENT, not a
 * preference — the message shape, the terminator, and the multi-problem file were all
 * measured against real projects.
 *
 * The three duplicate-key cases from that implementation are deliberately NOT carried
 * over, and their absence is asserted below instead. That implementation reported
 * `DUPLICATE_KEY` at severity ERROR from a check that is in `BLOCKING_CHECKS` — and the
 * converter ACCEPTS a duplicated key (`pos-cli deploy --dry-run`, measured at the top
 * level, inside a property and in a translation file). Blocking a write the platform
 * would take is the failure mode this whole check was scoped to avoid.
 */
describe('Module: YAMLSyntaxError (message shape and document structure)', () => {
  const messagesOf = async (source: string) =>
    (await runYAMLCheck(YAMLSyntaxError, source, 'app/translations/en.yml')).map(
      (offense) => offense.message,
    );

  it('reports nothing for a file YAML reads cleanly', async () => {
    expect(await messagesOf('en:\n  hello: Hello\n')).toEqual([]);
  });

  it("reports the parser's complaint without its trailing line/column suffix", async () => {
    // The position travels structurally on the offense, so the prose must not repeat it.
    expect(await messagesOf('en:\n\thello: Hi\n')).toEqual(['Tabs are not allowed as indentation']);
  });

  it('reports an unterminated string', async () => {
    expect(await messagesOf('en:\n  hello: "unterminated\n')).toEqual(['Missing closing "quote']);
  });

  /**
   * A `---` terminator is what half the world's YAML generators emit, and Ruby reads such
   * a file as one document plus an empty one. Reporting it cost 88 offenses on one real
   * project — 83 model schemas, the instance config and three translation files — for
   * nothing.
   */
  it('does not report a trailing document terminator', async () => {
    expect(await messagesOf('---\nen:\n  hello: Hello\n---\n')).toEqual([]);
  });

  it('reports every complaint about a file nothing else will lint, not just the first', async () => {
    // Every other YAML reader declines a file the parser complains about, so this is the
    // only diagnostic such a file gets — it has to name each problem.
    expect(await messagesOf('pt-BR:\n  hello: :\n  bad yaml')).toEqual([
      'Nested mappings are not allowed in compact mappings',
      'Implicit map keys need to be followed by map values',
    ]);
  });
});

/**
 * The SILENCE this check promises, with the control that makes it non-vacuous.
 *
 * A duplicated key is not a syntax error: the converter accepts the file and the platform
 * resolves it last-wins (both measured — see `toYAMLNode`). Reporting it HERE would put a
 * false block on a write the platform would take, because this check is an ERROR and is in
 * `BLOCKING_CHECKS`. The discarded value is still a real defect, which is why the control
 * matters: `DuplicateYAMLKey` reports it as a non-blocking WARNING.
 */
describe('Module: YAMLSyntaxError (duplicate keys belong to DuplicateYAMLKey)', () => {
  const DUPLICATED = 'en:\n  hello: Hello\n  hello: Hi\n';

  it('does not report a duplicated mapping key', async () => {
    expect(await runYAMLCheck(YAMLSyntaxError, DUPLICATED, 'app/translations/en.yml')).toEqual([]);
  });

  it('stays silent even when the file also ends with a document terminator', async () => {
    expect(
      await runYAMLCheck(
        YAMLSyntaxError,
        '---\nen:\n  hello: Hello\n  hello: Hi\n---\n',
        'app/translations/en.yml',
      ),
    ).toEqual([]);
  });

  it('CONTROL: the same file is not silent overall — DuplicateYAMLKey reports it', async () => {
    const offenses = await runYAMLCheck(DuplicateYAMLKey, DUPLICATED, 'app/translations/en.yml');

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
