import {
  Config,
  JSONSourceCode,
  LiquidSourceCode,
  Offense,
  App,
  allChecks,
  check as coreCheck,
  toSourceCode,
  recommended,
  Dependencies,
  YAMLSourceCode,
} from '@platformos/platformos-check-common';

import { AbstractFileSystem, FileStat, FileTuple, FileType } from '@platformos/platformos-common';

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

export function getApp(appDesc: AppData): App {
  return Object.entries(appDesc)
    .map(([relativePath, source]) => toSourceCode(toUri(relativePath), source))
    .filter((x): x is LiquidSourceCode | JSONSourceCode | YAMLSourceCode => x !== undefined);
}

/**
 * In the event where you don't care about reusing your SourceCode objects, simpleCheck works alright.
 *
 * But if you want to manage your memory (e.g. don't reparse ASTs for files that were not modified),
 * it might be preferable to call coreCheck directly.
 */
export async function simpleCheck(
  appDesc: AppData,
  config: Config,
  dependencies: Dependencies,
): Promise<Offense[]> {
  const app = getApp(appDesc);
  return coreCheck(app, config, dependencies);
}

export { coreCheck };

function toUri(relativePath: string) {
  return 'browser:/' + relativePath;
}
