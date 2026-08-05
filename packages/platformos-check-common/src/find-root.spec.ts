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
});
