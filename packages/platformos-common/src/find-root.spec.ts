import { describe, expect, it } from 'vitest';
import {
  FileExists,
  findRoot,
  isDeclaredRoot,
  PROJECT_ROOT_MARKERS,
  resolveProjectRoot,
} from './find-root';

const ROOT = 'file:///project';

/**
 * The `fileExists` every real caller passes, over the given project tree.
 *
 * Built locally rather than from check-common's MockFileSystem — this module moved down to
 * platformos-common, which must not depend on the layer above it, and common's own specs
 * (RouteTable, DocumentsLocator) define their fixtures the same way.
 *
 * DIRECTORIES MUST REPORT AS EXISTING, which is the whole point of the fixture: findRoot asks
 * `fileExists(<dir>/app)` for a directory, never for a file inside it, so a mock that only knew
 * about files would find no root anywhere and make every test below vacuous.
 */
const fileExists = (files: Record<string, string>): FileExists => {
  const present = new Set<string>();
  for (const relativePath of Object.keys(files)) {
    const parts = relativePath.split('/');
    for (let i = 1; i <= parts.length; i++) {
      present.add(`${ROOT}/${parts.slice(0, i).join('/')}`);
    }
  }
  return async (uri: string) => present.has(uri);
};

describe('Unit: findRoot', () => {
  it('marks the directory containing app/ as the root', async () => {
    const exists = fileExists({ 'app/views/pages/index.liquid': '{{ content }}' });
    expect(await findRoot(`${ROOT}/app/views/pages/index.liquid`, exists)).toBe(ROOT);
  });

  it('marks the directory containing the legacy marketplace_builder/ as the root', async () => {
    // The legacy root is as live as `app/` (`deployable.rb:21`); without this a legacy
    // project with no `.pos` and no config resolved no root at all — no diagnostics,
    // no completions, and nothing to say why.
    const exists = fileExists({ 'marketplace_builder/views/pages/index.liquid': '{{ content }}' });
    expect(await findRoot(`${ROOT}/marketplace_builder/views/pages/index.liquid`, exists)).toBe(
      ROOT,
    );
  });

  it('marks the directory containing a .pos sentinel as the root', async () => {
    const exists = fileExists({ '.pos': 'sentinel', 'src/deep/file.liquid': '{{ content }}' });
    expect(await findRoot(`${ROOT}/src/deep/file.liquid`, exists)).toBe(ROOT);
  });

  it('marks the directory containing a .platformos-check.yml as the root', async () => {
    const exists = fileExists({
      '.platformos-check.yml': 'extends: nothing',
      'src/file.liquid': '{{ content }}',
    });
    expect(await findRoot(`${ROOT}/src/file.liquid`, exists)).toBe(ROOT);
  });

  it('marks the directory containing a top-level modules/ as the root', async () => {
    const exists = fileExists({ 'modules/community/public/lib/x.liquid': '{{ content }}' });
    expect(await findRoot(`${ROOT}/modules/community/public/lib/x.liquid`, exists)).toBe(ROOT);
  });

  it('does not mistake app/views/partials/modules/ for a root — modules/ only counts outside an app subtree', async () => {
    const exists = fileExists({ 'app/views/partials/modules/x.liquid': '{{ content }}' });
    expect(await findRoot(`${ROOT}/app/views/partials/modules/x.liquid`, exists)).toBe(ROOT);
  });

  it('does not mistake marketplace_builder/modules/ for a root either', async () => {
    const exists = fileExists({ 'marketplace_builder/modules/x.liquid': '{{ content }}' });
    expect(await findRoot(`${ROOT}/marketplace_builder/modules/x.liquid`, exists)).toBe(ROOT);
  });

  it('returns null when nothing marks a root', async () => {
    const exists = fileExists({});
    expect(await findRoot(`${ROOT}/src/file.liquid`, exists)).toBe(null);
  });

  /**
   * Every one of these is a real directory in a real customer project. `app/` named a
   * page directory, not a project, and the root came back as the directory holding it —
   * so a `{% include %}` resolved against `app/views/pages/`, and pointed at
   * `app/views/pages/app/views/partials/…`, which cannot exist.
   */
  describe('a marker directory inside a project source subtree', () => {
    it('does not mistake a page directory called app/ for a root', async () => {
      const exists = fileExists({
        'app/views/pages/app/index.liquid': '{{ content }}',
        'app/views/pages/api/auth/post.liquid': '{{ content }}',
      });
      expect(await findRoot(`${ROOT}/app/views/pages/api/auth/post.liquid`, exists)).toBe(ROOT);
    });

    it('does not mistake a partial directory called app/ for a root', async () => {
      const exists = fileExists({
        'app/views/partials/app/header.liquid': '{{ content }}',
        'app/views/partials/api/auth/login.liquid': '{{ content }}',
      });
      expect(await findRoot(`${ROOT}/app/views/partials/api/auth/login.liquid`, exists)).toBe(ROOT);
    });

    it('does not mistake a page directory called marketplace_builder/ for a root', async () => {
      const exists = fileExists({
        'app/views/pages/marketplace_builder/index.liquid': '{{ content }}',
        'app/views/pages/api/post.liquid': '{{ content }}',
      });
      expect(await findRoot(`${ROOT}/app/views/pages/api/post.liquid`, exists)).toBe(ROOT);
    });

    it('does not mistake app/ inside a module subtree for a root', async () => {
      const exists = fileExists({
        'modules/course/public/views/partials/app/card.liquid': '{{ content }}',
        'modules/course/public/views/partials/admin/list.liquid': '{{ content }}',
      });
      expect(
        await findRoot(`${ROOT}/modules/course/public/views/partials/admin/list.liquid`, exists),
      ).toBe(ROOT);
    });

    it('does not mistake modules/ inside a module subtree for a root', async () => {
      // The `app/`-ancestor scan this replaced could not see this one: nothing above
      // `admin_partials` is called `app`.
      const exists = fileExists({
        'modules/course/public/views/partials/admin_partials/modules/x.liquid': '{{ content }}',
      });
      expect(
        await findRoot(
          `${ROOT}/modules/course/public/views/partials/admin_partials/modules/x.liquid`,
          exists,
        ),
      ).toBe(ROOT);
    });

    it('does not mistake app/modules/<name>/ for a root', async () => {
      const exists = fileExists({ 'app/modules/core/public/lib/x.liquid': '{{ content }}' });
      expect(await findRoot(`${ROOT}/app/modules/core/public/lib/x.liquid`, exists)).toBe(ROOT);
    });
  });

  /**
   * The controls for the above. The guard suppresses marker DIRECTORIES, and a
   * suppression wide enough to hide a real nested project would pass every assertion in
   * the block above.
   */
  describe('a marker outside every source subtree still marks a root', () => {
    it('finds a nested project whose own app/ sits outside the outer project subtrees', async () => {
      const exists = fileExists({
        'app/views/pages/index.liquid': '{{ content }}',
        'packages/inner/app/views/pages/index.liquid': '{{ content }}',
      });
      expect(await findRoot(`${ROOT}/packages/inner/app/views/pages/index.liquid`, exists)).toBe(
        `${ROOT}/packages/inner`,
      );
    });

    it('finds a nested standalone module project by its modules/ directory', async () => {
      const exists = fileExists({
        'app/views/pages/index.liquid': '{{ content }}',
        'vendor/pkg/modules/core/public/lib/x.liquid': '{{ content }}',
      });
      expect(await findRoot(`${ROOT}/vendor/pkg/modules/core/public/lib/x.liquid`, exists)).toBe(
        `${ROOT}/vendor/pkg`,
      );
    });

    it('honours an explicit .pos even inside a source subtree', async () => {
      // A file marker is a statement, not an accident of naming.
      const exists = fileExists({
        'app/views/pages/index.liquid': '{{ content }}',
        'app/views/pages/nested/.pos': 'sentinel',
        'app/views/pages/nested/x.liquid': '{{ content }}',
      });
      expect(await findRoot(`${ROOT}/app/views/pages/nested/x.liquid`, exists)).toBe(
        `${ROOT}/app/views/pages/nested`,
      );
    });
  });
});

