import { describe, expect, it } from 'vitest';
import { AbstractFileSystem } from '../AbstractFileSystem';
import { createAppFile } from '../app';
import { PlatformOSFileType } from '../path-utils';
import { extractFrontmatterBlock, frontmatterBlock } from './extract';

describe('extractFrontmatterBlock', () => {
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
        (source) => extractFrontmatterBlock(source, PlatformOSFileType.Page) !== undefined,
      ),
    ).toEqual([]);
  });

  it('has no block for a file type that declares no frontmatter schema', () => {
    // The block is well formed; it is the TYPE that has no schema, so nothing reads it.
    const source = '---\nslug: x\n---\n';

    expect(extractFrontmatterBlock(source, undefined)).toBeUndefined();
  });

  it('reads keys and values with offsets into the .liquid file, not the YAML body', () => {
    const source = '---\nslug: notes\n---\n<p>hi</p>';
    const block = extractFrontmatterBlock(source, PlatformOSFileType.Page)!;
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
    const block = extractFrontmatterBlock(source, PlatformOSFileType.Page)!;
    const slug = block.entries.get('slug')!;

    expect(source.slice(slug.absStart, slug.absEnd)).toEqual('slug');
    expect(source.slice(block.frontmatterStart, block.frontmatterStart + 3)).toEqual('---');
  });

  it('reads an empty frontmatter block as a block with no entries', () => {
    // Distinct from "no block at all": a required-field rule must see this and fire.
    const block = extractFrontmatterBlock('---\n---\n', PlatformOSFileType.Page);

    expect(block && [...block.entries.keys()]).toEqual([]);
  });

  it('carries a non-scalar value as undefined while keeping the key addressable', () => {
    const source = '---\nauthorization_policies:\n  - require_login\n---\n';
    const block = extractFrontmatterBlock(source, PlatformOSFileType.Page)!;
    const entry = block.entries.get('authorization_policies')!;

    // The sequence is reachable through `doc`; `jsValue` is undefined because it is not a
    // scalar, which is exactly the case that used to render as the string "undefined".
    expect(entry.jsValue).toBeUndefined();
    expect(source.slice(entry.absStart, entry.absEnd)).toEqual('authorization_policies');
  });

  it('keeps a partial map when the YAML is malformed, and records the errors', () => {
    // parseDocument is lenient on purpose: the valid pairs still get checked. The errors
    // are what a frontmatter-syntax rule reports.
    const block = extractFrontmatterBlock(
      '---\nslug: notes\nlayout: [unclosed\n---\n',
      PlatformOSFileType.Page,
    )!;

    expect(block.entries.get('slug')?.jsValue).toEqual('notes');
    expect(block.doc.errors.length > 0).toBe(true);
  });

  /**
   * MEASURED against the instance: a page declaring `slug` twice syncs without error, the
   * first slug 404s and the second serves. The platform parses frontmatter with Psych, which
   * has no uniqueness rule at all, so this is legal input and the block is well formed.
   */
  it('treats a repeated key as legal input, resolving it last-wins', () => {
    const block = extractFrontmatterBlock('---\nslug: a\nslug: b\n---\n', PlatformOSFileType.Page)!;

    expect({
      syntaxErrors: block.syntaxErrors,
      slug: block.entries.get('slug')!.jsValue,
    }).toEqual({ syntaxErrors: [], slug: 'b' });
  });

  /**
   * CONTROL for the above: genuinely unparseable YAML must still be reported, or the option
   * that makes a duplicate legal could equally have disabled error reporting altogether.
   */
  it('still records a syntax error for YAML that genuinely does not parse', () => {
    const block = extractFrontmatterBlock(
      '---\nslug: notes\nlayout: [unclosed\n---\n',
      PlatformOSFileType.Page,
    )!;

    expect(block.syntaxErrors.length).toEqual(1);
  });

  /**
   * The pretty form appends the offending line and a caret diagram to `error.message`, and
   * that message is reported verbatim as an offense. A user saw the diagram in their editor.
   */
  it('records a syntax error as a single line, with no source excerpt or caret diagram', () => {
    const block = extractFrontmatterBlock(
      '---\nslug: notes\nlayout: [unclosed\n---\n',
      PlatformOSFileType.Page,
    )!;

    expect(block.syntaxErrors.map((error) => error.message)).toEqual([
      'Flow sequence in block collection must be sufficiently indented and end with a ]',
    ]);
  });

  /**
   * THE SAME BLOCK IN THREE LINE-ENDING SPELLINGS, and every entry checked rather than the
   * first — the drift this pins only appears from the SECOND entry onwards, so a fixture
   * with one key passes with the bug fully present.
   *
   * `layout` is deliberately last: `yamlBody` ends at the `\n` before the closing fence, so
   * on a CRLF file its final byte is a lone `\r` that rides into the last value unless it is
   * normalized.
   */
  describe.each([
    ['LF', '---\nslug: notes\nlayout: app\nmax_deep_level: 3\n---\n<p>hi</p>'],
    ['CRLF', '---\r\nslug: notes\r\nlayout: app\r\nmax_deep_level: 3\r\n---\r\n<p>hi</p>'],
    // A paste artefact, not an exotic encoding: one stray CR in an otherwise LF file.
    // Measured against the platform's own regex and Psych — it reads three keys here.
    ['LF with a stray CR', '---\nslug: notes\rlayout: app\nmax_deep_level: 3\n---\n<p>hi</p>'],
  ])('line endings: %s', (_label, source) => {
    it('slices every key and every value back out of the ORIGINAL source', () => {
      const block = extractFrontmatterBlock(source, PlatformOSFileType.Page)!;

      expect(
        [...block.entries].map(([key, entry]) => ({
          key: source.slice(entry.absStart, entry.absEnd),
          declared: key,
          value: source.slice(entry.valueAbsStart, entry.valueAbsEnd),
        })),
      ).toEqual([
        { key: 'slug', declared: 'slug', value: 'notes' },
        { key: 'layout', declared: 'layout', value: 'app' },
        { key: 'max_deep_level', declared: 'max_deep_level', value: '3' },
      ]);
    });

    it('parses cleanly, with no value carrying a stray carriage return', () => {
      const block = extractFrontmatterBlock(source, PlatformOSFileType.Page)!;

      expect({
        syntaxErrors: block.syntaxErrors,
        values: [...block.entries].map(([, entry]) => entry.jsValue),
        fence: source.slice(block.frontmatterStart, block.frontmatterStart + 3),
      }).toEqual({
        syntaxErrors: [],
        values: ['notes', 'app', 3],
        fence: '---',
      });
    });
  });

  /**
   * A file whose every line ends with a bare CR has NO frontmatter, and that is agreement
   * with the platform rather than a gap. Its `LIQUID_CONFIG_REGEX` closes the block on
   * `\n\s*---`, so with no `\n` anywhere it does not match and the whole file becomes body —
   * measured by running that regex against these exact bytes.
   *
   * Pinned because our side arrives at the same answer incidentally, by finding no `\n` to
   * scan for. Someone "fixing" the scan to understand CR would silently start reading
   * frontmatter the platform never reads.
   */
  it('finds no block in a file whose lines all end with a bare CR, as the platform finds none', () => {
    const source = '---\rslug: notes\rlayout: app\r---\r<p>hi</p>';

    expect(extractFrontmatterBlock(source, PlatformOSFileType.Page)).toBeUndefined();
    // The control: the identical block in LF spelling IS read, so the silence above is
    // caused by the line endings and not by the fixture being unreadable for some other
    // reason.
    expect(
      extractFrontmatterBlock(source.replace(/\r/g, '\n'), PlatformOSFileType.Page),
    ).toBeDefined();
  });
});

