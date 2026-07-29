import { describe, expect, it } from 'vitest';
import { AppGraph } from '../types';
import {
  getLayoutModule,
  getLayoutModuleByUri,
  getModule,
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

/**
 * `getModule` (the entry-point dispatcher) must key a partial by its OWN
 * resolved URI — like it does for layouts/pages/assets — NOT by rebuilding the
 * path from the basename. Rebuilding from the basename forced every partial into
 * `app/views/partials/<basename>.liquid`, which mis-keyed any `lib/` or nested
 * partial (e.g. `app/lib/can/payment_request.liquid` → the phantom
 * `app/views/partials/payment_request.liquid`), splitting it from the same file
 * resolved as an edge target and losing its edges in the full build.
 */
describe('getModule: partial entry point keys by its own URI', () => {
  const newGraph = (): AppGraph => ({ rootUri: 'file:///project', entryPoints: [], modules: {} });

  it('keys a lib partial at its own URI, not app/views/partials/<basename>', () => {
    const graph = newGraph();
    const uri = 'file:///project/app/lib/can/payment_request.liquid';
    expect(getModule(graph, uri)?.uri).toEqual(uri);
  });

  it('keys a nested lib partial at its own URI', () => {
    const graph = newGraph();
    const uri = 'file:///project/app/lib/queries/v2/projects/find.liquid';
    expect(getModule(graph, uri)?.uri).toEqual(uri);
  });

  it('a lib partial entry point and the same file resolved as an edge target are ONE node', () => {
    const graph = newGraph();
    const uri = 'file:///project/app/lib/commands/create.liquid';
    const entry = getModule(graph, uri);
    const edgeTarget = getPartialModuleByUri(graph, uri);
    expect(entry).toBe(edgeTarget);
  });

  it('a flat app/views/partials partial is unaffected', () => {
    const graph = newGraph();
    const uri = 'file:///project/app/views/partials/card.liquid';
    expect(getModule(graph, uri)?.uri).toEqual(uri);
  });
});
