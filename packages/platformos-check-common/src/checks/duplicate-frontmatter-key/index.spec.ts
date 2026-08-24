import { describe, expect, it } from 'vitest';

import { DuplicateFrontmatterKey } from './index';
import { UnknownFrontmatterField } from '../unknown-frontmatter-field';
import { InvalidFrontmatterSyntax } from '../invalid-frontmatter-syntax';
import { check, messagesOf } from '../../test';

const PAGE = 'app/views/pages/test.html.liquid';

/**
 * A repeated frontmatter key deploys and works — measured, by syncing a page whose `slug` was
 * declared twice: the first slug 404s and the second serves. This check exists for what that
 * costs, which is the earlier value, silently.
 */
describe('Module: DuplicateFrontmatterKey', () => {
  const offensesFor = (source: string) => check({ [PAGE]: source }, [DuplicateFrontmatterKey]);

  const discarded = (key: string, survivorLine: number) =>
    `Duplicate frontmatter key '${key}': this value is discarded because the same key is ` +
    `defined again on line ${survivorLine}, and the platform keeps the last one.`;

  it('reports a duplicate once, anchored on the DISCARDED entry', async () => {
    const source = '---\nslug: first\nslug: second\n---\n<p>hi</p>\n';
    const offenses = await offensesFor(source);

    // The range is sliced back out of the file: it must cover the entry that does NOTHING.
    // Anchoring on the winner would point the author at the value they still have.
    expect(
      offenses.map((offense) => ({
        message: offense.message,
        text: source.slice(offense.start.index, offense.end.index),
      })),
    ).toEqual([{ message: discarded('slug', 3), text: 'slug: first' }]);
  });

  it('names the line of the SURVIVOR, counted in the .liquid file and not in the block', async () => {
    // The block starts on line 2 of the file, so an offset that forgot `bodyOffset` would
    // report a line that is short by one and disagree with the editor gutter.
    const source = '---\nlayout: a\nslug: first\nlayout: b\n---\n<p>hi</p>\n';

    expect(messagesOf(await offensesFor(source))).toEqual([discarded('layout', 4)]);
  });

  it.each([
    ['LF', '---\nlayout: a\nslug: notes\nlayout: b\n---\n<p>hi</p>\n'],
    ['CRLF', '---\r\nlayout: a\r\nslug: notes\r\nlayout: b\r\n---\r\n<p>hi</p>\r\n'],
  ])(
    'places the range correctly in a %s file, for a duplicate below the first line',
    async (_label, source) => {
      const offenses = await offensesFor(source);

      expect(
        offenses.map((offense) => source.slice(offense.start.index, offense.end.index)),
      ).toEqual(['layout: a']);
    },
  );

  it('reports each discarded occurrence when a key appears three times', async () => {
    const source = '---\nslug: one\nslug: two\nslug: three\n---\n<p>hi</p>\n';

    expect(messagesOf(await offensesFor(source))).toEqual([
      discarded('slug', 4),
      discarded('slug', 4),
    ]);
  });

  /**
   * KEY IDENTITY IS THE PLATFORM'S, NOT JAVASCRIPT'S, and it is `findDuplicateKeys` that
   * knows the difference. These two cases fail in OPPOSITE directions if this check ever
   * grows a comparison of its own.
   */
  it('treats `yes` and `true` as ONE key, because Psych does', async () => {
    // YAML 1.1 resolves both to boolean true, so the platform sees one key and drops a value.
    const source = '---\nyes: a\ntrue: b\n---\n<p>hi</p>\n';
    const offenses = await offensesFor(source);

    // The name in the message is the RESOLVED key, so it reads `true` even though the
    // discarded line spells it `yes` — `findDuplicateKeys` reports what the platform sees,
    // and `DuplicateYAMLKey` says the same for a `.yml` file. The RANGE is what tells the
    // author which line to look at, so both are asserted together here.
    expect(
      offenses.map((offense) => ({
        message: offense.message,
        text: source.slice(offense.start.index, offense.end.index),
      })),
    ).toEqual([{ message: discarded('true', 3), text: 'yes: a' }]);
  });

  it('treats `1` and `1.0` as TWO keys, because Ruby Hash does', async () => {
    // `1.eql?(1.0)` is false, so reporting a duplicate here would be a false positive on
    // legal input. JavaScript has one number type and would say these are the same key.
    expect(messagesOf(await offensesFor('---\n1: a\n1.0: b\n---\n<p>hi</p>\n'))).toEqual([]);
  });

  it.each([
    ['a block with no duplicate', '---\nslug: notes\nlayout: app\n---\n<p>hi</p>\n'],
    ['no frontmatter at all', '<p>hi</p>\n'],
    ['an empty block', '---\n---\n<p>hi</p>\n'],
    // The body is not frontmatter, so a repeat there is not a frontmatter duplicate.
    ['a repeated key in the BODY', '---\nslug: notes\n---\nslug: a\nslug: b\n'],
  ])('stays silent on %s', async (_label, source) => {
    expect(messagesOf(await offensesFor(source))).toEqual([]);
  });

  it('leaves an unparseable block to InvalidFrontmatterSyntax alone', async () => {
    const source = '---\nslug: a\nslug: b\nlayout: [unclosed\n---\n<p>hi</p>\n';
    const offenses = await check({ [PAGE]: source }, [
      DuplicateFrontmatterKey,
      InvalidFrontmatterSyntax,
    ]);

    expect(offenses.map((offense) => offense.check)).toEqual(['InvalidFrontmatterSyntax']);
  });

  it('does not stop the field rules from reporting on the same block', async () => {
    // The duplicate is legal input, so it must not suppress its neighbours the way the old
    // uniqueKeys-as-syntax-error behaviour did.
    const source = '---\nslug: a\nslug: b\nunknown_key: 1\n---\n<p>hi</p>\n';
    const offenses = await check({ [PAGE]: source }, [
      DuplicateFrontmatterKey,
      UnknownFrontmatterField,
    ]);

    expect(offenses.map((offense) => offense.check).sort()).toEqual([
      'DuplicateFrontmatterKey',
      'UnknownFrontmatterField',
    ]);
  });
});