describe('Unit: resolveProjectRoot', () => {
  /**
   * The distinction this function exists for. `findRoot` alone cannot tell a caller whether the
   * path it was handed IS the root or merely sits inside one, and that is exactly what decides
   * whether the linter may run: `check run app` reported "No offenses found" while checking zero
   * files, because a subdirectory was accepted as a project root and matched nothing.
   */
  it('reports the root and that the path IS it, when given the root', async () => {
    const exists = fileExists({ 'app/views/pages/index.liquid': '{{ content }}' });
    expect(await resolveProjectRoot(ROOT, exists)).toEqual({
      given: ROOT,
      root: ROOT,
      isRoot: true,
      marker: 'app',
    });
  });

  it('reports the root and that the path is NOT it, when given a directory inside the project', async () => {
    // The case behind the bug. A caller can now say "nothing was checked, the root is X" instead
    // of silently checking nothing.
    const exists = fileExists({ 'app/views/pages/index.liquid': '{{ content }}' });
    expect(await resolveProjectRoot(`${ROOT}/app`, exists)).toEqual({
      given: `${ROOT}/app`,
      root: ROOT,
      isRoot: false,
      marker: 'app',
    });
  });

  it('reports a module directory as inside the project, not as its own root', async () => {
    // `check run modules/<name>` was the other spelling that silently checked nothing.
    const exists = fileExists({
      'app/views/pages/index.liquid': '{{ content }}',
      'modules/mymodule/public/views/partials/card.liquid': '<div></div>',
    });
    const res = await resolveProjectRoot(`${ROOT}/modules/mymodule`, exists);
    expect(res.root).toBe(ROOT);
    expect(res.isRoot).toBe(false);
  });

  it('reports no root at all for a path outside any project', async () => {
    const exists = fileExists({ 'app/views/pages/index.liquid': '{{ content }}' });
    const res = await resolveProjectRoot('file:///elsewhere', exists);
    expect(res.root).toBeNull();
    expect(res.isRoot).toBe(false);
  });

  it('normalizes a plain absolute path to a URI', async () => {
    // Callers hand it either spelling; `given` is what a message will quote back, so it must be
    // the normalized form rather than whatever the shell happened to pass.
    const exists = fileExists({ 'app/views/pages/index.liquid': '{{ content }}' });
    const res = await resolveProjectRoot('/project', exists);
    expect(res.given).toBe(ROOT);
    expect(res.isRoot).toBe(true);
  });
});

