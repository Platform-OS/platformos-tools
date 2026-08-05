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
 * Apply and save to disk the safe fixes for a set of offenses on an app.
 */
export async function autofix(app: AppModel, offenses: Offense[]) {
  await coreAutofix(app, offenses, saveToDiskFixApplicator);
}
