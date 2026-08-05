import { describe, expect, it } from 'vitest';

import { highlightedOffenses, runYAMLCheck } from '../../test';
import { YAMLSyntaxError } from './index';

const messagesOf = (offenses: { message: string }[]) => offenses.map((offense) => offense.message);

describe('Module: YAMLSyntaxError', () => {
  it('should report nothing for a file YAML reads cleanly', async () => {
    const offenses = await runYAMLCheck(YAMLSyntaxError, 'en:\n  hello: Hello\n');

    expect(messagesOf(offenses)).toEqual([]);
  });

  /**
   * The one a real project has: two translators add the same key, the later value wins,
   * and the earlier translation is dead. Nothing reported it, and because the readers
   * refuse a file YAML complains about, that file also stopped contributing keys — on one
   * project, five `en/*.yml` files that way and 561 offenses that were not there.
   */
  it('should report a duplicated mapping key, naming it', async () => {
    const source = 'en:\n  greeting:\n    hello: Hello\n    hello: Hi again\n';

    const offenses = await runYAMLCheck(YAMLSyntaxError, source);

    expect(messagesOf(offenses)).toEqual([
      "Duplicate key 'hello' — the last value wins, so the earlier one is dead.",
    ]);
  });

  it('should highlight the duplicate rather than the whole file', async () => {
    const source = 'en:\n  greeting:\n    hello: Hello\n    hello: Hi again\n';

    const offenses = await runYAMLCheck(YAMLSyntaxError, source);

    expect(highlightedOffenses({ 'app/translations/en.yml': source }, offenses)).toEqual(['hello']);
  });

  it('should report every duplicate in the file, not just the first', async () => {
    const source = 'en:\n  a: 1\n  a: 2\n  b:\n    c: 3\n    c: 4\n';

    const offenses = await runYAMLCheck(YAMLSyntaxError, source);

    expect(messagesOf(offenses)).toEqual([
      "Duplicate key 'a' — the last value wins, so the earlier one is dead.",
      "Duplicate key 'c' — the last value wins, so the earlier one is dead.",
    ]);
  });

  it('should report what YAML says about a file it cannot read, without the line suffix', async () => {
    const offenses = await runYAMLCheck(YAMLSyntaxError, 'en:\n\thello: Hi\n');

    expect(messagesOf(offenses)).toEqual(['Tabs are not allowed as indentation']);
  });

  it('should report an unterminated string', async () => {
    const offenses = await runYAMLCheck(YAMLSyntaxError, 'en:\n  hello: "unterminated\n');

    expect(messagesOf(offenses)).toEqual(['Missing closing "quote']);
  });

  /**
   * A `---` terminator is what half the world's YAML generators emit, and Ruby reads such
   * a file as one document plus an empty one. Reporting it cost 88 offenses on one real
   * project — 83 model schemas, the instance config and three translation files — for
   * nothing. A second document with CONTENT is different: the platform reads only the
   * first, so the rest of the file is dead.
   */
  it('should not report a trailing document terminator', async () => {
    const offenses = await runYAMLCheck(YAMLSyntaxError, '---\nen:\n  hello: Hello\n---\n');

    expect(messagesOf(offenses)).toEqual([]);
  });

  it('should report a second document that has content, which nothing reads', async () => {
    const offenses = await runYAMLCheck(
      YAMLSyntaxError,
      '---\nen:\n  hello: Hello\n---\nen:\n  bye: Bye\n',
    );

    expect(messagesOf(offenses)).toEqual([
      'Only the first YAML document in a file is read; everything after this is ignored.',
    ]);
  });

  it('should still report a problem in a file that also ends with a terminator', async () => {
    const offenses = await runYAMLCheck(
      YAMLSyntaxError,
      '---\nen:\n  hello: Hello\n  hello: Hi\n---\n',
    );

    expect(messagesOf(offenses)).toEqual([
      "Duplicate key 'hello' — the last value wins, so the earlier one is dead.",
    ]);
  });

  it('should report each complaint about a file nothing else will lint', async () => {
    // Every reader refuses a file YAML complains about, so this is the only diagnostic
    // such a file gets — and it has to name each problem, not just the first.
    const offenses = await runYAMLCheck(YAMLSyntaxError, 'pt-BR:\n  hello: :\n  bad yaml');

    expect(messagesOf(offenses)).toEqual([
      'Nested mappings are not allowed in compact mappings',
      'Implicit map keys need to be followed by map values',
    ]);
  });
});
