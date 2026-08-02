import {
  Config,
  Offense,
  allChecks,
  check as coreCheck,
  toSourceCode,
  recommended,
  sourceParsers,
  Dependencies,
} from '@platformos/platformos-check-common';

import {
  AbstractFileSystem,
  App,
  FileStat,
  FileTuple,
  FileType,
} from '@platformos/platformos-common';

export {
  toSourceCode,
  allChecks,
  recommended,
  Config,
  Dependencies,
  AbstractFileSystem,
  FileStat,
  FileTuple,
  FileType,
};

/**
 * @example
 * {
 *   'app/views/layouts/layout.liquid': `
 *     <html>
 *       {{ content_for_page }}
 *     </html>
 *   `,
 *   'app/views/partials/snip.liquid': `
 *     <b>'hello world'</b>
 *   `,
 * }
 */
export type AppData = {
  [relativePath in string]: string;
};

/**
 * Lint an app whose files are already in memory.
 *
 * The paths in `appDesc` are relative to `config.rootUri` and must be real
 * platformOS paths — `App` holds only files in a recognized platformOS directory,
 * the same rule the CLI and the language server apply, so anything else is not part
 * of the app and is not checked. Files added later are read through
 * `dependencies.fs`; everything in `appDesc` starts loaded and is never read.
 *
 * If you want to manage your memory across runs (e.g. don't reparse files that were
 * not modified), build the {@link App} yourself and call {@link coreCheck} — an
 * `App` reads and parses each file at most once, so keeping one and calling
 * `update`/`setSource` on it is cheaper than rebuilding.
 */
export async function simpleCheck(
  appDesc: AppData,
  config: Config,
  dependencies: Dependencies,
): Promise<Offense[]> {
  const app = App.fromSources(config.rootUri, appDesc, dependencies.fs, sourceParsers);
  return coreCheck(app, config, dependencies);
}

export { coreCheck, App };