describe('Unit: PROJECT_ROOT_MARKERS', () => {
  it('names every marker findRoot actually looks for', () => {
    // The list exists so an error message can state what was searched for. It is derived from the
    // same constants isRoot uses, so this asserts the derivation kept them all rather than
    // re-stating the list a second time.
    expect(PROJECT_ROOT_MARKERS).toContain('app/');
    expect(PROJECT_ROOT_MARKERS).toContain('marketplace_builder/');
    expect(PROJECT_ROOT_MARKERS).toContain('modules/');
    expect(PROJECT_ROOT_MARKERS).toContain('.pos');
    expect(PROJECT_ROOT_MARKERS).toContain('.platformos-check.yml');
  });
});

describe('Unit: resolveProjectRoot reports WHICH marker made it a root', () => {
  /**
   * The two marker kinds are not equal evidence, and a caller writing for a human has to know
   * which it has. `.pos` is a declaration; `modules/` is a guess from a directory NAME — and
   * `app`, `modules` and `marketplace_builder` are ordinary names. A checkout of module
   * repositories under `~/Work/modules` makes `~/Work` resolve as a project root, and Windows
   * machines shipping `C:\Modules` make the drive root resolve as one.
   */
  it('reports a declaration as declared', async () => {
    const exists = fileExists({ '.pos': 'sentinel', 'app/views/pages/index.liquid': '{{ x }}' });
    const res = await resolveProjectRoot(`${ROOT}/app`, exists);
    expect(res.marker).toBe('.pos');
    expect(isDeclaredRoot(res)).toBe(true);
  });

  it('reports a directory-name match as NOT declared', async () => {
    // No .pos, no config — only the name `app`.
    const exists = fileExists({ 'app/views/pages/index.liquid': '{{ x }}' });
    const res = await resolveProjectRoot(`${ROOT}/app`, exists);
    expect(res.marker).toBe('app');
    expect(isDeclaredRoot(res)).toBe(false);
  });

  it('prefers the declaration when both are present, which is the normal project', async () => {
    // Order matters: a real project has `.pos` beside `app/`, and the stronger evidence must win
    // or every such project would be described as a guess.
    const exists = fileExists({
      '.platformos-check.yml': 'extends: nothing',
      'app/views/pages/index.liquid': '{{ x }}',
    });
    const res = await resolveProjectRoot(ROOT, exists);
    expect(res.marker).toBe('.platformos-check.yml');
    expect(isDeclaredRoot(res)).toBe(true);
  });

  it('reports no marker when there is no root', async () => {
    const exists = fileExists({ 'app/views/pages/index.liquid': '{{ x }}' });
    const res = await resolveProjectRoot('file:///elsewhere', exists);
    expect(res.marker).toBeNull();
    expect(isDeclaredRoot(res)).toBe(false);
  });
});
