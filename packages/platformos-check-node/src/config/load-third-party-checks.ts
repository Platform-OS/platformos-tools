import { CheckDefinition, SourceCodeType } from '@platformos/platformos-check-common';
import { toPosixPath } from '@platformos/platformos-common';
import { glob } from 'glob';
import { AbsolutePath } from '../temp';

type ModulePath = string;

export function loadThirdPartyChecks(
  /**
   * An array of require()-able paths.
   * @example
   * [
   *   '@acme/platformos-check-extension',
   *   '/absolute/path/to/checks.js',
   *   './lib/checks.js',
   * ]
   * */
  modulePaths: ModulePath[] = [],
): CheckDefinition<SourceCodeType>[] {
  const checks = new Set<CheckDefinition<SourceCodeType>>();
  for (const modulePath of modulePaths) {
    try {
      const moduleValue = require(/* webpackIgnore: true */ modulePath);
      const moduleChecks = moduleValue.checks as unknown;
      if (!Array.isArray(moduleChecks)) {
        throw new Error(
          `Expected the 'checks' export to be an array and got ${typeof moduleChecks}`,
        );
      }

      for (const check of moduleChecks) {
        if (isCheckDefinition(check)) {
          checks.add(check);
        } else {
          console.error(`Expected ${check} to be a CheckDefinition, but it looks like it isn't`);
        }
      }
    } catch (e) {
      console.error(`Error loading ${modulePath}, ignoring it.\n${e}`);
    }
  }
  return [...checks];
}

export async function findThirdPartyChecks(nodeModuleRoot: AbsolutePath): Promise<ModulePath[]> {
  const paths = [
    globJoin(nodeModuleRoot, '/node_modules/platformos-check-*/'),
    globJoin(nodeModuleRoot, '/node_modules/@*/platformos-check-*/'),
  ];
  const results = await Promise.all(paths.map((path) => glob(path)));
  return results
    .flat()
    .filter(
      (x) =>
        !/\@platformos\/platformos-check-(node|common|browser|docs-updater)/.test(x) &&
        !/platformos-check-vscode/.test(x),
    );
}

/** A glob pattern is written in forward slashes whatever OS produced its parts. */
function globJoin(...parts: string[]): string {
  return parts.map(toPosixPath).join('/');
}

function isObjLiteral(thing: unknown): thing is Record<PropertyKey, any> {
  return thing !== null && typeof thing === 'object';
}

function isCheckDefinition(thing: unknown): thing is CheckDefinition<SourceCodeType> {
  return (
    isObjLiteral(thing) &&
    'meta' in thing &&
    'create' in thing &&
    isObjLiteral(thing.meta) &&
    'code' in thing.meta
  );
}
