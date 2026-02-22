import { memoize, path } from '@platformos/platformos-check-common';
import { toSourceCode } from '../toSourceCode';
import { AugmentedDependencies, IDependencies } from '../types';
import { identity } from '../utils';

export function augmentDependencies(rootUri: string, ideps: IDependencies): AugmentedDependencies {
  return {
    fs: ideps.fs,

    // parse at most once
    getSourceCode: memoize(
      ideps.getSourceCode ??
        async function defaultGetSourceCode(uri) {
          const contents = await ideps.fs.readFile(uri);
          return toSourceCode(uri, contents);
        },
      identity,
    ),

    getWebComponentDefinitionReference: ideps.getWebComponentDefinitionReference,
  };
}
