import { memoize, path as pathUtils } from '@platformos/platformos-check-common';
import { AbstractFileSystem } from '@platformos/platformos-common';
import { NodeFileSystem } from '@platformos/platformos-check-node';
import { vi } from 'vitest';
import { URI } from 'vscode-uri';
import { getWebComponentMap } from '../getWebComponentMap';
import { toSourceCode } from '../toSourceCode';
import { identity } from '../utils';

export function makeGetSourceCode(fs: AbstractFileSystem) {
  return memoize(async function getSourceCode(uri: string) {
    const source = await fs.readFile(uri);
    return toSourceCode(URI.file(uri).toString(), source);
  }, identity);
}

export const fixturesRoot = pathUtils.join(URI.file(__dirname), ...'../../fixtures'.split('/'));
export const skeleton = pathUtils.join(fixturesRoot, 'skeleton');

export async function getDependencies(rootUri: string, fs: AbstractFileSystem = NodeFileSystem) {
  const getSourceCode = makeGetSourceCode(fs);
  const deps = {
    fs,
    getSourceCode,
    getWebComponentDefinitionReference: (customElementName: string) =>
      webComponentDefs.get(customElementName),
  };

  const webComponentDefs = await getWebComponentMap(rootUri, deps);

  return deps;
}

// This thing is way too hard to type.
export function mockImpl(obj: any, method: any, callback: any) {
  const original = obj[method].bind(obj);
  return vi.spyOn(obj, method).mockImplementation(function () {
    return callback(original, ...arguments);
  });
}
