import { path as pathUtils, SourceCodeType } from '@platformos/platformos-check-common';
import { assert, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildAppGraph } from '../index';
import { Dependencies, LiquidModuleKind, ModuleType, AppGraph } from '../types';
import { getDependencies, skeleton } from './test-helpers';

describe('Module: index', () => {
  const rootUri = skeleton;
  const p = (part: string) => pathUtils.join(rootUri, ...part.split('/'));
  const loc = (part: string) => expect.objectContaining({ uri: p(part) });
  let dependencies: Dependencies;

  beforeAll(async () => {
    dependencies = await getDependencies(rootUri);
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
            p('assets/theme.js'),
            p('assets/theme.css'),
            p('app/views/partials/header.liquid'),
          ]),
        );
      });

      it("finds app/views/partials/parent's dependencies and references", async () => {
        const parentPartial = graph.modules[p('app/views/partials/parent.liquid')];
        assert(parentPartial);
        assert(parentPartial.type === ModuleType.Liquid);
        assert(parentPartial.kind === LiquidModuleKind.Partial);

        // outgoing links
        const deps = parentPartial.dependencies;
        assert(deps.map((x) => x.source.uri).every((x) => x === parentPartial.uri));
        expect(deps.map((x) => x.target.uri)).toEqual(
          expect.arrayContaining([
            p('app/views/partials/child.liquid'),
            p('assets/theme.js'),
          ]),
        );

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
    });
  });
});
