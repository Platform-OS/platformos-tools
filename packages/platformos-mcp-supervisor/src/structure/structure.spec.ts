import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runStructure } from './structure';
import type { ValidateCodeDependency } from '../result/types';

/**
 * Adapter integration: drives the real platformos-graph `extractFileReferences`
 * against a temp project. Targets need not exist on disk — `extractFileReferences`
 * resolves a missing target to its canonical default path — so the assertions
 * pin the project-relative target + kind + 1-based position without fixtures.
 */
describe('Integration: runStructure (structure adapter)', () => {
  let projectDir: string;

  beforeAll(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'mcp-sup-structure-'));
  });

  afterAll(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  const run = (filePath: string, content: string) =>
    runStructure({ projectDir, filePath, content });

  it('maps a {% render %} edge to a render dependency', async () => {
    const deps = await run('app/views/pages/index.liquid', "{% render 'card' %}");
    expect(deps).toEqual([
      { kind: 'render', target: 'app/views/partials/card.liquid', line: 1, column: 1 },
    ]);
  });

  it('maps an {% include %} edge to an include dependency', async () => {
    const deps = await run('app/views/pages/index.liquid', "{% include 'card' %}");
    expect(deps).toEqual([
      { kind: 'include', target: 'app/views/partials/card.liquid', line: 1, column: 1 },
    ]);
  });

  it('maps a {% function %} edge to a function dependency', async () => {
    const deps = await run('app/views/pages/index.liquid', "{% function r = 'queries/list' %}");
    expect(deps).toEqual([
      { kind: 'function', target: 'app/lib/queries/list.liquid', line: 1, column: 1 },
    ]);
  });

  it('maps a {% background %} edge to a background dependency', async () => {
    // Background resolves like {% function %} (lib search path), so a target
    // that does not exist defaults under app/lib.
    const deps = await run('app/views/pages/index.liquid', "{% background j = 'jobs/notify' %}");
    expect(deps).toEqual([
      { kind: 'background', target: 'app/lib/jobs/notify.liquid', line: 1, column: 1 },
    ]);
  });

  it('maps a {% graphql %} edge to a graphql dependency', async () => {
    const deps = await run('app/views/pages/index.liquid', "{% graphql r = 'blog/find' %}");
    expect(deps).toEqual([
      { kind: 'graphql', target: 'app/graphql/blog/find.graphql', line: 1, column: 1 },
    ]);
  });

  it('maps an asset filter to an asset dependency', async () => {
    // The asset edge's range is the `'app.js' | asset_url` expression (the
    // variable output), which starts at column 4 — after `{{ `.
    const deps = await run('app/views/layouts/application.liquid', "{{ 'app.js' | asset_url }}");
    expect(deps).toEqual([{ kind: 'asset', target: 'assets/app.js', line: 1, column: 4 }]);
  });

  it('maps a frontmatter `layout:` to a layout dependency', async () => {
    const content = `---
slug: about
layout: theme
---
<h1>About</h1>`;
    const deps = await run('app/views/pages/about.liquid', content);
    expect(deps).toEqual([
      { kind: 'layout', target: 'app/views/layouts/theme.liquid', line: 1, column: 1 },
    ]);
  });

  it('resolves a module-prefixed target into modules/<name>/public/...', async () => {
    const deps = await run('app/views/pages/index.liquid', "{% render 'modules/core/card' %}");
    expect(deps).toEqual([
      {
        kind: 'render',
        target: 'modules/core/public/views/partials/card.liquid',
        line: 1,
        column: 1,
      },
    ]);
  });

  it('reports the 1-based position of a reference that is not on the first line', async () => {
    const content = "<h1>hi</h1>\n  {% render 'card' %}";
    const deps = await run('app/views/pages/index.liquid', content);
    expect(deps).toEqual([
      { kind: 'render', target: 'app/views/partials/card.liquid', line: 2, column: 3 },
    ]);
  });

  it('returns every edge of a multi-dependency file in source order', async () => {
    const content = `---
layout: theme
---
{% function items = 'queries/list' %}
{% render 'card' %}`;
    const deps = await run('app/views/pages/index.liquid', content);
    expect(deps).toEqual<ValidateCodeDependency[]>([
      { kind: 'layout', target: 'app/views/layouts/theme.liquid', line: 1, column: 1 },
      { kind: 'function', target: 'app/lib/queries/list.liquid', line: 4, column: 1 },
      { kind: 'render', target: 'app/views/partials/card.liquid', line: 5, column: 1 },
    ]);
  });

  it('returns no dependencies for a file with none', async () => {
    expect(await run('app/views/pages/index.liquid', '<h1>{{ page.title }}</h1>')).toEqual([]);
  });

  it('skips dynamic (non-literal) targets', async () => {
    expect(await run('app/views/pages/index.liquid', '{% render partial_name %}')).toEqual([]);
  });

  it('returns no dependencies for a non-Liquid (.graphql) file', async () => {
    const deps = await run('app/graphql/blog/find.graphql', 'query find { records { id } }');
    expect(deps).toEqual([]);
  });

  it('accepts an absolute file path', async () => {
    const abs = join(projectDir, 'app/views/pages/index.liquid');
    expect(await run(abs, "{% render 'card' %}")).toEqual([
      { kind: 'render', target: 'app/views/partials/card.liquid', line: 1, column: 1 },
    ]);
  });
});
