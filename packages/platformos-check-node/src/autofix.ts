import { writeFile } from 'fs/promises';
import {
  Offense,
  App,
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
export async function autofix(sourceCodes: App, offenses: Offense[]) {
  await coreAutofix(sourceCodes, offenses, saveToDiskFixApplicator);
}
