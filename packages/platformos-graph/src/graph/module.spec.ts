import { describe, expect, it } from 'vitest';
import { AppGraph } from '../types';
import {
  getLayoutModule,
  getLayoutModuleByUri,
  getPageModule,
  getPartialModuleByUri,
} from './module';

/**
 * Node-identity invariant (code-review F10): a file must resolve to ONE module
 * regardless of which producer creates it. Entry-point factories
 * (getLayoutModule/getPageModule) take a URI straight from directory discovery,
 * while edge-target factories (getLayoutModuleByUri/getPartialModuleByUri) take a
 * DocumentsLocator-resolved URI; both normalize, so a Windows-style backslash
 * URI from one and a forward-slash URI from the other key to the SAME cached
 * node — never a split identity that would drop an incoming edge.
 */
describe('module factories: normalized node identity', () => {
  const newGraph = (): AppGraph => ({ rootUri: 'file:///project', entryPoints: [], modules: {} });

  it('dedupes an entry-point layout with the same layout resolved as an edge target', () => {
    const graph = newGraph();
    // As if discovered by directory traversal on Windows (backslashes)…
    const entry = getLayoutModule(graph, 'file:///project\\app\\views\\layouts\\theme.liquid');
    // …and as if resolved from a page's frontmatter `layout:` (forward slashes).
    const edgeTarget = getLayoutModuleByUri(
      graph,
      'file:///project/app/views/layouts/theme.liquid',
    );

    expect(entry).toBe(edgeTarget); // same cached object — one node
    expect(entry?.uri).toEqual('file:///project/app/views/layouts/theme.liquid');
  });

  it('dedupes an entry-point page regardless of separator style', () => {
    const graph = newGraph();
    const first = getPageModule(graph, 'file:///project\\app\\views\\pages\\index.liquid');
    const second = getPageModule(graph, 'file:///project/app/views/pages/index.liquid');

    expect(first).toBe(second);
    expect(first.uri).toEqual('file:///project/app/views/pages/index.liquid');
  });

  it('dedupes a partial across separator styles too (regression guard for the shared contract)', () => {
    const graph = newGraph();
    const a = getPartialModuleByUri(graph, 'file:///project\\app\\views\\partials\\card.liquid');
    const b = getPartialModuleByUri(graph, 'file:///project/app/views/partials/card.liquid');

    expect(a).toBe(b);
    expect(a.uri).toEqual('file:///project/app/views/partials/card.liquid');
  });
});