const ROOT = 'file:///project';

/** An `fs` that must never be reached: every file below is given its source directly. */
const explodingFs: AbstractFileSystem = {
  readFile: () => {
    throw new Error('readFile should not be called');
  },
  stat: () => {
    throw new Error('stat should not be called');
  },
  readDirectory: () => {
    throw new Error('readDirectory should not be called');
  },
};

const pageFile = (source: string, name = 'notes') => {
  const file = createAppFile(`${ROOT}/app/views/pages/${name}.html.liquid`, ROOT, explodingFs)!;
  file.setSource(source);
  return file;
};

/**
 * The memo exists because `parseDocument` costs ~80 µs and six checks read one block —
 * ~640 ms of redundant parsing over a 2 000-page project. A cache that never hits would be
 * invisible without this test, and a cache that never INVALIDATES would serve the language
 * server a stale block after every keystroke.
 */
describe('frontmatterBlock memoisation', () => {
  it('parses one file once, and different files separately', () => {
    const fileA = pageFile('---\nslug: a\n---\n', 'a');
    const fileB = pageFile('---\nslug: b\n---\n', 'b');

    expect(frontmatterBlock(fileA, PlatformOSFileType.Page)).toBe(
      frontmatterBlock(fileA, PlatformOSFileType.Page),
    );
    expect(frontmatterBlock(fileA, PlatformOSFileType.Page)).not.toBe(
      frontmatterBlock(fileB, PlatformOSFileType.Page),
    );
  });

  it('re-parses when the file is given new source', () => {
    const file = pageFile('---\nslug: before\n---\n');
    const before = frontmatterBlock(file, PlatformOSFileType.Page);

    file.setSource('---\nslug: after\n---\n');
    const after = frontmatterBlock(file, PlatformOSFileType.Page);

    expect(before?.entries.get('slug')?.jsValue).toEqual('before');
    expect(after?.entries.get('slug')?.jsValue).toEqual('after');
    expect(after).not.toBe(before);
  });

  it('caches the ABSENCE of a block, so a file without frontmatter is not re-scanned', () => {
    const file = pageFile('<p>no frontmatter</p>');

    expect(frontmatterBlock(file, PlatformOSFileType.Page)).toBeUndefined();
    expect(frontmatterBlock(file, PlatformOSFileType.Page)).toBeUndefined();
  });

  /**
   * The key carries `fileType`, so two callers disagreeing about a file's type get two
   * answers rather than whichever asked first. Without it this passes only by accident —
   * `Page` has a schema and `undefined` has none, so the second call would return the
   * first's block and the assertion below would read `defined`.
   */
  it('does not serve one file type the answer computed for another', () => {
    const file = pageFile('---\nslug: notes\n---\n');

    expect(frontmatterBlock(file, PlatformOSFileType.Page)).toBeDefined();
    expect(frontmatterBlock(file, undefined)).toBeUndefined();
  });
});
