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
  return results.flat().map(toPosixPath).filter(isThirdParty);
}

/**
 * The first-party packages match the `platformos-check-*` naming convention themselves, so the
 * glob above finds them and they have to be excluded by name. None of them exports `checks`.
 *
 * Takes a POSIX path, which is why the caller normalizes: `glob` returns results in the
 * platform's own separator, so on Windows these arrive as
 * `C:\proj\node_modules\@platformos\platformos-check-node` and a pattern written with `/`
 * excludes nothing. Every first-party package was then `require`d as a third-party plugin, which
 * printed an "Error loading ..., ignoring it" line apiece and loaded platformos-check-node a
 * second time, under CJS.
 */
function isThirdParty(modulePath: ModulePath): boolean {
  return (
    !/@platformos\/platformos-check-(node|common|browser|docs-updater)/.test(modulePath) &&
    !/platformos-check-vscode/.test(modulePath)
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
