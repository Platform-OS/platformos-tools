import { expect, describe, it, vi, beforeEach } from 'vitest';
import { Minimatch } from 'minimatch';
import { hasIgnorePatterns, isIgnored } from './ignore';
import { UriString, CheckDefinition, Config, SourceCodeType } from './types';

vi.mock('minimatch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('minimatch')>();
  return {
    ...actual,
    Minimatch: vi.fn(function (pattern: string) {
      return new actual.Minimatch(pattern);
    }),
  };
});

const checkDef: CheckDefinition = {
  meta: {
    name: 'Mock Check',
    code: 'MockCheck',
    severity: 0,
    type: SourceCodeType.LiquidHtml,
    docs: {
      description: 'Mock check for testing',
    },
    schema: {},
    targets: [],
  },
  create: () => ({}),
};

describe('Function: isIgnored', () => {
  beforeEach(() => {
    vi.mocked(Minimatch).mockClear();
  });

  it('should return false when no ignore patterns are provided', () => {
    const result = isIgnored(
      toUri('app/views/partials/foo.liquid'),
      config({
        checkIgnore: [],
        globalIgnore: [],
      }),
      checkDef,
    );
    expect(result).toBe(false);
  });

  it('should return true when the file matches a base ignore pattern', () => {
    const result = isIgnored(
      toUri('app/views/partials/foo.liquid'),
      config({
        checkIgnore: ['*.liquid'],
        globalIgnore: [],
      }),
      checkDef,
    );

    expect(result).toBe(true);
  });

  it('should return false when the file does not matches a negative pattern', () => {
    const result = isIgnored(
      toUri('app/views/partials/foo.liquid'),
      config({
        checkIgnore: ['!other-dir/*'],
        globalIgnore: [],
      }),
      checkDef,
    );

    expect(result).toBe(false);
  });

  it('should return true when the file matches an ignore pattern', () => {
    const result = isIgnored(
      toUri('app/views/partials/foo.liquid'),
      config({
        checkIgnore: ['app/views/partials/*.liquid'],
        globalIgnore: [],
      }),
      checkDef,
    );

    expect(result).toBe(true);
  });

  it('should return false when the file does not match any ignore patterns', () => {
    const result = isIgnored(
      toUri('app/views/partials/foo.liquid'),
      config({
        checkIgnore: ['other-dir/*.liquid'],
        globalIgnore: [],
      }),
      checkDef,
    );

    expect(result).toBe(false);
  });

  it('should return true when the file matches a global ignore pattern', () => {
    const result = isIgnored(
      toUri('app/views/partials/foo.liquid'),
      config({
        checkIgnore: [],
        globalIgnore: ['app/views/partials/*.liquid'],
      }),
      checkDef,
    );

    expect(result).toBe(true);
  });

  it('should return true when the file matches both check-specific and global ignore patterns', () => {
    const result = isIgnored(
      toUri('app/views/partials/foo.liquid'),
      config({
        checkIgnore: ['app/views/partials/*.liquid'],
        globalIgnore: ['app/views/partials/*.liquid'],
      }),
      checkDef,
    );

    expect(result).toBe(true);
  });

  it('should return true when the file partially matches an ignore pattern', () => {
    const result = isIgnored(
      toUri('node_modules/some-library/foo.liquid'),
      config({
        checkIgnore: ['node_modules/*'],
        globalIgnore: [],
      }),
      checkDef,
    );

    expect(result).toBe(true);
  });

  it('should return true when the file partially matches a non-root ignore pattern', () => {
    const result = isIgnored(
      toUri('some-library/node_modules/foo.liquid'),
      config({
        // any kind of node_modules are ignored
        checkIgnore: ['node_modules/*'],
        globalIgnore: [],
      }),
      checkDef,
    );

    expect(result).toBe(true);
  });

  it('should return true when the file matches a non-root /** pattern', () => {
    const result = isIgnored(
      toUri('some-library/node_modules/foo.liquid'),
      config({
        // any kind of node_modules are ignored
        checkIgnore: ['node_modules/**'],
        globalIgnore: [],
      }),
      checkDef,
    );

    expect(result).toBe(true);
  });

  it('should return false when the file partially matches a root ignore pattern', () => {
    const result = isIgnored(
      toUri('some-library/node_modules/foo.liquid'),
      config({
        // only /root/node_modules/* is ignored, other ones aren't
        checkIgnore: ['/node_modules/*'],
        globalIgnore: [],
      }),
      checkDef,
    );

    expect(result).toBe(false);
  });

  it('should work with only global ignore as well', () => {
    const result = isIgnored(
      toUri('app/views/layouts/layout.liquid'),
      config({
        checkIgnore: [],
        globalIgnore: ['app/views/layouts/layout.liquid'],
      }),
    );

    expect(result).toBe(true);
  });

  it('should compile each pattern exactly once per config, however many paths it is asked about', () => {
    const sharedConfig = config({
      checkIgnore: ['app/views/partials/*.liquid'],
      globalIgnore: ['modules/common-styling/**'],
    });

    const results = Array.from({ length: 50 }, (_, i) =>
      isIgnored(toUri(`app/views/pages/page-${i}.liquid`), sharedConfig, checkDef),
    );

    expect(results).toEqual(Array.from({ length: 50 }, () => false));
    // Global patterns are consulted first, so they are the first thing compiled.
    expect(vi.mocked(Minimatch).mock.calls).toEqual([
      ['**/modules/common-styling/**'],
      ['**/app/views/partials/*.liquid'],
    ]);
  });

  // A third entry here means the global list has been folded back into a per-check set, and
  // so is compiled and matched once per check.
  it('should compile the global patterns once and the per-check patterns once', () => {
    const sharedConfig = config({
      checkIgnore: ['app/views/partials/*.liquid'],
      globalIgnore: ['modules/common-styling/**'],
    });

    const results = [
      isIgnored(toUri('app/views/partials/foo.liquid'), sharedConfig),
      isIgnored(toUri('app/views/partials/foo.liquid'), sharedConfig, checkDef),
      isIgnored(toUri('app/views/partials/foo.liquid'), sharedConfig),
      isIgnored(toUri('app/views/partials/foo.liquid'), sharedConfig, checkDef),
    ];

    expect(results).toEqual([false, true, false, true]);
    expect(vi.mocked(Minimatch).mock.calls).toEqual([
      ['**/modules/common-styling/**'],
      ['**/app/views/partials/*.liquid'],
    ]);
  });

  // The per-file memo must not mask a pattern only ONE check configures. The `false` in the
  // expectation is the control: a memo wide enough to answer for every check passes the rest.
  it('should serve one global verdict per file while keeping per-check answers distinct', () => {
    const otherCheckDef: CheckDefinition = {
      ...checkDef,
      meta: { ...checkDef.meta, code: 'OtherCheck' },
    };
    const sharedConfig: Config = {
      settings: {
        MockCheck: { enabled: true, ignore: ['app/views/partials/*.liquid'] },
        OtherCheck: { enabled: true, ignore: [] },
      },
      checks: [],
      rootUri: 'file:/path/to',
      ignore: ['modules/common-styling/**'],
    };

    const partial = toUri('app/views/partials/foo.liquid');
    const vendored = toUri('modules/common-styling/foo.liquid');

    expect([
      isIgnored(partial, sharedConfig, checkDef),
      isIgnored(partial, sharedConfig, otherCheckDef),
      isIgnored(vendored, sharedConfig, checkDef),
      isIgnored(vendored, sharedConfig, otherCheckDef),
    ]).toEqual([true, false, true, true]);
  });

  it('should compile a different config on its own', () => {
    const first = config({ checkIgnore: [], globalIgnore: ['app/views/pages/**'] });
    const second = config({ checkIgnore: [], globalIgnore: ['app/views/layouts/**'] });

    const results = [
      isIgnored(toUri('app/views/pages/index.liquid'), first),
      isIgnored(toUri('app/views/pages/index.liquid'), second),
    ];

    expect(results).toEqual([true, false]);
    expect(vi.mocked(Minimatch).mock.calls).toEqual([
      ['**/app/views/pages/**'],
      ['**/app/views/layouts/**'],
    ]);
  });

  /**
   * A pattern is rewritten against the config's ROOT, so the same pattern text under two
   * different roots is two different matchers. Trivially true while matchers are keyed on
   * the config object; asserted anyway because it is the trap any future pattern-keyed
   * cache falls into — an absolute pattern's compiled form embeds the root, so keying on
   * the pattern TEXT alone would serve project-a's matcher to project-b.
   */
  it('should not reuse an absolute pattern across two roots', () => {
    const under = (rootUri: string, subjectRoot: string): boolean =>
      isIgnored(`${subjectRoot}/app/views/x.liquid`, {
        settings: {},
        checks: [],
        rootUri,
        ignore: ['/app/views/**'],
      });

    // Anchored at its own root, the pattern matches.
    expect(under('file:///project-a', 'file:///project-a')).toBe(true);
    expect(under('file:///project-b', 'file:///project-b')).toBe(true);
    // Anchored at project-b, a project-a path is outside the pattern entirely.
    expect(under('file:///project-b', 'file:///project-a')).toBe(false);
  });

  /**
   * The correctness half of "a different config compiles on its own": editing
   * `.platformos-check.yml` changes the VERDICT for a file that did not itself change,
   * in both directions. A cache that keyed too coarsely would serve the stale answer,
   * and going back again is what catches a cache that only ever moves forward.
   */
  it('should follow a changed ignore list in both directions', () => {
    const withIgnore = (globalIgnore: string[]): Config => ({
      settings: {},
      checks: [],
      rootUri: 'file:/path/to',
      ignore: globalIgnore,
    });
    const subject = toUri('app/views/pages/secret.liquid');

    expect(isIgnored(subject, withIgnore(['other/**']))).toBe(false);
    expect(isIgnored(subject, withIgnore(['app/views/pages/**']))).toBe(true);
    expect(isIgnored(subject, withIgnore(['other/**']))).toBe(false);
  });

  /**
   * Nothing to match against means nothing to COMPILE — the premise
   * {@link hasIgnorePatterns} exists to exploit, since most projects configure no
   * `ignore` at all and check-node otherwise converts every project URI to a filesystem
   * path just to be told so.
   */
  it('should compile nothing, and report nothing to match, when there are no patterns', () => {
    const empty = config({ checkIgnore: [], globalIgnore: [] });

    expect(isIgnored(toUri('app/views/pages/index.liquid'), empty)).toBe(false);
    expect(vi.mocked(Minimatch).mock.calls).toEqual([]);
    expect(hasIgnorePatterns(empty)).toBe(false);
    expect(hasIgnorePatterns(empty, checkDef)).toBe(false);
  });

  it('should report there is something to match once a pattern is configured', () => {
    const globalOnly = config({ checkIgnore: [], globalIgnore: ['modules/vendor/**'] });
    const perCheckOnly = config({ checkIgnore: ['app/views/partials/*.liquid'], globalIgnore: [] });

    // A per-check pattern is invisible to the check-less question, and that asymmetry is
    // the point: the caller that skips work must ask the same question it will act on.
    expect([hasIgnorePatterns(globalOnly), hasIgnorePatterns(globalOnly, checkDef)]).toEqual([
      true,
      true,
    ]);
    expect([hasIgnorePatterns(perCheckOnly), hasIgnorePatterns(perCheckOnly, checkDef)]).toEqual([
      false,
      true,
    ]);
  });

  /**
   * `isIgnored` canonicalizes its subject, so every spelling of one file gets one answer
   * — `file:///c%3A/project/x.liquid` and `c:/project/x.liquid` are otherwise different
   * strings. Including against an ABSOLUTE pattern, which is anchored on the normalized
   * root.
   */
  describe('subject canonicalization', () => {
    const windowsConfig: Config = {
      settings: {},
      checks: [],
      rootUri: 'file:///c:/project',
      ignore: ['/modules/vendor/*'],
    };

    const spellingsOfIgnored = [
      'file:///c:/project/modules/vendor/public/views/partials/x.liquid',
      'file:///c%3A/project/modules/vendor/public/views/partials/x.liquid',
      'c:/project/modules/vendor/public/views/partials/x.liquid',
      'C:\\project\\modules\\vendor\\public\\views\\partials\\x.liquid',
    ];

    const spellingsOfKept = [
      'file:///c:/project/app/views/partials/x.liquid',
      'file:///c%3A/project/app/views/partials/x.liquid',
      'c:/project/app/views/partials/x.liquid',
      'C:\\project\\app\\views\\partials\\x.liquid',
    ];

    it('answers the same for a URI, a percent-encoded URI, and a Windows drive path', () => {
      expect(spellingsOfIgnored.map((subject) => isIgnored(subject, windowsConfig))).toEqual([
        true,
        true,
        true,
        true,
      ]);
      expect(spellingsOfKept.map((subject) => isIgnored(subject, windowsConfig))).toEqual([
        false,
        false,
        false,
        false,
      ]);
    });

    it('answers the same for a POSIX filesystem path and its URI', () => {
      const posixConfig: Config = {
        settings: {},
        checks: [],
        rootUri: 'file:///home/dev/project',
        ignore: ['modules/vendor/**'],
      };

      expect(isIgnored('/home/dev/project/modules/vendor/lib/x.liquid', posixConfig)).toBe(true);
      expect(isIgnored('file:///home/dev/project/modules/vendor/lib/x.liquid', posixConfig)).toBe(
        true,
      );
      expect(isIgnored('/home/dev/project/app/lib/x.liquid', posixConfig)).toBe(false);
    });
  });
});

function toUri(relativePath: string): UriString {
  return `file:/path/to/${relativePath}`;
}

function config({
  checkIgnore,
  globalIgnore,
}: {
  checkIgnore?: string[];
  globalIgnore?: string[];
}): Config {
  return {
    settings: {
      MockCheck: {
        enabled: true,
        ignore: checkIgnore,
      },
    },
    checks: [],
    rootUri: 'file:/path/to',
    ignore: globalIgnore,
  };
}
