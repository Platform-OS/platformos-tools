import { DocumentsLocator, FileType } from '@platformos/platformos-common';
import { describe, expect, it } from 'vitest';
import { URI } from 'vscode-uri';
import { AppGraph, ModuleType } from '../types';
import {
  getAssetModule,
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

const ROOT = 'file:///project';

const emptyGraph = (): AppGraph => ({ rootUri: ROOT, entryPoints: [], modules: {} });

/**
 * Assets follow exactly the same placement rules as every other platformOS file type:
 * `app/assets/` or `modules/<name>/{public,private}/assets/`. Resolution goes through
 * platformos-common, so the graph cannot disagree with `DocumentsLocator` about where
 * `{{ 'app.js' | asset_url }}` points.
 */
describe('asset reference resolution', () => {
  it("resolves 'app.js' to app/assets/app.js", () => {
    expect(getAssetModule(emptyGraph(), 'app.js')!.uri).toBe(`${ROOT}/app/assets/app.js`);
  });

  it('keeps a subdirectory instead of collapsing to a basename', () => {
    expect(getAssetModule(emptyGraph(), 'styles/theme.css')!.uri).toBe(
      `${ROOT}/app/assets/styles/theme.css`,
    );
  });

  it('routes a modules/<name>/ reference into that module, not into app/assets', () => {
    expect(getAssetModule(emptyGraph(), 'modules/admin/app.css')!.uri).toBe(
      `${ROOT}/app/modules/admin/public/assets/app.css`,
    );
  });

  it('ignores a reference with an extension no asset uses', () => {
    expect(getAssetModule(emptyGraph(), 'notes.txt')).toBe(undefined);
  });

  it('agrees with DocumentsLocator for an asset that exists', async () => {
    const assetUri = `${ROOT}/app/assets/app.js`;
    const locator = new DocumentsLocator({
      stat: async (uri: string) => {
        if (uri !== assetUri) throw new Error(`ENOENT: ${uri}`);
        return { type: FileType.File, size: 0 };
      },
      readFile: async () => '',
      // Resolution reads the candidate directory's listing, not a stat per spelling.
      readDirectory: async (uri: string) => {
        if (uri !== `${ROOT}/app/assets`) throw new Error(`ENOENT: ${uri}`);
        return [[assetUri, FileType.File]];
      },
    });

    expect(getAssetModule(emptyGraph(), 'app.js')!.uri).toBe(
      await locator.locate(URI.parse(ROOT), 'asset', 'app.js'),
    );
  });

  it('classifies an asset URI as an asset module without reconstructing its path', () => {
    const nested = `${ROOT}/app/assets/styles/theme.css`;
    const moduleAsset = `${ROOT}/modules/admin/private/assets/app.css`;

    expect(getModule(emptyGraph(), nested)).toMatchObject({
      type: ModuleType.Asset,
      uri: nested,
    });
    // A module ORIGINAL keeps its own path — resolving by name would have moved it to
    // the app-overwrite slot.
    expect(getModule(emptyGraph(), moduleAsset)).toMatchObject({
      type: ModuleType.Asset,
      uri: moduleAsset,
    });
  });

  it('does not treat a root-level assets/ path as part of the app', () => {
    expect(getModule(emptyGraph(), `${ROOT}/assets/app.js`)).toBe(undefined);
  });
});
