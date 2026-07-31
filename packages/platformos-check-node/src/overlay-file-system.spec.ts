import { describe, expect, it } from 'vitest';

import { FileType, type AbstractFileSystem } from '@platformos/platformos-common';

import { overlayFileSystem } from './overlay-file-system';

/**
 * `overlayFileSystem` is what makes a batch's unsaved buffers VISIBLE to the
 * reference checks. They resolve names through `context.fs.stat`, not through the
 * `App`, so overlaying the App alone left a partial that exists only as a buffer
 * being reported missing (see `lint-buffers.spec.ts`).
 *
 * Its contract is deliberately narrow: it ADDS and SHADOWS files, never hides them.
 */
const ROOT = 'file:///project';
const PARTIALS = `${ROOT}/app/views/partials`;

/** A fake base filesystem with an explicit, inspectable file set. */
const baseWith = (files: Record<string, string>): AbstractFileSystem => ({
  async readFile(uri) {
    const content = files[uri];
    if (content === undefined) throw new Error(`ENOENT ${uri}`);
    return content;
  },
  async stat(uri) {
    const content = files[uri];
    if (content === undefined) throw new Error(`ENOENT ${uri}`);
    return { type: FileType.File, size: Buffer.byteLength(content, 'utf8') };
  },
  async readDirectory(uri) {
    const prefix = `${uri}/`;
    const entries = Object.keys(files).filter((file) => file.startsWith(prefix));
    if (entries.length === 0) throw new Error(`ENOTDIR ${uri}`);
    return entries.map((file) => [file, FileType.File] as [string, FileType]);
  },
});

