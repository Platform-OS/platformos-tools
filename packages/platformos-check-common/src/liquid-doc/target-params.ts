import { DocumentsLocator, DocumentType, PlatformOSFileType } from '@platformos/platformos-common';
import { URI } from 'vscode-uri';
import { Context, SourceCodeType } from '../types';
import { relative } from '../path';
import { isObjectInScope } from '../checks/utils';
import { extractUndefinedVariables } from '../checks/partial-call-arguments/extract-undefined-variables';

export interface TargetParams {
  /** Read bare in the target: nothing there handles their absence. */
  required: string[];
  /** Read through `| default` in the target, so the target handles its own absence. */
  optional: string[];
  /**
   * What the target has in scope anyway. Passing one is redundant rather than unknown, and
   * it never appears in `required`/`optional` for exactly that reason.
   */
  inScope: string[];
}

/**
 * The parameter list a call target takes, INFERRED from its source — for a target that
 * declares none.
 *
 * `undefined` means there is nothing here to infer from: either the target cannot be
 * located, or it HAS a `{% doc %}` block with parameters, which is a declared contract and
 * belongs to the checks that read contracts (`MissingRenderPartialArguments`,
 * `UnrecognizedRenderPartialArguments`). Running an inference check on a documented partial
 * reported every missing argument twice.
 *
 * The mirror of `partialInputs`, which asks the same question of the file being VISITED.
 * Shared by every check that judges a call site against an undocumented target, and cheap
 * to ask twice: `extractUndefinedVariables` memoizes on `(source, in-scope names)`, so the
 * second caller at a call site pays a cache hit and no parse.
 */
export async function inferredTargetParams(
  context: Context<SourceCodeType.LiquidHtml>,
  documentType: DocumentType,
  targetFile: string,
): Promise<TargetParams | undefined> {
  const locator = new DocumentsLocator(context.fs, context.app);
  const locatedFile = await locator.locate(
    URI.parse(context.config.rootUri),
    documentType,
    targetFile,
  );

  if (!locatedFile) return undefined;

  const docDef = context.getDocDefinition
    ? await context.getDocDefinition(relative(locatedFile, context.config.rootUri))
    : undefined;

  if (docDef?.liquidDoc?.parameters) return undefined;

  const source = await context.fs.readFile(locatedFile);

  const inScope = await inScopeNames(context, context.fileType(locatedFile));

  const { required, optional } = extractUndefinedVariables(source, inScope);

  return { required, optional, inScope };
}

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

async function inScopeNames(
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
    names = objects
      .filter((object) => isObjectInScope(object, targetFileType))
      .map((object) => object.name);
    // `app` is not a documented object, so it never comes back from objects().
    if (targetFileType === PlatformOSFileType.Partial) names = [...names, 'app'];
    byType.set(targetFileType, names);
  }

  // A FRESH array on every call. Callers are free to extend the returned `inScope`, and it is
  // also a cache KEY inside `extractUndefinedVariables` — one caller pushing onto a
  // shared array would corrupt both the next caller's scope and that key.
  return [...names];
}
