import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { isObjectInScope, ObjectAccess } from './object-scope';
import { relativePosixPath } from './os-path';
import { PlatformOSFileType } from './path-utils';

/**
 * The real `access` shapes from the platformOS Liquid docset. All four are `global: true`,
 * and only `context` is in scope inside a partial — which is the whole point of the rule.
 */
const CONTEXT: ObjectAccess = {
  global: true,
  parents: [],
  template: [],
  app_file_type: null,
};
const DATA: ObjectAccess = {
  global: true,
  parents: [],
  template: [],
  app_file_type: 'api_call',
};
const FORLOOP: ObjectAccess = {
  global: true,
  parents: [{ object: 'forloop', property: 'parentloop' }],
  template: [],
};
/** `params` and friends: reached as `context.params`, never bare. */
const NOT_GLOBAL: ObjectAccess = { global: false, parents: [], template: [] };

describe('isObjectInScope', () => {
  it('treats a global object with no file-type restriction as in scope anywhere', () => {
    expect(isObjectInScope(CONTEXT, PlatformOSFileType.Partial)).toBe(true);
    expect(isObjectInScope(CONTEXT, PlatformOSFileType.ApiCall)).toBe(true);
    expect(isObjectInScope(CONTEXT, undefined)).toBe(true);
  });

  it('confines an app_file_type object to that file type', () => {
    expect(isObjectInScope(DATA, PlatformOSFileType.ApiCall)).toBe(true);
    expect(isObjectInScope(DATA, PlatformOSFileType.Partial)).toBe(false);
    expect(isObjectInScope(DATA, PlatformOSFileType.Page)).toBe(false);
    expect(isObjectInScope(DATA, PlatformOSFileType.Layout)).toBe(false);
  });

  it('does not put an app_file_type object in scope for an unclassified file', () => {
    expect(isObjectInScope(DATA, undefined)).toBe(false);
  });

  it('never treats a parented object as a file-level global', () => {
    expect(isObjectInScope(FORLOOP, PlatformOSFileType.Partial)).toBe(false);
    expect(isObjectInScope(FORLOOP, PlatformOSFileType.Page)).toBe(false);
  });

  it('treats a non-global object as out of scope, since it is reached through its parent', () => {
    expect(isObjectInScope(NOT_GLOBAL, PlatformOSFileType.Partial)).toBe(false);
  });

  it('treats a missing access block as in scope, since the docset says nothing', () => {
    expect(isObjectInScope(undefined, PlatformOSFileType.Partial)).toBe(true);
  });

  it('stays permissive for an app_file_type it has never heard of', () => {
    // A docset naming a file type this version does not know is not evidence about scope,
    // and must not become a false positive.
    const unknown: ObjectAccess = {
      global: true,
      parents: [],
      template: [],
      app_file_type: 'some_future_file_type',
    };

    expect(isObjectInScope(unknown, PlatformOSFileType.Partial)).toBe(true);
  });

  it('ignores Shopify-era template scoping, which platformOS leaves empty', () => {
    // `template` used to widen scope: a non-global object naming a template was in scope there.
    // platformOS publishes `template: []` for all 25 of its objects, so the clause could only ever
    // fire on data the platform does not emit — and the fixture that exercised it invented a
    // `item` object to do so. `global` is the whole rule now, and this pins that.
    const templateScoped: ObjectAccess = {
      global: false,
      parents: [],
      template: ['some_template'],
    };

    expect(isObjectInScope(templateScoped, PlatformOSFileType.Partial)).toBe(false);
  });
});

/**
 * The rule above has ONE implementation, and this is what keeps a second from appearing.
 *
 * There already was one. The language server's `TypeSystem.globalVariables` asked
 * `!access || access.global === true` while `UndefinedObject` asked this function, and the two
 * disagreed on four of the twenty-five shipped objects: the editor completed `data`, `response`,
 * `content_for_layout` and `forloop` in files where the platform does not provide them, and the
 * linter then reported `Unknown object` on the code the editor had just written. Nobody found it
 * for a release, because a hand-written predicate has no way to look wrong.
 *
 * Every workspace package's `src/` is scanned, specs included — the same discipline as
 * `os-path.spec.ts` and `guards/directory-knowledge.spec.ts`. Comment lines are skipped, so prose
 * ABOUT the mistake (this file, `TypeSystem`'s doc comment) costs nothing; only code counts.
 */
describe('object scope has one owner', () => {
  const packagesDir = join(__dirname, '..', '..');

  /** Modules that legitimately read `access.global` in code. */
  const OWNERS = new Set([
    // The rule itself, and this file, whose controls quote the pattern.
    'platformos-common/src/object-scope.ts',
    'platformos-common/src/object-scope.spec.ts',
    // A DIFFERENT question, and the reason it is named rather than pattern-matched away:
    // `liquidDrops` asks "is this a type reached through a parent", the complement used for
    // property completion. It takes no file type and answers nothing about where a name is
    // readable. Widening it into a scope decision is exactly the drift this guard exists for.
    'platformos-check-common/src/AugmentedPlatformOSDocset.ts',
  ]);

  /** Reading the field is the tell: a scope decision made from `global` alone. */
  const PATTERN = /\baccess\s*(\?\.|\.)\s*global\b/;

  it('is never re-implemented in another module', async () => {
    const offenders: string[] = [];

    for (const dir of await workspacePackages(packagesDir)) {
      for (const file of await sourceFiles(join(dir, 'src'))) {
        const relative = relativePosixPath(file, packagesDir);
        if (OWNERS.has(relative)) continue;
        if (PATTERN.test(code(await readFile(file, 'utf8')))) {
          offenders.push(`${relative}: reads access.global directly (use isObjectInScope)`);
        }
      }
    }

    expect(offenders.sort()).toEqual([]);
  });

  it('CONTROL: the scanner finds the pattern in the module that owns it', async () => {
    // Without this, an offenders list that is empty because the scan reads nothing looks
    // identical to one that is empty because the rule holds.
    const owner = await readFile(
      join(packagesDir, 'platformos-common/src/object-scope.ts'),
      'utf8',
    );

    expect(PATTERN.test(code(owner))).toBe(true);
  });

  it('CONTROL: prose about access.global is not code', () => {
    expect(
      code(
        [' * `access.global` does NOT mean "available everywhere".', '  // access.global'].join(
          '\n',
        ),
      ),
    ).toBe('');
  });
});

/** The source with its comment LINES removed, so a doc comment cannot trip a code guard. */
function code(source: string): string {
  return source
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .join('\n')
    .trim();
}

async function workspacePackages(packagesDir: string): Promise<string[]> {
  const entries = await readdir(packagesDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(packagesDir, entry.name));
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
      return Promise.resolve(/\.(ts|tsx|js|mjs)$/.test(entry.name) ? [full] : []);
    }),
  );
  return nested.flat();
}
