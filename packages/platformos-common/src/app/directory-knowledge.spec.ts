import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FILE_TYPE_DIRS,
  PlatformOSFileType,
  SOURCE_FILE_EXTENSIONS,
  SOURCE_FILE_GLOB,
} from '../path-utils';

const packagesDir = join(__dirname, '..', '..', '..');

/** Packages exempt from both rules below, with the reason. */
const EXEMPT = new Set([
  // Owns the source of truth.
  'platformos-common',
  // A browser demo whose fixture project is literal example content, not logic.
  'codemirror-language-client',
  // Liquid grammar and printer; they never classify project files.
  'liquid-html-parser',
  'prettier-plugin-liquid',
]);

/**
 * `FILE_TYPE_DIRS` in this package is the single source of truth for the platformOS
 * directory structure. This test keeps it that way.
 *
 * Every directory name it contains is a fact about the platform, mirrored from the
 * server's `converters_config.rb`. A second copy of one somewhere else is not just
 * duplication: it is a rule that can silently disagree — the whole class of bug the
 * App model was built to stop. `app/lib/smses/x.liquid` being a Partial rather than
 * an Sms, `app/modules/X` shadowing `modules/X`, `views/partials` beating `lib` —
 * these only hold if exactly one place decides them.
 *
 * So: no other package may spell a platformOS directory name in code. Use
 * `getFileType`, `parseAppPath`, `isPartial`/`isPage`/…, `getAppPaths`,
 * `getModulePaths`, `getTranslationBase`, or `App.find` instead. If you need
 * something they do not offer, add it HERE.
 */