describe('Unit: overlayFileSystem', () => {
  it('returns the base filesystem UNCHANGED when there are no overlays', () => {
    // Identity, not a wrapper: every single-file lint with no overlay must pay
    // nothing at all for this feature.
    const base = baseWith({});

    expect(overlayFileSystem(base, new Map())).toBe(base);
  });

  describe('a buffered file that does not exist on disk', () => {
    const fs = () =>
      overlayFileSystem(baseWith({}), new Map([[`${PARTIALS}/promo.liquid`, '<div>promo</div>']]));

    it('stats as an existing FILE — the whole point', async () => {
      // This is what `DocumentsLocator` asks, and what used to throw.
      expect(await fs().stat(`${PARTIALS}/promo.liquid`)).toEqual({
        type: FileType.File,
        size: 16,
      });
    });

    it('reads back the buffer content', async () => {
      expect(await fs().readFile(`${PARTIALS}/promo.liquid`)).toEqual('<div>promo</div>');
    });

    it('reports its size in BYTES, not characters', async () => {
      // '€' is 3 bytes. A char-length size would misreport it, and `fileSize`
      // is a check-visible value.
      const withMultibyte = overlayFileSystem(
        baseWith({}),
        new Map([[`${PARTIALS}/euro.liquid`, '€€€']]),
      );

      expect((await withMultibyte.stat(`${PARTIALS}/euro.liquid`)).size).toEqual(9);
    });

    it('appears in its directory listing even though the directory is empty on disk', async () => {
      expect(await fs().readDirectory(PARTIALS)).toEqual([
        [`${PARTIALS}/promo.liquid`, FileType.File],
      ]);
    });
  });

  describe('shadowing a file that DOES exist on disk', () => {
    const fs = () =>
      overlayFileSystem(
        baseWith({ [`${PARTIALS}/card.liquid`]: '<div>on disk</div>' }),
        new Map([[`${PARTIALS}/card.liquid`, '<div>unsaved edit</div>']]),
      );

    it('reads the BUFFER, not the disk copy — the unsaved edit is what is validated', async () => {
      expect(await fs().readFile(`${PARTIALS}/card.liquid`)).toEqual('<div>unsaved edit</div>');
    });

    it('stats the buffer’s size, not the disk file’s', async () => {
      expect((await fs().stat(`${PARTIALS}/card.liquid`)).size).toEqual(23);
    });

    it('does not duplicate the shadowed file in the directory listing', async () => {
      // A naive merge would list it twice, once from disk and once from the overlay.
      expect(await fs().readDirectory(PARTIALS)).toEqual([
        [`${PARTIALS}/card.liquid`, FileType.File],
      ]);
    });
  });

  describe('falls through for anything not buffered', () => {
    const fs = () =>
      overlayFileSystem(
        baseWith({ [`${PARTIALS}/card.liquid`]: '<div>card</div>' }),
        new Map([[`${PARTIALS}/promo.liquid`, '<div>promo</div>']]),
      );

    it('reads a disk-only file from disk', async () => {
      expect(await fs().readFile(`${PARTIALS}/card.liquid`)).toEqual('<div>card</div>');
    });

    it('still THROWS for a file that exists in neither — it never hides absence', async () => {
      // Load-bearing: if this swallowed the error, `MissingPartial` would stop
      // firing for genuinely missing partials.
      await expect(fs().stat(`${PARTIALS}/ghost.liquid`)).rejects.toThrow();
      await expect(fs().readFile(`${PARTIALS}/ghost.liquid`)).rejects.toThrow();
    });

    it('lists both the disk file and the buffered one', async () => {
      expect((await fs().readDirectory(PARTIALS)).map(([uri]) => uri).sort()).toEqual([
        `${PARTIALS}/card.liquid`,
        `${PARTIALS}/promo.liquid`,
      ]);
    });
  });

  describe('directory listings', () => {
    it('lists DIRECT children only, never files from nested directories', async () => {
      // A listing that surfaced nested files as if they sat here would make
      // completion and search-path logic wrong.
      const fs = overlayFileSystem(
        baseWith({}),
        new Map([
          [`${PARTIALS}/promo.liquid`, 'a'],
          [`${PARTIALS}/nested/deep.liquid`, 'b'],
        ]),
      );

      expect(await fs.readDirectory(PARTIALS)).toEqual([
        [`${PARTIALS}/promo.liquid`, FileType.File],
      ]);
    });

    it('lists a nested buffered file when its OWN directory is listed', async () => {
      const fs = overlayFileSystem(
        baseWith({}),
        new Map([[`${PARTIALS}/nested/deep.liquid`, 'b']]),
      );

      expect(await fs.readDirectory(`${PARTIALS}/nested`)).toEqual([
        [`${PARTIALS}/nested/deep.liquid`, FileType.File],
      ]);
    });

    it('returns an empty listing, not a throw, for a directory with neither disk nor buffered files', async () => {
      // The base throws ENOTDIR here; swallowing it is what lets a brand-new
      // directory be listed at all. Empty is the honest answer.
      const fs = overlayFileSystem(baseWith({}), new Map([[`${PARTIALS}/promo.liquid`, 'a']]));

      expect(await fs.readDirectory(`${ROOT}/app/views/layouts`)).toEqual([]);
    });

    it('preserves the disk listing unchanged when no buffer belongs to that directory', async () => {
      const fs = overlayFileSystem(
        baseWith({ [`${ROOT}/app/views/pages/home.liquid`]: 'x' }),
        new Map([[`${PARTIALS}/promo.liquid`, 'a']]),
      );

      expect(await fs.readDirectory(`${ROOT}/app/views/pages`)).toEqual([
        [`${ROOT}/app/views/pages/home.liquid`, FileType.File],
      ]);
    });
  });

  it('matches on the NORMALIZED uri, so a differently-spelled path still hits', async () => {
    // `DocumentsLocator` builds candidate paths by joining, which can produce a
    // form that differs from the key the caller stored. Comparing normalized
    // forms is what keeps the two in agreement.
    const fs = overlayFileSystem(
      baseWith({}),
      new Map([[`${PARTIALS}/promo.liquid`, '<div>promo</div>']]),
    );

    expect(await fs.readFile(`${ROOT}/app/views/partials/promo.liquid`)).toEqual(
      '<div>promo</div>',
    );
  });

  it('serves an EMPTY buffer as an existing empty file, not as absent', async () => {
    // `''` is falsy — a truthiness check would fall through to disk and report
    // the file missing, which is exactly wrong for a newly created empty file.
    const fs = overlayFileSystem(baseWith({}), new Map([[`${PARTIALS}/blank.liquid`, '']]));

    expect(await fs.readFile(`${PARTIALS}/blank.liquid`)).toEqual('');
    expect(await fs.stat(`${PARTIALS}/blank.liquid`)).toEqual({ type: FileType.File, size: 0 });
  });
});
