import { path as pathUtils, SourceCodeType } from '@platformos/platformos-check-common';
import { MockFileSystem } from '@platformos/platformos-check-common/src/test';
import { assert, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildAppGraph } from '../index';
import { toSourceCode } from '../toSourceCode';
import { Dependencies, LiquidModuleKind, ModuleType, AppGraph } from '../types';
import { getDependencies, skeleton } from './test-helpers';

describe('Module: index', () => {
  const rootUri = skeleton;
  const p = (part: string) => pathUtils.join(rootUri, ...part.split('/'));
  const loc = (part: string) => expect.objectContaining({ uri: p(part) });
  let dependencies: Dependencies;

  beforeAll(async () => {
    dependencies = getDependencies();
  }, 15000);

  describe('Unit: buildAppGraph', { timeout: 10000 }, () => {
    it('builds a graph of the app', { timeout: 10000 }, async () => {
      const graph = await buildAppGraph(rootUri, dependencies);
      expect(graph).toBeDefined();
    });

    describe('with a valid app graph', () => {
      let graph: AppGraph;

      beforeEach(async () => {
        graph = await buildAppGraph(rootUri, dependencies);
      });

      it('has a root URI', () => {
        expect(graph.rootUri).toBeDefined();
        expect(graph.rootUri).toBe(rootUri);
      });

      it('infers entry points from layouts and pages', () => {
        expect(graph.entryPoints).toHaveLength(2);
        expect(graph.entryPoints.map((x) => x.uri)).toEqual(
          expect.arrayContaining([
            p('app/views/layouts/application.liquid'),
            p('app/views/pages/index.liquid'),
          ]),
        );
      });

      it("finds app/views/layouts/application.liquid's dependencies", () => {
        const layout = graph.modules[p('app/views/layouts/application.liquid')];
        assert(layout);
        assert(layout.type === ModuleType.Liquid);
        assert(layout.kind === LiquidModuleKind.Layout);

        const deps = layout.dependencies;
        expect(deps.map((x) => x.target.uri)).toEqual(
          expect.arrayContaining([
            p('app/assets/app.js'),
            p('app/assets/app.css'),
            p('app/views/partials/header.liquid'),
          ]),
        );
      });

      it("finds app/views/partials/parent's dependencies and references", async () => {
        const parentPartial = graph.modules[p('app/views/partials/parent.liquid')];
        assert(parentPartial);
        assert(parentPartial.type === ModuleType.Liquid);
        assert(parentPartial.kind === LiquidModuleKind.Partial);

        // outgoing links — parent renders exactly one partial (child)
        const deps = parentPartial.dependencies;
        assert(deps.map((x) => x.source.uri).every((x) => x === parentPartial.uri));
        expect(deps.map((x) => x.target.uri)).toEqual([p('app/views/partials/child.liquid')]);

        // {% render 'child' %} dependency
        const parentSource = await dependencies.getSourceCode(
          p('app/views/partials/parent.liquid'),
        );
        assert(parentSource);
        assert(parentSource.type === SourceCodeType.LiquidHtml);
        expect(parentPartial.dependencies.map((x) => x.source)).toContainEqual(
          expect.objectContaining({
            uri: p('app/views/partials/parent.liquid'),
            range: [
              parentSource.source.indexOf('{% render "child"'),
              parentSource.source.indexOf('{% render "child"') +
                '{% render "child", children: children %}'.length,
            ],
          }),
        );
      });

      it("finds app/views/partials/child's references", () => {
        const childPartial = graph.modules[p('app/views/partials/child.liquid')];
        assert(childPartial);
        assert(childPartial.type === ModuleType.Liquid);
        assert(childPartial.kind === LiquidModuleKind.Partial);

        const refs = childPartial.references;
        expect(refs.map((x) => x.source.uri)).toEqual(
          expect.arrayContaining([
            p('app/views/partials/parent.liquid'),
            p('app/views/partials/header.liquid'),
          ]),
        );
      });

      it('tags every layout edge with its kind (asset, asset, render)', () => {
        const layout = graph.modules[p('app/views/layouts/application.liquid')];
        assert(layout);

        // The complete, ordered edge set — not a membership probe — so an extra,
        // missing, or mis-kinded edge fails. (Source ranges are pinned by the
        // dedicated render-dependency test above.)
        expect(
          layout.dependencies.map((d) => ({ target: d.target.uri, type: d.type, kind: d.kind })),
        ).toEqual([
          { target: p('app/assets/app.js'), type: 'direct', kind: 'asset' },
          { target: p('app/assets/app.css'), type: 'direct', kind: 'asset' },
          { target: p('app/views/partials/header.liquid'), type: 'direct', kind: 'render' },
        ]);
      });
    });

    /**
     * Entry points come from an ANCHORED walk of the app subtrees, so what a
     * directory is CALLED never decides whether the graph can see it. The walk this
     * replaced skipped any directory ending in `vendor`, `build`, `tmp` or `dist`,
     * which lost every page under `app/views/pages/vendor/**` — a real section of a
     * real site — while still descending into `tmp/app/views/pages/`, which the
     * platform does not deploy at all.
     */
    describe('entry points on a project with app directories named like build output', () => {
      const projectRoot = 'file:///project';
      const u = (part: string) => `${projectRoot}/${part}`;

      let graph: AppGraph;

      beforeEach(async () => {
        const fs = new MockFileSystem(
          {
            'app/views/pages/vendor/index.liquid': `{% render 'vendor/card' %}`,
            'app/views/pages/build/status.liquid': `ok`,
            'app/views/partials/vendor/card.liquid': `a card`,
            'tmp/app/views/pages/scratch.liquid': `not deployed`,
            'node_modules/some-pkg/app/views/pages/decoy.liquid': `not ours`,
            'dist/app/views/pages/bundled.liquid': `build output`,
          },
          projectRoot,
        );

        graph = await buildAppGraph(projectRoot, {
          fs,
          getSourceCode: async (uri: string) => toSourceCode(uri, await fs.readFile(uri)),
        });
      });

      it('finds the pages under vendor/ and build/, and nothing outside the app subtrees', () => {
        expect(graph.entryPoints.map((entry) => entry.uri).sort()).toEqual([
          u('app/views/pages/build/status.liquid'),
          u('app/views/pages/vendor/index.liquid'),
        ]);
      });

      it('traverses them, so a partial under vendor/ is a graph node with a reference', () => {
        const card = graph.modules[u('app/views/partials/vendor/card.liquid')];
        assert(card);
        expect(card.references.map((reference) => reference.source.uri)).toEqual([
          u('app/views/pages/vendor/index.liquid'),
        ]);
      });
    });
  });
});
