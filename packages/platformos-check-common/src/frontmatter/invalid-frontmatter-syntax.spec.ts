import { describe, expect, it } from 'vitest';
import { InvalidFrontmatterSyntax } from '../checks/invalid-frontmatter-syntax';
import { UnknownFrontmatterField } from '../checks/unknown-frontmatter-field';
import { MissingLayout } from '../checks/missing-layout';
import { check, messagesOf } from '../test';

const PAGE = 'app/views/pages/test.html.liquid';

/**
 * Malformed frontmatter YAML rejects the deploy and, until this check, was reported by
 * nothing: `YAMLSyntaxError` is `SourceCodeType.YAML` and never sees a `.liquid` file.
 */
describe('InvalidFrontmatterSyntax', () => {
  const report = async (source: string) =>
    messagesOf(await check({ [PAGE]: source }, [InvalidFrontmatterSyntax]));

  it('reports a tab used as indentation', async () => {
    // Measured: `Body contains invalid YAML: found a tab character that violates indentation`.
    expect(
      await report('---\nslug: probe\n\tlayout: application\n---\n<p>hi</p>\n'),
    ).to.have.length(1);
  });

  it('reports an unclosed flow sequence', async () => {
    // Measured: `Body contains invalid YAML: did not find expected ',' or ']'`.
    expect(await report('---\nslug: probe\nlayout: [unclosed\n---\n<p>hi</p>\n')).to.have.length(1);
  });

  it('points at the offending text inside the .liquid file', async () => {
    const source = '---\nslug: probe\nlayout: [unclosed\n---\n<p>hi</p>\n';
    const offenses = await check({ [PAGE]: source }, [InvalidFrontmatterSyntax]);

    // The parser points at the line break that closes the unclosed sequence. Derived from the
    // source so the assertion names the place rather than an offset, and asserted exactly so a
    // failure says which index moved instead of `expected false to be true`.
    const breakAfterUnclosed = source.indexOf('\n---\n');

    expect(
      offenses.map((offense) => ({ start: offense.start.index, end: offense.end.index })),
    ).toEqual([{ start: breakAfterUnclosed, end: breakAfterUnclosed + 1 }]);
  });

  it.each([
    ['a well-formed block', '---\nslug: probe\nlayout: application\n---\n<p>hi</p>\n'],
    ['no frontmatter at all', '<p>hi</p>\n'],
    ['an empty block', '---\n---\n<p>hi</p>\n'],
    ['a body that merely contains ---', '<p>hi</p>\n---\nnot frontmatter\n'],
    ['a nested mapping', '---\nmetadata:\n  title: Notes\n---\n<p>hi</p>\n'],
    ['a sequence', '---\nauthorization_policies:\n  - require_login\n---\n<p>hi</p>\n'],
  ])('stays silent on %s', async (_label, source) => {
    expect(await report(source)).to.deep.equal([]);
  });

  /**
   * One mistake, one diagnostic. `parseDocument` recovers and returns a partial map, so the
   * field-level rules would otherwise report on whichever half of a broken block survived —
   * here, an `unknown_key` that is only "unknown" because the parse fell apart around it.
   */
  it('is the ONLY finding on an unparseable block', async () => {
    const source = '---\nunknown_key: 1\nlayout: [unclosed\n---\n<p>hi</p>\n';
    const offenses = await check({ [PAGE]: source }, [
      InvalidFrontmatterSyntax,
      UnknownFrontmatterField,
      MissingLayout,
    ]);

    expect(offenses.map((offense) => offense.check)).to.deep.equal(['InvalidFrontmatterSyntax']);
  });

  /**
   * A REPEATED KEY IS LEGAL INPUT and must not cost the block its field rules.
   *
   * Measured against the instance: a page declaring `slug` twice syncs without error, the
   * first slug 404s and the second serves — the platform parses frontmatter with Psych,
   * which has no uniqueness rule. `yaml` defaults to `uniqueKeys: true`, so the duplicate
   * became a syntax error, and because every field rule reads through
   * `wellFormedFrontmatterBlock` it took `UnknownFrontmatterField` and `MissingLayout` down
   * with it — one legal key hiding a finding that fails the whole changeset.
   */
  it('says nothing about a repeated key, which the platform accepts', async () => {
    expect(await report('---\nslug: a\nslug: b\n---\n<p>hi</p>\n')).to.deep.equal([]);
  });

  it('lets the field rules fire on a block that also repeats a key', async () => {
    const source =
      '---\nslug: a\nslug: b\nunknown_key: 1\nlayout: no_such_layout\n---\n<p>hi</p>\n';
    const offenses = await check({ [PAGE]: source }, [
      InvalidFrontmatterSyntax,
      UnknownFrontmatterField,
      MissingLayout,
    ]);

    expect(offenses.map((offense) => offense.check).sort()).to.deep.equal([
      'MissingLayout',
      'UnknownFrontmatterField',
    ]);
  });

  /**
   * The suppression itself is still correct and still load-bearing — it is only the
   * definition of "malformed" that was wrong. Without this, making a duplicate legal could
   * equally have been done by deleting the well-formed gate.
   */
  it('still suppresses the field rules when the block is genuinely unparseable', async () => {
    const source = '---\nunknown_key: 1\nlayout: [unclosed\n---\n<p>hi</p>\n';
    const offenses = await check({ [PAGE]: source }, [
      InvalidFrontmatterSyntax,
      UnknownFrontmatterField,
      MissingLayout,
    ]);

    expect(offenses.map((offense) => offense.check)).to.deep.equal(['InvalidFrontmatterSyntax']);
  });

  it('reports a syntax error on one line, with no source excerpt or caret diagram', async () => {
    const messages = await report('---\nslug: probe\nlayout: [unclosed\n---\n<p>hi</p>\n');

    expect(messages.map((message) => message.includes('\n'))).to.deep.equal([false]);
  });

  it('CONTROL: the same field rules DO fire once the block parses', async () => {
    // Without this, the assertion above would pass with the field rules deleted entirely.
    const source = '---\nunknown_key: 1\nlayout: no_such_layout\n---\n<p>hi</p>\n';
    const offenses = await check({ [PAGE]: source }, [
      InvalidFrontmatterSyntax,
      UnknownFrontmatterField,
      MissingLayout,
    ]);

    expect(offenses.map((offense) => offense.check).sort()).to.deep.equal([
      'MissingLayout',
      'UnknownFrontmatterField',
    ]);
  });
});
