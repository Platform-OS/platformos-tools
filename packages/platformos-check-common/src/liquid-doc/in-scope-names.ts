import { PlatformOSFileType } from '@platformos/platformos-common';
import { Context, SourceCodeType } from '../types';
import { isObjectInScope } from '../checks/utils';

/**
 * The documented object names in scope for a target of `targetFileType`, cached per
 * docset object list.
 *
 * WHY the cache. `objects()` is memoized upstream, but the SCAN over every documented
 * object was re-run at every call site, and a partial rendered from dozens of places
 * paid it dozens of times. `PartialCallArguments` is the highest-volume check in the
 * suite (6765 offenses on one real project), so this runs a lot.
 *
 * Keyed weakly on the objects ARRAY, not on a name or a version: `objects()` returns
 * the same array for the life of a docset, so a re-downloaded docset yields a new
 * array and therefore a new entry, and the old one is collected. There is nothing to
 * invalidate and nothing to bound — the same discipline `isIgnored` uses for its
 * compiled matchers.
 */
const inScopeNamesByObjects = new WeakMap<
  object,
  Map<PlatformOSFileType | undefined, readonly string[]>
>();

export async function inScopeNames(
  context: Context<SourceCodeType.LiquidHtml>,
  // `undefined` when the located file is outside every recognized platformOS directory,
  // which `isObjectInScope` already answers for — it is a distinct cache key, not a
  // reason to skip the cache.
  targetFileType: PlatformOSFileType | undefined,
): Promise<string[]> {
  const objects = (await context.platformosDocset?.objects()) ?? [];

  let byType = inScopeNamesByObjects.get(objects);
  if (!byType) {
    byType = new Map();
    inScopeNamesByObjects.set(objects, byType);
  }

  let names = byType.get(targetFileType);
  if (!names) {
    // Which documented objects reach the TARGET depends on the target's type: most
    // `global` objects are not global to a partial — `data` and `response` belong to an
    // api_call, so a partial reading one is reading an argument nobody passed.
    //
    // THE DOCSET IS THE WHOLE ANSWER. `app` used to be appended here for a partial, and `app` is
    // not a platformOS object at all — it is Shopify's theme app extension drop, inherited with
    // the fork. `UndefinedObject` carried the same exemption and dropped it; keeping it here made
    // this the one place in the toolchain where a name the platform does not provide counted as
    // supplied, which silences the very mistake these checks exist to report.
    names = objects
      .filter((object) => isObjectInScope(object, targetFileType))
      .map((object) => object.name);
    byType.set(targetFileType, names);
  }

  // A FRESH array on every call. Callers are free to extend the returned `inScope`, and it
  // also spells the `AppFile.derived` key `undefinedVariablesOf` memoizes on — one caller
  // pushing onto a shared array would corrupt both the next caller's scope and that key.
  return [...names];
}
