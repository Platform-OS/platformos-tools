import { path as pathUtils } from '@platformos/platformos-check-common';
import { describe, expect, it } from 'vitest';
import { AppGraph } from '../types';
import { getLayoutModule, getPartialModule } from './module';
import { serializeAppGraph } from './serialize';
import { bind } from './traverse';

describe('Unit: serializeAppGraph', () => {
  it('serialize the graph', () => {
    const rootUri = 'file:///app';
    const p = (part: string) => pathUtils.join(rootUri, part);
    const graph: AppGraph = {
      entryPoints: [],
      modules: {},
      rootUri,
    };

    const layout = getLayoutModule(graph, p('app/views/layouts/application.liquid'))!;
    const headerPartial = getPartialModule(graph, 'header');
    const parentPartial = getPartialModule(graph, 'parent');
    const childPartial = getPartialModule(graph, 'child');

    bind(layout, headerPartial, { sourceRange: [0, 5] });
    bind(layout, parentPartial, { sourceRange: [10, 15] });
    bind(parentPartial, childPartial, { sourceRange: [20, 25] });

    graph.entryPoints = [layout];
    [layout, headerPartial, parentPartial, childPartial].forEach((module) => {
      graph.modules[module.uri] = module;
    });

    const { nodes, edges } = serializeAppGraph(graph);
    expect(nodes).toHaveLength(4);
    expect(edges).toHaveLength(3);
    expect(edges).toEqual(
      expect.arrayContaining([
        {
          source: { uri: p('app/views/layouts/application.liquid'), range: [0, 5] },
          target: { uri: p('app/views/partials/header.liquid') },
          type: 'direct',
        },
        {
          source: { uri: p('app/views/layouts/application.liquid'), range: [10, 15] },
          target: { uri: p('app/views/partials/parent.liquid') },
          type: 'direct',
        },
        {
          source: { uri: p('app/views/partials/parent.liquid'), range: [20, 25] },
          target: { uri: p('app/views/partials/child.liquid') },
          type: 'direct',
        },
      ]),
    );
  });
});
