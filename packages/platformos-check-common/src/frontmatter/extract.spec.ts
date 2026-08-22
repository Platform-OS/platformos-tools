import { PlatformOSFileType } from '@platformos/platformos-common';
import { describe, expect, it } from 'vitest';
import { frontmatterBlock } from './extract';

const page = (source: string) => ({ source });

describe('frontmatterBlock', () => {
  it('has no block for a file that declares no frontmatter', () => {
    const withoutBlock = [
      '<p>hi</p>',
      '', // empty file
      '   ', // whitespace only
      '--\nslug: x\n--\n', // not a frontmatter fence
      '---\nslug: x\n', // opening fence never closed
      '---', // opening fence with no newline
    ];

    expect(
      withoutBlock.filter(
        (source) => frontmatterBlock(page(source), PlatformOSFileType.Page) !== undefined,
      ),
    ).toEqual([]);
  });

  it('has no block for a file type that declares no frontmatter schema', () => {
    // The block is well formed; it is the TYPE that has no schema, so nothing reads it.
    const source = '---\nslug: x\n---\n';

    expect(frontmatterBlock(page(source), undefined)).toBeUndefined();
  });

  it('reads keys and values with offsets into the .liquid file, not the YAML body', () => {
    const source = '---\nslug: notes\n---\n<p>hi</p>';
    const block = frontmatterBlock(page(source), PlatformOSFileType.Page)!;
    const slug = block.entries.get('slug')!;

    expect({
      keys: [...block.entries.keys()],
      jsValue: slug.jsValue,
      key: source.slice(slug.absStart, slug.absEnd),
      value: source.slice(slug.valueAbsStart, slug.valueAbsEnd),
      fence: source.slice(block.frontmatterStart, block.frontmatterStart + 3),
    }).toEqual({
      keys: ['slug'],
      jsValue: 'notes',
      key: 'slug',
      value: 'notes',
      fence: '---',
    });
  });

  it('offsets survive leading whitespace before the opening fence', () => {
    const source = '\n\n---\nslug: notes\n---\n';
    const block = frontmatterBlock(page(source), PlatformOSFileType.Page)!;
    const slug = block.entries.get('slug')!;

    expect(source.slice(slug.absStart, slug.absEnd)).toEqual('slug');
    expect(source.slice(block.frontmatterStart, block.frontmatterStart + 3)).toEqual('---');
  });

  it('reads an empty frontmatter block as a block with no entries', () => {
    // Distinct from "no block at all": a required-field rule must see this and fire.
    const block = frontmatterBlock(page('---\n---\n'), PlatformOSFileType.Page);

    expect(block && [...block.entries.keys()]).toEqual([]);
  });

  it('carries a non-scalar value as undefined while keeping the key addressable', () => {
    const source = '---\nauthorization_policies:\n  - require_login\n---\n';
    const block = frontmatterBlock(page(source), PlatformOSFileType.Page)!;
    const entry = block.entries.get('authorization_policies')!;

    // The sequence is reachable through `doc`; `jsValue` is undefined because it is not a
    // scalar, which is exactly the case that used to render as the string "undefined".
    expect(entry.jsValue).toBeUndefined();
    expect(source.slice(entry.absStart, entry.absEnd)).toEqual('authorization_policies');
  });

  it('keeps a partial map when the YAML is malformed, and records the errors', () => {
    // parseDocument is lenient on purpose: the valid pairs still get checked. The errors
    // are what a frontmatter-syntax rule reports.
    const block = frontmatterBlock(
      page('---\nslug: notes\nlayout: [unclosed\n---\n'),
      PlatformOSFileType.Page,
    )!;

    expect(block.entries.get('slug')?.jsValue).toEqual('notes');
    expect(block.doc.errors.length > 0).toBe(true);
  });

  it('normalises CRLF so a value carries no stray carriage return', () => {
    const block = frontmatterBlock(page('---\r\nslug: notes\r\n---\r\n'), PlatformOSFileType.Page)!;

    expect(block.entries.get('slug')?.jsValue).toEqual('notes');
  });

  /**
   * The memo exists because `parseDocument` costs ~80 µs and five checks read one block —
   * ~640 ms of redundant parsing over a 2 000-page project. A cache that never hits would
   * be invisible without this test, and a cache that never INVALIDATES would serve the
   * language server a stale block after every keystroke.
   */
  describe('memoisation', () => {
    it('parses one file once, and different files separately', () => {
      const fileA = page('---\nslug: a\n---\n');
      const fileB = page('---\nslug: b\n---\n');

      expect(frontmatterBlock(fileA, PlatformOSFileType.Page)).toBe(
        frontmatterBlock(fileA, PlatformOSFileType.Page),
      );
      expect(frontmatterBlock(fileA, PlatformOSFileType.Page)).not.toBe(
        frontmatterBlock(fileB, PlatformOSFileType.Page),
      );
    });

    it('re-parses when the same file object is given new source', () => {
      // An AppFile object is reused when its buffer is re-read, so identity alone is not
      // enough to key on.
      const file = { source: '---\nslug: before\n---\n' };
      const before = frontmatterBlock(file, PlatformOSFileType.Page);

      file.source = '---\nslug: after\n---\n';
      const after = frontmatterBlock(file, PlatformOSFileType.Page);

      expect(before?.entries.get('slug')?.jsValue).toEqual('before');
      expect(after?.entries.get('slug')?.jsValue).toEqual('after');
      expect(after).not.toBe(before);
    });

    it('caches the ABSENCE of a block, so a file without frontmatter is not re-scanned', () => {
      const file = page('<p>no frontmatter</p>');

      expect(frontmatterBlock(file, PlatformOSFileType.Page)).toBeUndefined();
      expect(frontmatterBlock(file, PlatformOSFileType.Page)).toBeUndefined();
    });
  });
});
