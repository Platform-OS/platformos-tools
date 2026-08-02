import { DocumentsLocator, FileType } from '@platformos/platformos-common';
import { describe, expect, it } from 'vitest';
import { URI } from 'vscode-uri';
import { AppGraph, ModuleType } from '../types';
import { getAssetModule, getModule } from './module';

const ROOT = 'file:///project';

const emptyGraph = (): AppGraph => ({ rootUri: ROOT, entryPoints: [], modules: {} });

/**
 * Assets follow exactly the same placement rules as every other platformOS file
 * type: `app/assets/` or `modules/<name>/{public,private}/assets/`.
 *
 * This graph used to resolve `{{ 'app.js' | asset_url }}` to a root-level
 * `assets/app.js` — a location the platform never deploys from — because it kept its
 * own second copy of the rule. Its own fixture had a root-level `assets/` directory,
 * so the bug looked self-consistent, while `DocumentsLocator` resolved the very same
 * reference to `app/assets/app.js`.
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
      readDirectory: async () => [],
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
