import { PlatformOSFileType } from '@platformos/platformos-common';
import { Context, SourceCodeType } from '../types';
import { isError } from '../utils';
import { isObjectInScope } from '../checks/utils';
import {
  extractUndefinedVariables,
  UndefinedVariables,
} from '../checks/partial-call-arguments/extract-undefined-variables';

/**
 * What the partial being checked reads from its caller, as seen from inside it.
 *
 * This is the same per-file analysis the call-site checks run on a partial with NO
 * `{% doc %}` block — the doc-drift checks compare a partial's declared contract against
 * it — with everything a partial has in scope anyway excluded: the documented objects that
 * reach a partial, plus `app`, which is not a documented object and so never comes back
 * from `objects()`. Without that exclusion every partial that touches `context` would look
 * like it takes an undeclared parameter.
 *
 * A render/function target always resolves through the `partial` document type, and
 * `{% doc %}` applies to nothing else, so the scope question is settled for the file type
 * rather than asked per file.
 *
 * Both doc-drift checks build the names list here and hand over the parse they already
 * hold, so between them the analysis costs one walk of the file and no parse at all.
 */
export async function partialInputs(
  context: Context<SourceCodeType.LiquidHtml>,
): Promise<UndefinedVariables> {
  const objects = (await context.platformosDocset?.objects()) ?? [];
  const inScopeNames = objects
    .filter((object) => isObjectInScope(object, PlatformOSFileType.Partial))
    .map((object) => object.name);
  inScopeNames.push('app');

  const ast = context.file.ast;

  return extractUndefinedVariables(
    context.file.source,
    inScopeNames,
    isError(ast) ? undefined : ast,
  );
}
