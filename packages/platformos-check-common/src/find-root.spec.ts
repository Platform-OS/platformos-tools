import { describe, expect, it } from 'vitest';
import { makeFileExists } from './context-utils';
import { findRoot } from './find-root';
import { MockApp, MockFileSystem } from './test';

const ROOT = 'file:///project';

/** The `fileExists` every real caller passes, over the given project tree. */
const fileExists = (files: MockApp) => makeFileExists(new MockFileSystem(files, ROOT));

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
