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

    // Derived from the parser rather than hand-written: what is pinned is that the range
    // lands inside the frontmatter block, not what our YAML dialect calls the problem.
    const [offense] = offenses;
    const start = source.indexOf('layout: [unclosed');
    const end = source.indexOf('\n---\n', start);
    expect(offense.start.index >= start && offense.end.index <= end + 1).toBe(true);
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
