import { expect, describe, it, vi, beforeEach } from 'vitest';
import { Minimatch } from 'minimatch';
import { isIgnored } from './ignore';
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
    expect(vi.mocked(Minimatch).mock.calls).toEqual([
      ['**/app/views/partials/*.liquid'],
      ['**/modules/common-styling/**'],
    ]);
  });

  it('should compile the check-less and the per-check pattern sets separately, each once', () => {
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
      ['**/modules/common-styling/**'],
    ]);
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
