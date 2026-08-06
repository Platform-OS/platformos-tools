import { memoize, path } from '@platformos/platformos-check-common';
import { toSourceCode } from '../toSourceCode';
import { AugmentedDependencies, IDependencies } from '../types';
import { identity } from '../utils';

export function augmentDependencies(rootUri: string, ideps: IDependencies): AugmentedDependencies {
  return {
    fs: ideps.fs,

    // Passed through as given. There is nothing to default: an absent app means the
    // caller has none, and `DocumentsLocator` already owns what to do then.
    app: ideps.app,

    // parse at most once
    getSourceCode: memoize(
      ideps.getSourceCode ??
        async function defaultGetSourceCode(uri) {
          const contents = await ideps.fs.readFile(uri);
          return toSourceCode(uri, contents);
        },
      identity,
    ),
  };
}