describe('platformOS directory knowledge lives only in platformos-common', () => {
  /**
   * The directory names this test polices: the multi-segment ones from
   * `FILE_TYPE_DIRS`, plus `assets` and the legacy app root.
   *
   * `assets` is in the list because assets follow exactly the same placement rules as
   * every other file type — `app/assets/` or `modules/<name>/{public,private}/assets/`
   * — and a second copy of that rule is what let `platformos-graph` resolve
   * `{{ 'app.js' | asset_url }}` to a root-level `assets/app.js` the platform never
   * deploys from, while `DocumentsLocator` resolved the same reference to
   * `app/assets/app.js`.
   *
   * Deliberately NOT the other single-segment names (`lib`, `pages`, `graphql`,
   * `translations`, `forms`, `schema`, …). Those double as tag names, frontmatter keys
   * and GraphQL identifiers throughout the toolchain — `'graphql'` as a `DocumentType`,
   * `authorization_policies` as a frontmatter KEY — so matching them mechanically
   * produces noise, not findings.
   */
  const directoryNames = [
    ...new Set(
      Object.values(FILE_TYPE_DIRS)
        .flat()
        .filter((dir) => dir.includes('/')),
    ),
    ...FILE_TYPE_DIRS[PlatformOSFileType.Asset],
    'marketplace_builder',
  ];

  /**
   * The two ways a directory name gets spelled:
   *
   * 1. as a path fragment — a slash on at least one side, so a bare
   *    `'authorization_policies'` used as a frontmatter KEY does not count while
   *    `'app/authorization_policies'` does;
   * 2. segment by segment — `joinPath(root, 'app', 'views', 'layouts')`, which
   *    contains no slash at all and would otherwise slip straight through.
   */
  const spellings = (name: string) => {
    const escaped = name.replace(/\//g, '\\/');
    const segments = name.split('/').map((segment) => `['"\`]${segment}['"\`]`);
    return [
      // `(?<!\*)` exempts a `**/`-rooted glob (`'**/assets/*'` in a file watcher).
      // Such a pattern is root-AGNOSTIC by construction — it matches the directory
      // under every legal root — so it cannot disagree with the placement rule the
      // way a hardcoded `app/assets` can.
      new RegExp(`((?<!\\*)\\/${escaped}[\\/'"\`])|(['"\`]${escaped}\\/)`),
      new RegExp(segments.join(',\\s*')),
    ];
  };

  /**
   * Known remaining offenders. Empty — and it must stay that way: adding a
   * directory name to another package fails this test, which is the point.
   */
  const KNOWN: string[] = [];

  it('spells no platformOS directory name outside this package', async () => {
    const offenders = new Set<string>();

    for (const dir of await workspacePackages()) {
      const packageName = dir.slice(packagesDir.length + 1);
      if (EXEMPT.has(packageName)) continue;

      for (const file of await sourceFiles(join(dir, 'src'))) {
        if (file.endsWith('.spec.ts') || file.includes('/test/')) continue;

        const code = codeOf(await readFile(file, 'utf8'));
        if (directoryNames.some((name) => spellings(name).some((re) => re.test(code)))) {
          offenders.add(file.slice(packagesDir.length + 1));
        }
      }
    }

    expect([...offenders].sort()).toEqual([...KNOWN].sort());
  });

  it('is the only place that maps a translations directory name', () => {
    // Sanity check on the exported helper the translation checks now use, so they
    // have no reason to spell the directory themselves.
    expect(FILE_TYPE_DIRS[PlatformOSFileType.Translation]).toEqual(['translations']);
  });
});

/**
 * The second fact about a file this package owns: which EXTENSIONS are sources.
 *
 * `SOURCE_FILE_EXTENSIONS` (and `SOURCE_FILE_GLOB` / `sourceCodeTypeOf` derived from
 * it) is the single answer. A second copy drifts the same way a duplicated directory
 * name does, and it already had: the language server's file-operation filter was a
 * recursive glob of `{liquid,json,graphql}`, which listed `json` — never a platformOS
 * source — and omitted `yml`/`yaml`, so renaming a translation file never reached
 * `onDidRenameFiles` at all.
 *
 * The rule is deliberately LOOSER than the directory one: a single extension is
 * fine. `platformos-graph` legitimately restricts a traversal to `.liquid`, a check
 * legitimately builds a `${name}.liquid` candidate, and the server legitimately
 * special-cases `.platformos-check.yml`. What is not fine is a LIST — two or more
 * distinct source extensions in one file, which is always someone re-deriving "what
 * is a platformOS source file".
 */
describe('platformOS source-extension knowledge lives only in platformos-common', () => {
  const extensions = SOURCE_FILE_EXTENSIONS.map((extension) => extension.slice(1));

  /**
   * The two extension-SHAPED spellings:
   *
   * 1. a dotted extension ending a string, a template literal or a regex —
   *    `endsWith('.liquid')`, a glob ending `.yml'`, `` `${name}.graphql` ``,
   *    `/\.liquid$/`;
   * 2. a brace-expansion member — the `{liquid,yml,yaml,graphql}` of a glob.
   *
   * A bare quoted `'liquid'` is deliberately NOT one of them. `'liquid'` is also the
   * `{% liquid %}` tag name, `'graphql'` is a node kind and a VS Code language id,
   * `'yaml'` is an npm package — matching those produces noise, not findings, the
   * same reason the directory rule skips the single-segment names.
   *
   * `json` is not policed either, even though wrongly listing it is what the LSP
   * filter did: `.json` appears in every `package.json` / `tsconfig.json` reference
   * in the monorepo, so the pattern cannot tell a mistake from a build file.
   */
  const spellings = (extension: string) => [
    new RegExp(`\\.${extension}(?=['"\`$])`),
    new RegExp(`[{,]${extension}[,}]`),
  ];

  /**
   * Known remaining offenders. Empty, and worth keeping that way.
   *
   * `vscode-extension`'s `documentSelectors` was the last one. It pairs each glob with
   * a VS Code LANGUAGE ID, which is VS Code's fact rather than the platform's and does
   * not map one-to-one onto extensions — `yml` and `yaml` are both the `yaml` language
   * — so it looked underivable. It is not: it now maps over
   * `SOURCE_FILE_EXTENSIONS` and keeps only the id exceptions of its own. That drift is
   * not hypothetical, which is why the exemption is gone — while the list was written
   * out by hand it lost its `yaml` entry entirely, and no translation buffer ever
   * reached the language server (TASK-12.28).
   */
  const KNOWN: string[] = [];

  it('spells no list of source extensions outside this package', async () => {
    const offenders = new Set<string>();

    for (const dir of await workspacePackages()) {
      const packageName = dir.slice(packagesDir.length + 1);
      if (EXEMPT.has(packageName)) continue;

      for (const file of await sourceFiles(join(dir, 'src'))) {
        if (file.endsWith('.spec.ts') || file.includes('/test/')) continue;

        const code = codeOf(await readFile(file, 'utf8'));
        const spelled = extensions.filter((extension) =>
          spellings(extension).some((re) => re.test(code)),
        );
        if (spelled.length >= 2) offenders.add(file.slice(packagesDir.length + 1));
      }
    }

    expect([...offenders].sort()).toEqual([...KNOWN].sort());
  });

  it('derives the source glob from the extension list', () => {
    expect(SOURCE_FILE_GLOB).toEqual(`**/*.{${extensions.join(',')}}`);
  });
});

/** `source` with comment lines removed — a comment may name a directory freely. */
function codeOf(source: string): string {
  return source
    .split('\n')
    .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
    .join('\n');
}

async function workspacePackages(): Promise<string[]> {
  const entries = await readdir(packagesDir, { withFileTypes: true });
  const dirs = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const dir = join(packagesDir, entry.name);
        return (await exists(join(dir, 'src'))) ? [dir] : [];
      }),
  );
  return dirs.flat();
}

async function sourceFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const nested = await Promise.all(
    entries.map((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(full);
      return Promise.resolve(entry.name.endsWith('.ts') ? [full] : []);
    }),
  );
  return nested.flat();
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
