import { writeFile } from 'fs/promises';
import {
  AppModel,
  Offense,
  autofix as coreAutofix,
  FixApplicator,
  applyFixToString,
  path,
} from '@platformos/platformos-check-common';

export const saveToDiskFixApplicator: FixApplicator = async (sourceCode, fix) => {
  const updatedSource = applyFixToString(sourceCode.source, fix);
  await writeFile(path.fsPath(sourceCode.uri), updatedSource, 'utf8');
};

/**
 * Apply the safe fixes for a set of offenses on an app, saving to disk by default.
 *
 * The applicator is OPTIONAL rather than absent, so this is a superset of check-common's
 * `autofix` (which requires it) and of a two-argument disk-writing one: `pos-cli` calls it with
 * two arguments and gets the write, and an embedder that passes its own applicator — usually to
 * keep sources OFF the filesystem — gets that honoured rather than ignored. `index.ts` must
 * re-export this EXPLICITLY, which is what shadows the `autofix` its `export *` also carries.
 * Both arities are pinned by `autofix.spec.ts`.
 */
export async function autofix(
  app: AppModel,
  offenses: Offense[],
  applyFixes: FixApplicator = saveToDiskFixApplicator,
) {
  await coreAutofix(app, offenses, applyFixes);
}
